import { randomInt, randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { CloudManager } from './cloud';
import type { ModelManager } from './models';
import { characterForImage } from './characters';
import { imagenDraft, imagenGeometry, imagenPrompt, imagenWorkflows } from '../shared/imagen';
import { isImageJob, referenceViewIssue, type ImageDraft } from '../shared/image-replacement';
import { imageFilesForSettings } from '../shared/models';
import { defaults, type Job } from '../shared/types';

export class ImagenRequestError extends Error {
  constructor(public status: number, message: string, public missingModels?: string[]) { super(message); }
}
export async function createImagenJob(store: Store, connection: ConnectionManager, runner: Runner, cloud: CloudManager, models: ModelManager, draft: ImageDraft, key: string): Promise<Job> {
  const value = imagenDraft(draft), s = value.settings, mode = s.workflow!;
  if (draft.settings.model !== 'qwen21') throw new Error('Klein is disabled for new Imagen runs. Use Qwen Image 2.1.');
  const textOnly = mode === 'text-to-image', clothingOnly = mode === 'clothing-only';
  const sourceId = textOnly ? null : value.sourceId;
  const referenceId = textOnly ? null : clothingOnly ? value.clothingId : value.referenceId;
  const faceId = textOnly || clothingOnly ? null : value.faceId;
  const clothingId = mode === 'character-outfit' ? value.clothingId : null;
  if (textOnly && !s.prompt.trim()) throw new Error('Describe the image to create.');
  if (!textOnly && (!sourceId || !referenceId)) throw new Error(clothingOnly ? 'Add a target photo and a clothing reference.' : 'Add a target photo and a character reference.');
  for (const id of [sourceId, referenceId, faceId, clothingId]) {
    const asset = id && store.asset(id);
    if (id && (!asset || asset.kind !== 'image' || asset.maskFor)) throw new Error('Choose readable photos for the selected Imagen inputs.');
  }
  const character = !textOnly && !clothingOnly ? characterForImage(store, value) : undefined;
  if (!textOnly && !clothingOnly) for (const [view, id] of [[s.bodyReferenceView, referenceId], [s.faceReferenceView, faceId]] as const) {
    const issue = referenceViewIssue(view, id ? store.asset(id) : null); if (issue) throw new Error(issue);
  }
  const source = sourceId ? store.asset(sourceId)! : undefined;
  const geometry = imagenGeometry(s, source);
  if (cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || l.instanceId && l.safetyStatus === 'unconfirmed')) throw new ImagenRequestError(503, 'Wait for GPU setup or instance actions to settle.');
  if (connection.status.state !== 'online') throw new ImagenRequestError(503, 'Connect the GPU before generating. Your Imagen draft stays local.');
  if (models.state.busy || runner.externalGpuBusy()) throw new ImagenRequestError(409, 'Finish model downloads or facial processing before generating.');
  const instance = store.value('cloud-connected-instance', null), endpoint = connection.status.endpoint;
  await models.refresh();
  const existing = store.byKey(key); if (existing) { if (!isImageJob(existing)) throw new Error('This request ID belongs to another workflow.'); return existing; }
  if (models.state.busy || cloud.state.busy || runner.externalGpuBusy() || connection.status.state !== 'online' || connection.status.endpoint !== endpoint || store.value('cloud-connected-instance', null) !== instance) throw new ImagenRequestError(409, 'GPU readiness changed. Nothing was queued.');
  if (models.state.error) throw new ImagenRequestError(503, models.state.error);
  const missing = imageFilesForSettings(s).filter(id => models.state.files.find(file => file.id === id)?.status !== 'installed');
  if (missing.length) throw new ImagenRequestError(409, 'Use Download Imagen to prepare the selected files. Nothing was queued.', missing);
  const settings = { ...s, seed: s.randomSeed ? randomInt(0, 2 ** 32) : s.seed };
  const label = imagenWorkflows.find(item => item.id === mode)!.label;
  const job: Job = {
    id: randomUUID(), title: (source?.name || settings.prompt.slice(0, 60) || 'New image') + ' / ' + label,
    mediaType: 'image', status: 'queued', sourceId: sourceId || '', referenceId: referenceId || '',
    settings: { ...defaults, prompt: settings.prompt, seed: settings.seed, randomSeed: settings.randomSeed },
    image: { version: 'imagen-v1', settings, geometry, faceId, clothingId, maskId: null, ...(character ? { character } : {}), conditioningPrompt: imagenPrompt(settings, !!faceId, !!clothingId) },
    width: geometry.width, height: geometry.height, outputSize: { width: geometry.outputWidth, height: geometry.outputHeight },
    createdAt: new Date().toISOString(), favorite: false, deleted: false,
    progress: { stage: 'Queued for Imagen', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null,
  };
  store.addJob(job, key); void runner.kick(); return job;
}
