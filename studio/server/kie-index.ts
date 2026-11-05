/** Kie-only app entry. No GPU, rental, model manager or ComfyUI runner is imported. */
import express from 'express';
import multer from 'multer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Asset, Bootstrap } from '../shared/types';
import { defaults } from '../shared/types';
import { KIE_MODEL, kieDefaults, kieDraftSchema } from '../shared/kie';
import { Store, publicJob } from './store';
import { ingest, filmstrip, probe } from './media';
import { openEventStream } from './event-stream';
import { startLocalServer } from './local-server';
import { KieAccount } from './kie-account';
import { KieClient } from './kie-client';
import { KieJobs, type KieClientLike } from './kie-jobs';

const STUDIO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicAsset = (asset: Asset) => ({ ...asset, path: '', poster: 'ready' });
const serve = (res: express.Response, file: string) => res.sendFile(path.basename(file), { root: path.dirname(file) });
export async function createKieApplication(options: { dataRoot?: string; frontendRoot?: string; apiClient?: KieClientLike; pollMs?: number } = {}) {
  const root = path.resolve(options.dataRoot || process.env.RECAST_KIE_DATA || path.join(STUDIO, 'kie-data'));
  const marker = path.join(root, 'kie-app.json');
  // Never open the original Studio database or migrate its paid job records.
  if (existsSync(path.join(root, 'studio.sqlite')) && !existsSync(marker)) throw new Error('This folder belongs to another Studio installation. Choose an empty dedicated RECAST_KIE_DATA folder; the existing database was not opened.');
  if (existsSync(marker) && (lstatSync(marker).isSymbolicLink() || JSON.parse(readFileSync(marker, 'utf8')).app !== 'recast-kie-v1')) throw new Error('The Kie data-folder marker is invalid. Existing data was not opened.');
  await mkdir(root, { recursive: true, mode: 0o700 }); if (!existsSync(marker)) await writeFile(marker, JSON.stringify({ app: 'recast-kie-v1' }) + '\n', { flag: 'wx', mode: 0o600 });
  const store = new Store(root), client = options.apiClient || new KieClient();
  const account = new KieAccount(store, (key, signal) => client.getCredits(key, signal));
  const jobs = new KieJobs(store, account, client, options.pollMs);
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    // A loopback socket alone does not prevent a foreign domain from rebinding
    // to localhost. Validate Host before trusting it for same-origin checks.
    try {
      const host = new URL(`http://${req.get('host') || ''}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw new Error('Foreign Host');
    } catch { return void res.status(403).json({ error: 'Open Recast using localhost or 127.0.0.1.' }); }
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return void res.status(403).json({ error: 'Open the local Recast app to make changes.' });
      if (origin) try { if (new URL(origin).origin !== `${req.protocol}://${req.get('host')}`) return void res.status(403).json({ error: 'Open the local Recast app to make changes.' }); } catch { return void res.status(403).json({ error: 'Invalid request origin.' }); }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next();
  });
  app.use(express.json({ limit: '128kb' }));
  const draft = () => kieDraftSchema.parse(store.value('kie-draft', kieDefaults));
  const bootstrap = (): Bootstrap => ({ assets: store.assets().map(publicAsset), jobs: store.jobs().map(publicJob),
    kie: { provider: 'kie.ai', model: KIE_MODEL, draft: draft(), account: account.status() },
    // Inert compatibility data for existing local Library/player primitives.
    draft: { sourceId: null, referenceId: null, settings: defaults }, characters: [], capabilities: { imagenSegmentRepaint: false },
    connection: { state: 'offline', endpoint: '', gpu: null, loras: [], checkedAt: null, message: 'Kie.ai API workspace; local GPUs are not used.' },
    cloud: { configured: false, instances: [], launches: [], refreshedAt: null, error: null, busy: false },
    models: { files: [], busy: false, refreshing: false, error: null, checkedAt: null, installedLoras: [], deleting: null } });
  app.get('/api/health', (_req, res) => res.json({ app: 'recast-kie', provider: 'kie.ai', model: KIE_MODEL }));
  app.get('/api/bootstrap', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(bootstrap()); });
  app.get('/api/events', (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); openEventStream(store, res, bootstrap()); });
  app.get('/api/kie/account', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(req.query.refresh === '1' ? await account.refresh() : account.status()); });
  app.post('/api/kie/account', async (req, res) => {
    if (jobs.busy) return void res.status(409).json({ error: 'Stop following active tasks before replacing the API key. Saved task IDs are kept.' });
    res.setHeader('Cache-Control', 'no-store'); res.json(await account.save(req.body));
  });
  app.get('/api/kie/draft', (_req, res) => res.json(draft()));
  app.put('/api/kie/draft', (req, res) => {
    const value = kieDraftSchema.parse(req.body);
    if (value.sourceId && store.asset(value.sourceId)?.kind !== 'video' || value.referenceId && store.asset(value.referenceId)?.kind !== 'image' || value.faceReferenceId && store.asset(value.faceReferenceId)?.kind !== 'image') throw new Error('One of the selected inputs no longer exists. Upload it again.');
    store.set('kie-draft', value); store.emit('event', { type: 'kie-draft', data: value }); res.json(value);
  });
  const upload = multer({ dest: path.join(root, 'uploads'), limits: { files: 1, fileSize: 512 * 1024 ** 2, fields: 0 } });
  app.post('/api/assets/:kind', upload.single('file'), async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: 'Choose a video or character image.' });
    try {
      const kind = z.enum(['video', 'image']).parse(req.params.kind), meta = await probe(req.file.path), maximum = kind === 'video' ? 4096 : 8000;
      if (Math.min(meta.width, meta.height) < 240 || Math.max(meta.width, meta.height) > maximum || Math.max(meta.width / meta.height, meta.height / meta.width) > 8) throw new Error(`Use a ${kind} with sides 240–${maximum} pixels and an aspect ratio at most 8:1.`);
      if (kind === 'image' && req.file.size > 20_000_000) throw new Error('Character references can be at most 20 MB.');
      const asset = await ingest(store, req.file.path, kind, req.file.originalname); res.status(201).json(publicAsset(asset));
    } catch (error) { await rm(req.file.path, { force: true }); throw error; }
  });
  app.get('/api/assets/:id/:type', async (req, res) => {
    const asset = store.asset(String(req.params.id)); if (!asset) return void res.sendStatus(404);
    if (req.params.type === 'filmstrip' && asset.kind === 'video') return void serve(res, await filmstrip(asset));
    const file = req.params.type === 'original' ? asset.path : req.params.type === 'poster' ? asset.poster : null;
    if (!file || !existsSync(file)) return void res.sendStatus(404); serve(res, file);
  });
  app.post('/api/kie/jobs', async (req, res) => { const job = await jobs.create(req.body, req.get('Idempotency-Key') || ''); res.status(202).json(publicJob(job)); void jobs.kick(); });
  const find = (id: string) => { const job = store.job(id); if (!job?.kie) throw new Error('This Kie.ai task is unavailable.'); return job; };
  for (const route of ['/api/kie/jobs/:id/cancel', '/api/jobs/:id/cancel']) app.post(route, async (req, res) => res.json(publicJob(await jobs.cancel(find(String(req.params.id))))));
  for (const route of ['/api/kie/jobs/:id/resume', '/api/kie/jobs/:id/recover', '/api/jobs/:id/resume']) app.post(route, async (req, res) => {
    const value = z.object({ taskId: z.string().min(1).max(200).optional() }).strict().parse(req.body || {});
    const job = await jobs.resume(find(String(req.params.id)), value.taskId); res.json(publicJob(job)); void jobs.kick();
  });
  app.patch('/api/jobs/:id', (req, res) => {
    const job = find(String(req.params.id)), value = z.object({ title: z.string().trim().min(1).max(120).optional(), favorite: z.boolean().optional(), deleted: z.boolean().optional() }).strict().parse(req.body);
    if (value.deleted && ['queued', 'running', 'reconnecting'].includes(job.status)) return void res.status(409).json({ error: 'Stop following this task before moving it to Trash. Provider processing may continue.' });
    Object.assign(job, value); store.saveJob(job, false); res.json(publicJob(job));
  });
  app.get('/api/jobs/:id/:type', (req, res) => {
    const job = store.job(String(req.params.id)); if (!job?.kie) return void res.sendStatus(404);
    const type = String(req.params.type);
    const file = type === 'video' ? job.output : type === 'poster' ? job.poster : type === 'source' ? path.join(root, 'jobs', job.id, 'prepared-source.mp4') : type === 'receipt' ? path.join(root, 'jobs', job.id, 'kie-receipt.json') : null;
    if (!file || !existsSync(file)) return void res.sendStatus(404);
    if (req.query.download || type === 'receipt') res.attachment(`${job.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 70) || 'recast'}.${type === 'receipt' ? 'json' : 'mp4'}`);
    serve(res, file);
  });
  // Old GPU/model/image/rental endpoints are deliberately absent, including GET.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'This endpoint is not available in the Kie.ai workspace.' }));
  const frontend = options.frontendRoot || path.join(STUDIO, 'dist'); if (existsSync(frontend)) { app.use(express.static(frontend)); app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: frontend })); }
  app.use((error: Error & { code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' ') : error instanceof multer.MulterError ? 'The local upload is too large or incomplete.' : error.message || 'This action could not be completed.';
    res.status(error instanceof z.ZodError ? 422 : 400).json({ error: String(message).split(root).join('[local media]').slice(0, 1800) });
  });
  return { app, store, account, jobs, bootstrap, shutdown: async () => { await jobs.shutdown(); store.close(); } };
}
async function main() {
  const port = Number(process.env.RECAST_KIE_PORT || 3001);
  const state = await startLocalServer(() => createKieApplication(), port); console.log(`Recast · Kie.ai: http://127.0.0.1:${port}`);
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; state.server.closeAllConnections(); state.server.close(); await state.shutdown(); process.exit(0); };
  process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main().catch((error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? 'This Recast Kie port is already in use. Use the existing window; no database was opened.' : error.message); process.exitCode = 1; });
