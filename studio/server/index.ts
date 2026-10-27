import express from 'express';
import multer from 'multer';
import { randomUUID, randomInt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, publicJob } from './store';
import { ConnectionManager, localEndpoint } from './comfy';
import { Runner } from './runner';
import { filmstrip, ingest } from './media';
import { seedExamples } from './seed';
import { validateSelection } from './workflow';
import { CloudManager } from './cloud';
import { ModelManager } from './models';
import { imageModelFiles, modelDefinitions, modelFilesForSettings } from '../shared/models';
import { offerFiltersSchema } from '../shared/cloud';
import { defaults, geometry, renderGeometry, segmentCount, settingsSchema } from '../shared/types';
import type { Asset, Catalog, Graph, Job } from '../shared/types';
import { migrateDemoPrompt, PROMPT_VERSION } from '../shared/prompts';
import { FRAMING_VERSION, type ReferenceGeometry } from './framing';
import { engineIssue, isViggle } from '../shared/engines';
import { viggleWindows } from '../shared/viggle-segments';
import { registerImageRoutes } from './image-routes';
import { clipFrameCount } from '../shared/clip';
import { canFinishImageLocally, isImageJob } from '../shared/image-replacement';
import { registerClipEditorRoutes } from './clip-editor';
import { startLocalServer } from './local-server';

const STUDIO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = path.dirname(STUDIO);
const publicAsset = (asset: Asset) => ({ ...asset, path: '', poster: 'ready' });
export async function createApplication(options: { dataRoot?: string; seed?: boolean; repo?: string; allowSSH?: boolean; catalog?: Catalog; template?: Graph; geometry?: ReferenceGeometry } = {}) {
  const repo = options.repo || REPO;
  const store = new Store(options.dataRoot || process.env.RECAST_DATA || path.join(STUDIO, 'data'));
  const catalog: Catalog = options.catalog || JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));
  const template: Graph = options.template || JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
  const connection = new ConnectionManager(store, repo, catalog), runner = new Runner(store, connection, template, repo, options.geometry);
  const cloud = new CloudManager(store, connection, runner, repo);
  const models = new ModelManager(store, connection, repo);
  if (options.seed !== false) await seedExamples(store, repo);
  for (const job of store.jobs()) {
    if (job.origin === 'render' && ['queued', 'running', 'reconnecting'].includes(job.status)) { job.status = 'interrupted'; job.error = 'The local app restarted. Reconnect to check the existing GPU job before resuming.'; store.saveJob(job); }
  }
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      try { const url = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return void res.status(403).json({ error: 'Open the local Recast Studio to make changes.' }); }
      catch { return void res.status(403).json({ error: 'Invalid origin.' }); }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next();
  });
  app.use(express.json({ limit: '100kb' }));
  const clipEditor = registerClipEditorRoutes(app, store);
  const bootstrap = () => ({ assets: store.assets().map(publicAsset), jobs: store.jobs().map(publicJob), draft: store.draft(), imageDraft: store.imageDraft(), connection: connection.status, cloud: cloud.state, models: models.state });
  app.get('/api/bootstrap', (_req, res) => res.json(bootstrap()));
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: unknown) => res.write('data: ' + JSON.stringify(event) + '\n\n');
    send({ type: 'bootstrap', data: bootstrap() }); store.on('event', send);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); store.off('event', send); });
  });
  app.get('/api/cloud', (_req, res) => res.json(cloud.state));
  app.get('/api/models', async (_req, res) => res.json(await models.refresh()));
  app.post('/api/models/download', async (req, res) => {
    if (cloud.state.busy || runner.busy || store.jobs().some(job => ['queued', 'running', 'reconnecting'].includes(job.status))) return void res.status(409).json({ error: 'Finish the current setup or render before downloading models.' });
    const value = z.object({ files: z.array(z.string().max(300)).min(1).max(modelDefinitions.length) }).parse(req.body);
    res.status(202).json(await models.start(value.files));
  });
  app.post('/api/models/cancel', async (_req, res) => res.json(await models.cancel()));
  app.post('/api/models/delete', async (req, res) => {
    if (cloud.state.busy || runner.busy || store.jobs().some(job => ['queued', 'running', 'reconnecting'].includes(job.status))) return void res.status(409).json({ error: 'Finish setup or rendering before removing a LoRA.' });
    const value = z.object({ name: z.string().min(1).max(300) }).parse(req.body);
    res.json(await models.remove(value.name));
  });
  app.post('/api/cloud/refresh', async (_req, res) => res.json(await cloud.refresh()));
  app.post('/api/cloud/offers', async (req, res) => res.json(await cloud.offers(offerFiltersSchema.parse(req.body))));
  app.post('/api/cloud/favourites', (req, res) => {
    const value = z.object({ launchId: z.string().min(1).max(120).optional(), quote: z.string().uuid().optional() }).refine(value => !!value.launchId !== !!value.quote, 'Choose one rental or offer.').parse(req.body);
    res.json(cloud.saveFavourite(value));
  });
  app.delete('/api/cloud/favourites/:id', (req, res) => res.json(cloud.removeFavourite(z.string().uuid().parse(req.params.id))));
  app.post('/api/cloud/favourites/check', async (req, res) => {
    const value = z.object({ filters: offerFiltersSchema, id: z.string().uuid().optional() }).parse(req.body);
    res.json(await cloud.checkFavourites(value.filters, value.id));
  });
  app.post('/api/cloud/preflight', async (req, res) => { const value = z.object({ quote: z.string().uuid() }).parse(req.body); res.json(await cloud.checkConfiguration(value.quote)); });
  app.post('/api/cloud/launch', (req, res) => {
    if (models.state.busy) return void res.status(409).json({ error: 'Finish or cancel model downloads before changing GPU instances.' });
    const value = z.object({ quote: z.string().uuid(), approvedHourly: z.number().positive().max(100) }).parse(req.body);
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A rental request ID is required.' });
    res.status(202).json(cloud.launch(value.quote, value.approvedHourly, key));
  });
  app.post('/api/cloud/launches/:id/continue', async (req, res) => { if (models.state.busy) return void res.status(409).json({ error: 'Finish or cancel downloads before reconnecting setup.' }); const launch = cloud.state.launches.find(l => l.id === req.params.id); if (!launch) return void res.sendStatus(404); res.status(202).json(await cloud.continue(launch)); });
  app.post('/api/cloud/launches/:id/cancel', async (req, res) => { const launch = cloud.state.launches.find(l => l.id === req.params.id); if (!launch) return void res.sendStatus(404); res.json(await cloud.cancel(launch)); });
  app.post('/api/cloud/instances/:id/:action', async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id), action = z.enum(['start', 'stop', 'destroy', 'connect']).parse(req.params.action);
    const value = z.object({ confirmation: z.string().optional() }).parse(req.body || {});
    if (models.state.busy) {
      if (['start', 'connect'].includes(action)) return void res.status(409).json({ error: 'Finish or cancel downloads before reconnecting setup.' });
      if (action === 'destroy' && value.confirmation !== String(id)) return void res.status(400).json({ error: 'Enter the instance ID to confirm deletion.' });
      await models.cancel();
    }
    res.json(await cloud.action(id, action, value.confirmation));
  });
  app.post('/api/draft', (req, res) => {
    const value = z.object({ sourceId: z.string().nullable(), referenceId: z.string().nullable(), settings: settingsSchema }).parse(req.body);
    value.settings.prompt = migrateDemoPrompt(value.settings.prompt, value.settings.mode);
    for (const id of [value.sourceId, value.referenceId]) if (id && !store.asset(id)) throw new Error('This input no longer exists. Upload it again.');
    store.set('draft', value); res.json(value);
  });
  registerImageRoutes(app, store, connection, runner, cloud, models, repo);
  const upload = multer({ dest: path.join(store.root, 'uploads'), limits: { files: 1, fileSize: 512 * 1024 ** 2, fields: 0 } });
  app.post('/api/assets/:kind', upload.single('file'), async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: 'Choose a file to upload.' });
    try {
      if (!['video', 'image'].includes(String(req.params.kind))) throw new Error('Choose a video or character image.');
      const asset = await ingest(store, req.file.path, req.params.kind as Asset['kind'], req.file.originalname);
      res.status(201).json(publicAsset(asset));
    } catch (error) { await rm(req.file.path, { force: true }); throw error; }
  });
  app.get('/api/assets/:id/:type', async (req, res) => {
    const asset = store.asset(String(req.params.id)); if (!asset) return void res.status(404).json({ error: 'Input not found.' });
    if (req.params.type === 'filmstrip') {
      if (asset.kind !== 'video') return void res.sendStatus(404);
      return void res.sendFile(await filmstrip(asset));
    }
    if (!['original', 'poster'].includes(String(req.params.type))) return void res.sendStatus(404);
    res.sendFile(req.params.type === 'poster' ? asset.poster : asset.path);
  });
  app.post('/api/connection/connect', async (req, res) => {
    if (cloud.state.busy || models.state.busy) return void res.status(409).json({ error: 'GPU setup or model download is in progress. Wait for it to finish connecting the selected rental.' });
    const value = z.object({ endpoint: z.string().max(200), useSSH: z.boolean().default(true) }).parse(req.body);
    localEndpoint(value.endpoint);
    if (runner.active || (connection.status.state === 'online' && store.jobs().some(j => j.status === 'queued'))) return void res.status(409).json({ error: 'Finish or cancel the active queue before changing the connection.' });
    res.status(202).json({ accepted: true });
    void connection.connect(value.endpoint, options.allowSSH === false ? false : value.useSSH).then(() => runner.kick());
  });
  app.post('/api/connection/disconnect', (_req, res) => {
    if (runner.active || models.state.busy || store.jobs().some(j => j.status === 'queued')) return void res.status(409).json({ error: 'Cancel the active render or download queue before disconnecting. This does not stop rental billing.' });
    connection.disconnect(); res.json(connection.status);
  });
  app.post('/api/jobs', async (req, res) => {
    if (cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || (l.instanceId && l.safetyStatus === 'unconfirmed'))) return void res.status(503).json({ error: 'The GPU setup or stop status is not settled. Your draft is saved; check GPU cloud before generating.' });
    const value = z.object({ sourceId: z.string(), referenceId: z.string(), settings: settingsSchema, saveDiagnosticLatent: z.boolean().default(false) }).parse(req.body);
    const issue = engineIssue(value.settings); if (issue) return void res.status(400).json({ error: issue });
    if (isViggle(value.settings) && value.saveDiagnosticLatent) return void res.status(400).json({ error: 'Viggle exports its conditioning frame and video; SCAIL latent diagnostics are not available.' });
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A request ID is required.' });
    const existing = store.byKey(key); if (existing) return void res.json(publicJob(existing));
    if (connection.status.state !== 'online') return void res.status(503).json({ error: 'Connect the GPU before generating. Your draft is saved locally.' });
    if (models.state.busy) return void res.status(409).json({ error: 'Wait for model downloads to finish before generating.' });
    await models.refresh();
    const accepted = store.byKey(key); if (accepted) return void res.json(publicJob(accepted));
    if (models.state.busy || cloud.state.busy || connection.status.state !== 'online') return void res.status(409).json({ error: 'The GPU or model downloads changed while checking. Nothing was queued; wait for readiness before generating.' });
    if (models.state.error) return void res.status(503).json({ error: models.state.error });
    const missing = modelFilesForSettings(value.settings).filter(id => models.state.files.find(file => file.id === id)?.status !== 'installed');
    if (missing.length) return void res.status(409).json({ error: isViggle(value.settings) && value.settings.referencePreparation !== 'prepared' && missing.some(id => imageModelFiles.includes(id))
      ? 'Automatic frame preparation requires Klein. Download it beside Reference preparation, or create a frame in Image replacement and select Use an already edited source frame. Nothing was queued.'
      : 'Download the required files in Models before generating. Nothing was queued.', missingModels: missing });
    for (const name of [value.settings.loraA, value.settings.loraB]) if (name !== 'None' && !connection.status.loras.includes(name)) return void res.status(409).json({ error: 'Upload the selected custom LoRA before generating: ' + name });
    const source = store.asset(value.sourceId), reference = store.asset(value.referenceId); if (!source || !reference) throw new Error('Upload both inputs before generating.');
    validateSelection(source, reference, value.settings.start, value.settings.seconds, value.settings.fps);
    if (isViggle(value.settings) && value.settings.referencePreparation === 'prepared' && Math.abs((reference.width / reference.height) / (source.width / source.height) - 1) > 0.05) return void res.status(400).json({ error: 'An already edited source frame must keep the source video’s aspect ratio. Use automatic reference preparation for a standalone character photo.' });
    const settings = { ...value.settings, prompt: migrateDemoPrompt(value.settings.prompt, value.settings.mode) }; if (settings.randomSeed) settings.seed = randomInt(0, 0xffffffff);
    const [width, height] = renderGeometry(settings, source), [outputWidth, outputHeight] = geometry(settings, source), target = clipFrameCount(settings.seconds, settings.fps);
    const segmented = isViggle(settings) && target > 124;
    const segmentation = settings.viggleReferenceMode === 'original' ? 'five-frame-v1' as const : 'last-frame-v2' as const;
    const continuationNodes = ['RecastViggleAnchor', 'RecastViggleSaveContext', ...(segmentation === 'last-frame-v2' ? ['RecastViggleContextReference'] : [])];
    if (segmented && (continuationNodes.some(name => !connection.catalog[name]) || !connection.catalog.RecastViggleSaveContext?.input.optional?.terminal)) return void res.status(409).json({ error: 'This GPU needs the updated continuation nodes. Use Connect / retry setup in GPU cloud before generating a longer clip. Existing models are reused; no extra weights are required.' });
    const job: Job = { id: randomUUID(), title: source.name.replace(/\.[^.]+$/, '') + (isViggle(settings) ? ' / Viggle swap' : settings.mode === 'swap' ? ' / character swap' : ' / motion transfer'), status: 'queued', sourceId: source.id, referenceId: reference.id, settings, promptVersion: PROMPT_VERSION, renderVersion: 'continuous-v1', saveDiagnosticLatent: value.saveDiagnosticLatent, ...(settings.mode === 'swap' && !isViggle(settings) ? { framingVersion: FRAMING_VERSION } : {}),
      createdAt: new Date().toISOString(), favorite: false, deleted: false, width, height, ...(segmented ? { viggleSegmentation: segmentation } : {}), ...(settings.resolution === '720' ? { outputSize: { width: outputWidth, height: outputHeight } } : {}),
      progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: isViggle(settings) ? viggleWindows(target).length : segmentCount(target, settings.framesPerPass), completedFrames: 0, targetFrames: target, updatedAt: Date.now() },
      segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
    store.addJob(job, key); res.status(201).json(publicJob(job)); void runner.kick();
  });
  app.patch('/api/jobs/:id', (req, res) => {
    const job = store.job(String(req.params.id)); if (!job) return void res.sendStatus(404);
    const changes = z.object({ title: z.string().trim().min(1).max(120).optional(), favorite: z.boolean().optional(), deleted: z.boolean().optional() }).parse(req.body);
    if (changes.deleted && ['running', 'queued', 'reconnecting'].includes(job.status)) return void res.status(409).json({ error: 'Cancel this run before moving it to trash.' });
    Object.assign(job, changes); store.saveJob(job, false); res.json(publicJob(job));
  });
  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const job = store.job(String(req.params.id)); if (!job) return void res.sendStatus(404);
    if (!['queued', 'running', 'reconnecting', 'interrupted'].includes(job.status)) return void res.json(publicJob(job));
    await runner.cancel(job); res.json(publicJob(store.job(job.id)!));
  });
  app.post('/api/jobs/:id/resume', async (req, res) => {
    const job = store.job(String(req.params.id)); if (!job) return void res.sendStatus(404);
    if (connection.status.state !== 'online' && !canFinishImageLocally(job)) return void res.status(503).json({ error: 'Reconnect your GPU first.' });
    if (job.status !== 'interrupted') return void res.status(409).json({ error: 'Only an interrupted run can be resumed. Reuse settings to start another run.' });
    const value = z.object({ retryMissing: z.boolean().default(false) }).parse(req.body || {});
    await runner.resume(job, value.retryMissing); res.json(publicJob(store.job(job.id)!));
  });
  app.get('/api/jobs/:id/:type', (req, res) => {
    const job = store.job(String(req.params.id)); if (!job) return void res.sendStatus(404);
    if (req.params.type === 'video' && req.query.download && job.edit?.format === 'mkv') {
      const file = path.join(store.root, 'jobs', job.id, 'master.mkv');
      if (!existsSync(file)) return void res.sendStatus(404);
      res.attachment(`${job.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 70) || 'recast-edit'}.mkv`);
      return void res.sendFile(file);
    }
    if (isImageJob(job) && ['image', 'image-source', 'face-source', 'face-reference', 'face-output', 'image-mask', 'image-structure', 'image-body', 'image-body-raw', 'image-head-raw', 'image-lighting', 'image-prepared-reference', 'image-identity-anchor', 'image-integrated-base'].includes(String(req.params.type))) {
      const name = { image: 'final.png', 'image-source': 'original.png', 'face-source': 'source-face.png', 'face-reference': 'reference-face.png', 'face-output': 'output-face.png', 'image-mask': 'edit-mask.png', 'image-structure': 'source-structure.png', 'image-body': 'body-stage.png', 'image-body-raw': 'body-raw.png', 'image-head-raw': 'head-raw.png', 'image-lighting': 'lighting-raw.png', 'image-prepared-reference': 'reference-normalized.png', 'image-identity-anchor': 'identity-anchored-target.png', 'image-integrated-base': 'integrated-base.png' }[String(req.params.type)];
      const file = path.join(store.root, 'jobs', job.id, name!);
      if (!existsSync(file)) return void res.sendStatus(404);
      if (req.query.download) res.attachment(`${job.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 70)}.png`);
      return void res.sendFile(file);
    }
    if (req.params.type === 'keyframe') {
      const index = req.query.segment === undefined ? 0 : z.coerce.number().int().min(0).max(63).parse(req.query.segment);
      const name = index === 0 && job.keyframe ? 'keyframe.png' : job.segments[index]?.reference;
      if (!name || !/^(keyframe|reference_\d{4})\.png$/.test(name)) return void res.sendStatus(404);
      const file = path.join(store.root, 'jobs', job.id, name);
      if (!existsSync(file)) return void res.sendStatus(404);
      return void res.sendFile(file);
    }
    if (req.params.type === 'aligned-reference') {
      if (!job.referenceFraming) return void res.sendStatus(404);
      return void res.sendFile(path.join(store.root, 'jobs', job.id, 'aligned-reference.png'));
    }
    const type = String(req.params.type);
    if (type === 'workflow') { if (!job.workflow) return void res.status(404).json({ error: 'This run has not submitted a workflow yet.' }); res.attachment(`recast-${job.id}-workflow.json`).json(job.workflow); return; }
    const file = type === 'video' ? job.output : type === 'poster' ? job.poster : type === 'source' ? path.join(store.root, 'jobs', job.id, 'prepared-source.mp4') : null;
    const fallback = type === 'source' ? store.asset(job.sourceId)?.path : null;
    const target = file && existsSync(file) ? file : fallback;
    if (!target) return void res.sendStatus(404);
    if (req.query.download) res.attachment(`${job.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 70)}.mp4`);
    res.sendFile(target);
  });
  const frontend = path.join(STUDIO, 'dist');
  if (existsSync(frontend)) { app.use(express.static(frontend)); app.get('/{*path}', (_req, res) => res.sendFile(path.join(frontend, 'index.html'))); }
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') : error.code === 'LIMIT_FILE_SIZE' ? 'Videos can be up to 512 MB.' : error.message || 'This action could not be completed.';
    res.status(error instanceof z.ZodError ? 422 : error instanceof multer.MulterError ? 413 : 400).json({ error: String(message).slice(0, 2000) });
  });
  return { app, store, connection, runner, cloud, models, clipEditor };
}
async function main() {
  const port = Number(process.env.PORT || 3000);
  const { server, store, cloud, models, clipEditor } = await startLocalServer(() => createApplication(), port);
  console.log(`Recast Studio: http://127.0.0.1:${port} (GPU disconnected until you connect)`);
  server.on('error', error => { console.error(error.message); cloud.dispose(); store.close(); process.exitCode = 1; });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true; server.closeAllConnections(); server.close();
    const deadline = setTimeout(() => { console.error('Shutdown could not confirm all setup stops. Check your instances in Vast.'); process.exit(1); }, 60000);
    try { await clipEditor.shutdown(); await models.cancel(); await cloud.shutdown(); clearTimeout(deadline); cloud.dispose(); store.close(); process.exit(0); }
    catch (error) { console.error((error as Error).message); clearTimeout(deadline); cloud.dispose(); store.close(); process.exit(1); }
  };
  process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${process.env.PORT || 3000} is already in use. No Studio data was opened; use the existing app window.` : error.message);
    process.exitCode = 1;
  });
}
