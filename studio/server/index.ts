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
import { ingest } from './media';
import { seedExamples } from './seed';
import { validateSelection } from './workflow';
import { CloudManager } from './cloud';
import { offerFiltersSchema } from '../shared/cloud';
import { defaults, geometry, segmentCount, settingsSchema } from '../shared/types';
import type { Asset, Catalog, Graph, Job } from '../shared/types';
import { migrateDemoPrompt, PROMPT_VERSION } from '../shared/prompts';
import { FRAMING_VERSION, type ReferenceGeometry } from './framing';

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
  const bootstrap = () => ({ assets: store.assets().map(publicAsset), jobs: store.jobs().map(publicJob), draft: store.draft(), connection: connection.status, cloud: cloud.state });
  app.get('/api/bootstrap', (_req, res) => res.json(bootstrap()));
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: unknown) => res.write('data: ' + JSON.stringify(event) + '\n\n');
    send({ type: 'bootstrap', data: bootstrap() }); store.on('event', send);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); store.off('event', send); });
  });
  app.get('/api/cloud', (_req, res) => res.json(cloud.state));
  app.post('/api/cloud/key', async (req, res) => { const value = z.object({ key: z.string().trim().min(12).max(500) }).parse(req.body); await cloud.saveKey(value.key); res.json(cloud.state); });
  app.delete('/api/cloud/key', async (_req, res) => { await cloud.removeKey(); res.json(cloud.state); });
  app.post('/api/cloud/refresh', async (_req, res) => res.json(await cloud.refresh()));
  app.post('/api/cloud/offers', async (req, res) => res.json(await cloud.offers(offerFiltersSchema.parse(req.body))));
  app.post('/api/cloud/preflight', async (req, res) => { const value = z.object({ quote: z.string().uuid() }).parse(req.body); res.json(await cloud.checkConfiguration(value.quote)); });
  app.post('/api/cloud/launch', (req, res) => {
    const value = z.object({ quote: z.string().uuid(), approvedHourly: z.number().positive().max(100) }).parse(req.body);
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A rental request ID is required.' });
    res.status(202).json(cloud.launch(value.quote, value.approvedHourly, key));
  });
  app.post('/api/cloud/launches/:id/continue', async (req, res) => { const launch = cloud.state.launches.find(l => l.id === req.params.id); if (!launch) return void res.sendStatus(404); res.status(202).json(await cloud.continue(launch)); });
  app.post('/api/cloud/launches/:id/cancel', async (req, res) => { const launch = cloud.state.launches.find(l => l.id === req.params.id); if (!launch) return void res.sendStatus(404); res.json(await cloud.cancel(launch)); });
  app.post('/api/cloud/instances/:id/:action', async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id), action = z.enum(['start', 'stop', 'destroy', 'connect']).parse(req.params.action);
    const value = z.object({ confirmation: z.string().optional() }).parse(req.body || {}); res.json(await cloud.action(id, action, value.confirmation));
  });
  app.post('/api/draft', (req, res) => {
    const value = z.object({ sourceId: z.string().nullable(), referenceId: z.string().nullable(), settings: settingsSchema }).parse(req.body);
    value.settings.prompt = migrateDemoPrompt(value.settings.prompt, value.settings.mode);
    for (const id of [value.sourceId, value.referenceId]) if (id && !store.asset(id)) throw new Error('This input no longer exists. Upload it again.');
    store.set('draft', value); res.json(value);
  });
  const upload = multer({ dest: path.join(store.root, 'uploads'), limits: { files: 1, fileSize: 512 * 1024 ** 2, fields: 0 } });
  app.post('/api/assets/:kind', upload.single('file'), async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: 'Choose a file to upload.' });
    try {
      if (!['video', 'image'].includes(String(req.params.kind))) throw new Error('Choose a video or character image.');
      const asset = await ingest(store, req.file.path, req.params.kind as Asset['kind'], req.file.originalname);
      res.status(201).json(publicAsset(asset));
    } catch (error) { await rm(req.file.path, { force: true }); throw error; }
  });
  app.get('/api/assets/:id/:type', (req, res) => {
    const asset = store.asset(String(req.params.id)); if (!asset) return void res.status(404).json({ error: 'Input not found.' });
    if (!['original', 'poster'].includes(String(req.params.type))) return void res.sendStatus(404);
    res.sendFile(req.params.type === 'poster' ? asset.poster : asset.path);
  });
  app.post('/api/connection/connect', async (req, res) => {
    if (cloud.state.busy) return void res.status(409).json({ error: 'GPU setup is in progress. Wait for GPU cloud to finish connecting the selected rental.' });
    const value = z.object({ endpoint: z.string().max(200), useSSH: z.boolean().default(true) }).parse(req.body);
    localEndpoint(value.endpoint);
    if (runner.active || (connection.status.state === 'online' && store.jobs().some(j => j.status === 'queued'))) return void res.status(409).json({ error: 'Finish or cancel the active queue before changing the connection.' });
    res.status(202).json({ accepted: true });
    void connection.connect(value.endpoint, options.allowSSH === false ? false : value.useSSH).then(() => runner.kick());
  });
  app.post('/api/connection/disconnect', (_req, res) => {
    if (runner.active || store.jobs().some(j => j.status === 'queued')) return void res.status(409).json({ error: 'Cancel the active queue before disconnecting. This does not stop rental billing.' });
    connection.disconnect(); res.json(connection.status);
  });
  app.post('/api/jobs', (req, res) => {
    if (cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || (l.instanceId && l.safetyStatus === 'unconfirmed'))) return void res.status(503).json({ error: 'The GPU setup or stop status is not settled. Your draft is saved; check GPU cloud before generating.' });
    const value = z.object({ sourceId: z.string(), referenceId: z.string(), settings: settingsSchema }).parse(req.body);
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A request ID is required.' });
    const existing = store.byKey(key); if (existing) return void res.json(publicJob(existing));
    if (connection.status.state !== 'online') return void res.status(503).json({ error: 'Connect the GPU before generating. Your draft is saved locally.' });
    const source = store.asset(value.sourceId), reference = store.asset(value.referenceId); if (!source || !reference) throw new Error('Upload both inputs before generating.');
    validateSelection(source, reference, value.settings.start, value.settings.seconds, value.settings.fps);
    const settings = { ...value.settings, prompt: migrateDemoPrompt(value.settings.prompt, value.settings.mode) }; if (settings.randomSeed) settings.seed = randomInt(0, 0xffffffff);
    const [width, height] = geometry(settings, source), target = Math.ceil(settings.seconds * settings.fps);
    const job: Job = { id: randomUUID(), title: source.name.replace(/\.[^.]+$/, '') + (settings.mode === 'swap' ? ' / character swap' : ' / motion transfer'), status: 'queued', sourceId: source.id, referenceId: reference.id, settings, promptVersion: PROMPT_VERSION, ...(settings.mode === 'swap' ? { framingVersion: FRAMING_VERSION } : {}),
      createdAt: new Date().toISOString(), favorite: false, deleted: false, width, height,
      progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: segmentCount(target, settings.framesPerPass), completedFrames: 0, targetFrames: target, updatedAt: Date.now() },
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
    if (connection.status.state !== 'online') return void res.status(503).json({ error: 'Reconnect your GPU first.' });
    if (job.status !== 'interrupted') return void res.status(409).json({ error: 'Only an interrupted run can be resumed. Reuse settings to start another run.' });
    await runner.resume(job); res.json(publicJob(store.job(job.id)!));
  });
  app.get('/api/jobs/:id/:type', (req, res) => {
    const job = store.job(String(req.params.id)); if (!job) return void res.sendStatus(404);
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
  return { app, store, connection, runner, cloud };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { app, store, cloud } = await createApplication();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '127.0.0.1', () => console.log(`Recast Studio: http://127.0.0.1:${port} (GPU disconnected until you connect)`));
  server.on('error', error => { console.error(error.message); cloud.dispose(); store.close(); process.exitCode = 1; });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true; server.closeAllConnections(); server.close();
    const deadline = setTimeout(() => { console.error('Shutdown could not confirm all setup stops. Check your instances in Vast.'); process.exit(1); }, 60000);
    try { await cloud.shutdown(); clearTimeout(deadline); cloud.dispose(); store.close(); process.exit(0); }
    catch (error) { console.error((error as Error).message); clearTimeout(deadline); cloud.dispose(); store.close(); process.exit(1); }
  };
  process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
}
