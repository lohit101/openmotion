import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { Express } from 'express';
import { imageEditDraftSchema, emptyImageEditDraft, imageEditFiles, imageEditGeometry, imageEditVersion, isImageEditJob, type ImageEditDraft, type ImageEditReference } from '../shared/image-edit';
import { imageDefaults } from '../shared/image-replacement';
import { defaults, type Job } from '../shared/types';
import { publicJob, type Store } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { CloudManager } from './cloud';
import type { ModelManager } from './models';

export class ImageEditRequestError extends Error {
  constructor(public status: number, message: string, public missingModels?: string[]) { super(message); }
}
function existingRequest(store: Store, key: string) {
  const old = store.byKey(key);
  if (old && !isImageEditJob(old)) throw new ImageEditRequestError(409, 'This request ID belongs to another workflow.');
  return old;
}
export async function createImageEditJob(store: Store, connection: ConnectionManager, runner: Runner, cloud: CloudManager, models: ModelManager, draft: ImageEditDraft, key: string): Promise<Job> {
  const previous = existingRequest(store, key); if (previous) return previous;
  const value = imageEditDraftSchema.parse(draft), s = value.settings;
  if (!s.prompt.trim()) throw new ImageEditRequestError(400, 'Describe the edit you want to make.');
  if (!value.referenceIds.length) throw new ImageEditRequestError(400, 'Add at least one reference image.');
  const refs: ImageEditReference[] = [];
  for (const id of value.referenceIds) {
    const asset = store.asset(id);
    if (!asset || asset.kind !== 'image' || asset.maskFor) throw new ImageEditRequestError(400, 'Choose readable reference photos.');
    if (!/\.(png|jpe?g|webp)$/i.test(asset.path)) throw new ImageEditRequestError(400, 'Use PNG, JPEG or WebP references.');
    const info = await stat(asset.path);
    if (!info.isFile() || info.size > 10_000_000 || info.size <= 0) throw new ImageEditRequestError(400, 'Each reference must be a PNG, JPEG or WebP image under 10 MB.');
    imageEditGeometry({ ...s, aspect: 'source', resolution: '1k' }, asset);
    refs.push({ id, name: asset.name, sha256: createHash('sha256').update(await readFile(asset.path)).digest('hex'), size: info.size, width: asset.width, height: asset.height, ...(asset.sourceFrame ? { sourceFrame: { ...asset.sourceFrame } } : {}) });
  }
  const geometry = imageEditGeometry(s, refs[0]);
  const busy = () => cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || l.instanceId && l.safetyStatus === 'unconfirmed');
  if (busy()) throw new ImageEditRequestError(503, 'Wait for GPU setup or instance actions to finish.');
  if (connection.status.state !== 'online') throw new ImageEditRequestError(503, 'Connect the GPU before generating. Your Image Edit draft stays local.');
  if (models.state.busy || runner.externalGpuBusy()) throw new ImageEditRequestError(409, 'Wait for model downloads or facial processing to finish.');
  const instance = store.value('cloud-connected-instance', null), endpoint = connection.status.endpoint;
  await models.refresh();
  const raced = existingRequest(store, key); if (raced) return raced;
  if (busy() || models.state.busy || runner.externalGpuBusy() || connection.status.state !== 'online' || connection.status.endpoint !== endpoint || store.value('cloud-connected-instance', null) !== instance) throw new ImageEditRequestError(409, 'GPU readiness changed. Nothing was queued.');
  if (models.state.error) throw new ImageEditRequestError(503, models.state.error);
  const missing = imageEditFiles(s).filter(id => models.state.files.find(f => f.id === id)?.status !== 'installed');
  if (missing.length) throw new ImageEditRequestError(409, 'Download Image Edit for these settings before generating. Nothing was queued.', missing);
  const settings = { ...s, seed: s.randomSeed ? randomInt(0, 2 ** 32) : s.seed };
  const job: Job = {
    id: randomUUID(), title: refs[0].name + ' / Image Edit', mediaType: 'image', status: 'queued', sourceId: refs[0].id, referenceId: refs[1]?.id || refs[0].id,
    settings: { ...defaults, prompt: settings.prompt, seed: settings.seed, randomSeed: settings.randomSeed },
    image: { version: imageEditVersion, settings: { ...imageDefaults, model: 'qwen21', prompt: settings.prompt, seed: settings.seed, randomSeed: settings.randomSeed, protectBackground: false, faceDetail: false, identityRefine: false, localIdentity: false, qwenHeadRefine: false, qwenQuality: settings.quality === 'turbo' ? 'fast' : 'quality' }, edit: { settings, references: refs }, geometry, faceId: null, maskId: null },
    width: geometry.width, height: geometry.height, outputSize: { width: geometry.width, height: geometry.height }, createdAt: new Date().toISOString(), favorite: false, deleted: false,
    progress: { stage: 'Queued for Image Edit', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null,
  };
  store.addJob(job, key); void runner.kick(); return job;
}
export function registerImageEditRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, cloud: CloudManager, models: ModelManager) {
  app.get('/api/image-edit/draft', (_req, res) => res.json(imageEditDraftSchema.parse(store.value('image-edit-draft', emptyImageEditDraft()))));
  app.post('/api/image-edit/draft', (req, res) => {
    const value = imageEditDraftSchema.parse(req.body);
    if (value.referenceIds.some(id => store.asset(id)?.kind !== 'image' || store.asset(id)?.maskFor)) throw new ImageEditRequestError(400, 'Choose reference photos from this library.');
    store.set('image-edit-draft', value); res.json(value);
  });
  app.post('/api/image-edit/jobs', async (req, res) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key || key.length > 120) throw new ImageEditRequestError(400, 'An image request ID is required.');
      const value = imageEditDraftSchema.parse(req.body), old = existingRequest(store, key);
      const job = old || await createImageEditJob(store, connection, runner, cloud, models, value, key);
      res.status(old ? 200 : 201).json(publicJob(job));
    } catch (error) {
      if (error instanceof ImageEditRequestError) return void res.status(error.status).json({ error: error.message, ...(error.missingModels ? { missingModels: error.missingModels } : {}) });
      throw error;
    }
  });
}
