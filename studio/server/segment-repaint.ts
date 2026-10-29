import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './store';
import { command, ingest } from './media';
import { characterForImage } from './characters';
import { bodyOnlyConditioningPrompt, conciseFaceRefreshPrompt, emptyImageDraft, imageGeometry, sourceFrameImageSettings } from '../shared/image-replacement';
import { defaults, type Job, type Settings } from '../shared/types';
import type { ViggleRepaintRun } from '../shared/segment-repaint';
import { viggleWindow } from '../shared/viggle-segments';

export class RepaintWaitError extends Error {}
export const fileSHA256 = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex');

/** Check the existing local tools and frozen references before the first paid window. */
export async function assertRepaintReady(repo: string, store: Store, state: ViggleRepaintRun) {
  const required = [path.join(repo, '.local/geometry-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    path.join(repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx')];
  for (const file of required) await access(file).catch(() => { throw new Error('Local segment face preparation is not ready. Run bash scripts/studio.sh once before generating. Nothing was queued or downloaded.'); });
  for (const id of [state.character.bodyId, state.character.faceId]) {
    const asset = store.asset(id);
    if (!asset) throw new Error('A saved character sheet is missing. Restore it before generating. Nothing was queued.');
    await access(asset.path).catch(() => { throw new Error('A saved character sheet is no longer readable. Restore it before generating. Nothing was queued.'); });
  }
}

/** Resolve once at video creation. Later character edits cannot change this job. */
export function resolveRepaintProfile(store: Store, settings: Settings, referenceId: string, sourceId: string): ViggleRepaintRun | undefined {
  const profile = settings.imagenRepaint; if (!settings.imagenRepaintEnabled) return;
  if (!profile?.bodyView || !profile.faceView) throw new Error('Select the character body and facial views before enabling segment refresh.');
  let character;
  if (profile.sourceImageJobId) {
    const photo = store.job(profile.sourceImageJobId);
    if (!photo || photo.deleted || photo.status !== 'completed' || photo.image?.resultAssetId !== referenceId || !photo.image.character) throw new Error('The starting Imagen photo no longer matches this prepared frame. Use that image in Remotion again.');
    const saved = photo.image.character;
    if (saved.id !== profile.characterId || saved.revision !== profile.revision || JSON.stringify(saved.bodyView) !== JSON.stringify(profile.bodyView) || JSON.stringify(saved.faceView) !== JSON.stringify(profile.faceView)) throw new Error('The selected character differs from the starting photo. Review the character before generating.');
    const frame = store.asset(photo.sourceId)?.sourceFrame;
    if (!frame || frame.videoId !== sourceId || Math.abs(frame.time - (settings.referenceTime ?? settings.start)) > 1 / 48) throw new Error('The prepared Imagen frame belongs to a different video or reference moment. Prepare a matching frame first.');
    character = structuredClone(saved);
  } else {
    const c = store.character(profile.characterId);
    if (!c || c.archived || c.revision !== profile.revision) throw new Error('The selected character changed. Select it again before generating.');
    const draft = { ...emptyImageDraft(), referenceMode: 'character' as const, characterId: c.id, characterRevision: c.revision, referenceId: c.bodyId, faceId: c.faceId,
      settings: { ...sourceFrameImageSettings(), bodyReferenceView: profile.bodyView, faceReferenceView: profile.faceView } };
    character = characterForImage(store, draft)!;
  }
  return { version: 'imagen-face-v1', imageRecipe: 'concise-v1', character, imageSettings: { ...sourceFrameImageSettings(), bodyReferenceView: character.bodyView, faceReferenceView: character.faceView }, records: [{ segment: 1, frame: 0, status: 'provided' }], ...(profile.sourceImageJobId ? { initialImageJobId: profile.sourceImageJobId } : {}) };
}

export interface RepaintHost {
  store: Store; repo: string; stage: (job: Job, text: string) => void; save: (job: Job) => void;
  runPhoto: (photo: Job, signal: AbortSignal) => Promise<void>; recoverPhoto: (photo: Job) => Promise<void>;
  targetPreparer?: RepaintTargetPreparer;
}
export interface PreparedRepaintTarget { outputs: Record<string, string>; inputs: { anchorSHA256: string }; repaint: boolean; warning: string | null; }
export type RepaintTargetPreparer = (job: Job, folder: string, signal: AbortSignal) => Promise<PreparedRepaintTarget>;

/** Called only after an explicit paid-retry action and a GPU queue/history check. */
export function replaceFailedRepaint(store: Store, parent: Job, old: Job): Job {
  const state = parent.viggleRepaint, record = state?.records.find(r => r.photoJobId === old.id);
  if (!state || !record || old.image?.segmentRepaint?.videoJobId !== parent.id || parent.pendingPrompt) throw new Error('The failed photo no longer matches the current segment boundary.');
  const key = `segment-repaint-retry:${parent.id}:${old.id}`;
  let photo = store.byKey(key);
  if (!photo) {
    photo = structuredClone(old);
    Object.assign(photo, { id: randomUUID(), title: `Segment ${record.segment} · ${state.character.name} face refresh · retry`, status: 'queued', createdAt: new Date().toISOString(), startedAt: undefined, finishedAt: undefined, favorite: false, deleted: false, segments: [], uploads: null, pendingPrompt: null, submitting: false, cancellationConfirmed: false, cancelRequested: false, retryRequired: false, error: null, output: null, poster: null, workflow: null, elapsedSeconds: null, timings: [] });
    photo.progress = { ...photo.progress, stage: 'Queued for requested face-refresh retry', node: null, value: null, max: null, completedFrames: 0, updatedAt: Date.now() };
    delete photo.image!.prepared; delete photo.image!.review; delete photo.image!.resultAssetId;
    store.addJob(photo, key);
  }
  record.previousPhotoJobIds = [...(record.previousPhotoJobIds || []), old.id]; record.photoJobId = photo.id; record.status = 'rendering'; state.activePhotoId = photo.id; delete state.photoProgress;
  store.saveJob(parent); return photo;
}

/** Serial child photo inference. A successful child/receipt is always reused. */
export async function prepareSegmentRepaint(host: RepaintHost, job: Job, signal: AbortSignal): Promise<string> {
  const state = job.viggleRepaint, index = job.segments.length;
  if (!state || !index || !['last-frame-v2', 'encoded-overlap-v3'].includes(job.viggleSegmentation || '')) throw new RepaintWaitError('Imagen refresh requires the saved previous-frame continuation.');
  const segment = index + 1, frame = job.progress.completedFrames - 1, folder = path.join(host.store.root, 'jobs', job.id, `repaint_${String(index).padStart(4, '0')}`);
  await mkdir(folder, { recursive: true });
  let record = state.records.find(r => r.segment === segment);
  if (record && record.frame !== frame) throw new RepaintWaitError('The saved identity refresh belongs to a different segment range.');
  if (!record) { record = { segment, frame, status: 'preparing' }; state.records.push(record); host.save(job); }
  const reference = path.join(folder, 'reference.png');
  if (record.referenceSHA256 && ['completed', 'skipped'].includes(record.status)) {
    if (await fileSHA256(reference).catch(() => '') !== record.referenceSHA256) {
      const savedPhoto = record.photoJobId && host.store.job(record.photoJobId);
      const recovery = record.status === 'skipped' ? path.join(folder, 'target.png') : savedPhoto && savedPhoto.status === 'completed' ? savedPhoto.output : null;
      if (!recovery || await fileSHA256(recovery).catch(() => '') !== record.referenceSHA256) throw new RepaintWaitError('The saved repainted frame is missing or changed. Restore its saved photo; completed video segments will not be generated again.');
      await copyFile(recovery, reference);
    }
    return reference;
  }
  host.stage(job, `Refreshing facial identity · segment ${segment} of ${job.progress.segments}`);
  const key = `segment-repaint:${job.id}:${index}`;
  let photo = record.photoJobId ? host.store.job(record.photoJobId) : host.store.byKey(key);
  if (!photo) {
    const plan = viggleWindow(job.progress.completedFrames, job.progress.targetFrames), anchor = path.join(host.store.root, 'jobs', job.id, `context_${index - 1}.safetensors`);
    const python = path.join(host.repo, '.local/geometry-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const prepared: PreparedRepaintTarget = host.targetPreparer ? await host.targetPreparer(job, folder, signal) : JSON.parse(await command(python, [path.join(host.repo, 'scripts/segment_repaint.py'), '--anchor', anchor, '--job', job.id, '--width', String(job.width), '--height', String(job.height), '--skip', String(plan.skip), '--overlap', String(plan.overlap), '--folder', folder, '--model', path.join(host.repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx'), ...(job.viggleSegmentation === 'encoded-overlap-v3' ? ['--context-version', job.viggleSegmentation] : [])], signal, 60000));
    record.targetSHA256 = prepared.outputs['target.png']; record.anchorSHA256 = prepared.inputs.anchorSHA256;
    if (!prepared.repaint) {
      await copyFile(path.join(folder, 'target.png'), reference); record.referenceSHA256 = await fileSHA256(reference); record.referenceFile = path.relative(path.join(host.store.root, 'jobs', job.id), reference); record.status = 'skipped'; record.warning = prepared.warning || 'No clear face was available; the exact raw reference was retained.'; host.save(job); return reference;
    }
    const target = await ingest(host.store, path.join(folder, 'target.png'), 'image', `Segment ${segment} · previous raw appearance.png`, true);
    const scope = await ingest(host.store, path.join(folder, 'scope-mask.png'), 'image', `Segment ${segment} · facial edit scope.png`, true); scope.maskFor = target.id; host.store.addAsset(scope);
    const settings = structuredClone(state.imageSettings), geometry = imageGeometry(target, settings.megapixels, 'qwen21');
    photo = { id: randomUUID(), title: `Segment ${segment} · ${state.character.name} face refresh`, mediaType: 'image', status: 'queued', origin: 'render', sourceId: target.id, referenceId: state.character.bodyId,
      settings: { ...defaults, prompt: settings.prompt, seed: settings.seed, randomSeed: false }, image: { version: state.imageRecipe === 'concise-v1' ? 'body-only-v7' : 'body-only-v2', settings, geometry, faceId: state.character.faceId, maskId: scope.id, scopeMaskId: scope.id,
        character: structuredClone(state.character), segmentRepaint: { videoJobId: job.id, segment, frame },
        conditioningPrompt: state.imageRecipe === 'concise-v1' ? conciseFaceRefreshPrompt : bodyOnlyConditioningPrompt(settings.prompt) + '\nRefresh only the visible facial identity from the selected facial reference. Keep the current head rotation, gaze, mouth opening and expression, existing hair, body, clothes and accessories. Preserve foreground obstructions and do not reveal a hidden face.' },
      width: geometry.width, height: geometry.height, outputSize: { width: target.width, height: target.height }, createdAt: new Date().toISOString(), favorite: false, deleted: false,
      progress: { stage: 'Queued for segment face refresh', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: Date.now() },
      segments: [], context: '', uploads: null, pendingPrompt: null, workflow: null, error: null, output: null, poster: null, elapsedSeconds: null, cancelRequested: false };
    host.store.addJob(photo, key);
  }
  if (photo.image?.segmentRepaint?.videoJobId !== job.id || photo.image.segmentRepaint.segment !== segment || photo.image.segmentRepaint.frame !== frame || JSON.stringify(photo.image.character) !== JSON.stringify(state.character)) throw new RepaintWaitError('The saved photo refresh does not belong to this video, character or frame range.');
  record.photoJobId = photo.id; record.status = 'rendering'; state.activePhotoId = photo.id; host.save(job);
  if (photo.status !== 'completed') {
    if (['interrupted', 'failed', 'cancelled'].includes(photo.status)) {
      if (photo.pendingPrompt || photo.submitting || photo.progress.completedFrames >= 1) await host.recoverPhoto(photo);
      else throw new RepaintWaitError(`Segment ${segment}'s saved photo needs attention. Open its image details and check or retry it; no new paid image or video was submitted.`);
      if (photo.status !== 'queued') throw new RepaintWaitError(`The saved segment ${segment} photo cannot be resumed without a requested retry. Earlier paid segments remain unchanged.`);
    }
    await host.runPhoto(photo, signal);
  }
  const completed = host.store.job(photo.id)!;
  if (completed.status !== 'completed' || !completed.output) throw new RepaintWaitError(`Segment ${segment}'s Imagen refresh is ${completed.status}: ${completed.error || 'Check its saved photo.'} Earlier video segments are retained; nothing was resubmitted.`);
  await copyFile(completed.output, reference); record.referenceSHA256 = await fileSHA256(reference); record.referenceFile = path.relative(path.join(host.store.root, 'jobs', job.id), reference); record.status = 'completed';
  delete state.activePhotoId; delete state.photoProgress; host.save(job);
  return reference;
}
