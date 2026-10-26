import type { Express } from 'express';
import multer from 'multer';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import { publicJob } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { CloudManager } from './cloud';
import type { ModelManager } from './models';
import { command, ingest, probe } from './media';
import { imageDraftSchema, imageGeometry, isImageJob } from '../shared/image-replacement';
import { imageFilesForSettings } from '../shared/models';
import { defaults, type Asset, type Job } from '../shared/types';

const publicAsset = (asset: Asset) => ({ ...asset, path: '', poster: 'ready' });
export function registerImageRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, cloud: CloudManager, models: ModelManager) {
  const inputs = (ids: (string | null)[]) => { for (const id of ids) if (id && store.asset(id)?.kind !== 'image') throw new Error('Choose readable image inputs for image replacement.'); };
  app.post('/api/images/draft', (req, res) => {
    const value = imageDraftSchema.parse(req.body); inputs([value.sourceId, value.referenceId, value.faceId, value.maskId]);
    if (value.maskId && store.asset(value.maskId)?.maskFor !== value.sourceId) throw new Error('The edit mask belongs to another target. Paint the replacement area again.');
    store.set('image-draft', value); res.json(value);
  });
  const upload = multer({ dest: path.join(store.root, 'uploads'), limits: { files: 1, fileSize: 8 * 1024 ** 2, fields: 0 } });
  app.post('/api/images/mask/:sourceId', upload.single('file'), async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: 'Paint a replacement area first.' });
    try {
      const source = store.asset(String(req.params.sourceId)); if (!source || source.kind !== 'image') throw new Error('Choose a target photo before painting.');
      const info = await probe(req.file.path);
      if (Math.abs((info.width / info.height) / (source.width / source.height) - 1) > .02) throw new Error('The painted area does not match the target dimensions.');
      const mask = await ingest(store, req.file.path, 'image', 'Replacement area.png');
      mask.maskFor = source.id; store.addAsset(mask); res.status(201).json(publicAsset(mask));
    } finally { await rm(req.file.path, { force: true }); }
  });
  app.post('/api/images/source-frame', async (req, res) => {
    const value = z.object({ sourceId: z.string(), time: z.number().finite().nonnegative() }).parse(req.body);
    const source = store.asset(value.sourceId);
    if (!source || source.kind !== 'video' || value.time >= source.duration) throw new Error('Choose a frame inside your motion video.');
    const folder = path.join(store.root, 'uploads'); await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, randomUUID() + '.png');
    const time = Math.floor(value.time * 24) / 24;
    try {
      await command('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', source.path, '-frames:v', '1', temporary]);
      const asset = await ingest(store, temporary, 'image', `${source.name.replace(/\.[^.]+$/, '')} · ${time.toFixed(2)}s.png`);
      asset.sourceFrame = { videoId: source.id, time }; store.addAsset(asset); res.status(201).json(publicAsset(asset));
    } finally { await rm(temporary, { force: true }); }
  });
  app.post('/api/images/jobs', async (req, res) => {
    const value = imageDraftSchema.parse(req.body), key = req.get('Idempotency-Key');
    if (!key || key.length > 120) return void res.status(400).json({ error: 'An image request ID is required.' });
    const previous = store.byKey(key); if (previous) return void res.status(isImageJob(previous) ? 200 : 409).json(isImageJob(previous) ? publicJob(previous) : { error: 'This request ID was used for another workflow.' });
    if (!value.sourceId || !value.referenceId) throw new Error('Add a target image and an identity reference.');
    if (value.settings.model === 'qwen21') { value.settings.faceDetail = false; value.settings.identityRefine = false; }
    const scene = value.settings.model === 'qwen21' && value.settings.qwenRecipe === 'source-anchored';
    if (scene && !value.settings.protectBackground) throw new Error('Source-anchored replacement requires a painted edit area. Keep background protection on.');
    inputs([value.sourceId, value.referenceId, value.settings.faceDetail || value.settings.identityRefine || scene && value.settings.qwenHeadRefine ? value.faceId : null, value.settings.protectBackground ? value.maskId : null]);
    if (value.settings.protectBackground && (!value.maskId || store.asset(value.maskId)?.maskFor !== value.sourceId)) throw new Error('Paint the replacement area on this target, or turn off background protection.');
    const source = store.asset(value.sourceId)!, geometry = imageGeometry(source, value.settings.megapixels, value.settings.model);
    if (cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || (l.instanceId && l.safetyStatus === 'unconfirmed'))) return void res.status(503).json({ error: 'Wait for GPU setup or instance actions to settle before generating.' });
    if (connection.status.state !== 'online') return void res.status(503).json({ error: 'Connect the GPU before generating. Your image draft stays local.' });
    if (models.state.busy) return void res.status(409).json({ error: 'Finish model downloads before generating.' });
    await models.refresh();
    const accepted = store.byKey(key); if (accepted) return void res.json(publicJob(accepted));
    if (models.state.busy || cloud.state.busy || connection.status.state !== 'online') return void res.status(409).json({ error: 'GPU readiness changed during the check. Nothing was queued.' });
    if (models.state.error) return void res.status(503).json({ error: models.state.error });
    const missing = imageFilesForSettings(value.settings).filter(id => models.state.files.find(file => file.id === id)?.status !== 'installed');
    if (missing.length) return void res.status(409).json({ error: 'Download the selected image files first. No video models are needed.', missingModels: missing });
    const settings = { ...value.settings }; if (settings.randomSeed) settings.seed = randomInt(0, 0xffffffff);
    const title = source.sourceFrame ? `Frame ${source.sourceFrame.time.toFixed(2)}s / image replacement` : source.name.replace(/\.[^.]+$/, '').slice(0, 80) + ' / image replacement';
    const job: Job = { id: randomUUID(), title, status: 'queued', mediaType: 'image',
      sourceId: value.sourceId, referenceId: value.referenceId, settings: { ...defaults, prompt: settings.prompt, seed: settings.seed, randomSeed: settings.randomSeed },
      image: { version: scene ? 'scene-anchor-v2' : 'masked-latent-v4', settings, faceId: value.faceId, maskId: value.maskId, geometry }, width: geometry.width, height: geometry.height, outputSize: { width: source.width, height: source.height },
      createdAt: new Date().toISOString(), favorite: false, deleted: false, progress: { stage: 'Queued for image replacement', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: Date.now() },
      segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
    store.addJob(job, key); res.status(201).json(publicJob(job)); void runner.kick();
  });
  app.post('/api/images/jobs/:id/use', async (req, res) => {
    const job = store.job(String(req.params.id));
    if (!job || !isImageJob(job) || !job.image || job.deleted || job.status !== 'completed' || !job.output) throw new Error('Choose a completed image replacement.');
    let asset = job.image.resultAssetId ? store.asset(job.image.resultAssetId) : null;
    if (!asset) { asset = await ingest(store, job.output, 'image', job.title + '.png', true); job.image.resultAssetId = asset.id; store.saveJob(job); }
    const source = store.asset(job.sourceId), frame = source?.sourceFrame, video = frame ? store.asset(frame.videoId) : null;
    const draft = store.draft(); draft.referenceId = asset.id;
    draft.settings = { ...draft.settings, engine: 'viggle', mode: 'swap', fps: 24, orientation: 'source', loraA: 'None', loraB: 'None', referencePreparation: frame && video?.kind === 'video' ? 'prepared' : 'auto', seconds: Math.min(5, draft.settings.seconds) };
    if (frame && video?.kind === 'video') { draft.sourceId = video.id; draft.settings.start = frame.time; draft.settings.seconds = Math.min(5, draft.settings.seconds, Math.floor((video.duration - frame.time) * 24) / 24); }
    store.set('draft', draft); res.json({ asset: publicAsset(asset), draft });
  });
}
