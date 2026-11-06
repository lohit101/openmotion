import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import type { Job } from '../shared/types';
import type { ImageReview } from '../shared/image-replacement';
import type { ImageRun } from '../shared/image-replacement';
import { command } from './media';
import type { Store } from './store';

export class ImageFinalizationError extends Error {}
export async function processImage(action: 'prepare' | 'finish', job: Job, store: Store, repo: string, folder: string, signal: AbortSignal): Promise<NonNullable<ImageRun['prepared']> | ImageReview> {
  if (!job.image) throw new Error('Missing image replacement settings.');
  const python = path.join(repo, '.local/geometry-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await access(python).catch(() => { throw new Error('Local image preparation is not ready. Start Recast with bash scripts/studio.sh once. No new GPU job was submitted.'); });
  const file = path.join(folder, 'image-request.json');
  const assetPath = (id: string | null) => id ? store.asset(id)?.path || (() => { throw new Error('An image input no longer exists.'); })() : null;
  if (job.image.version === 'image-edit-2511-v1') {
    if (!job.image.edit) throw new Error('The frozen Image Edit recipe is missing.');
    await writeFile(file, JSON.stringify({ version: job.image.version, settings: job.image.edit.settings, geometry: job.image.geometry,
      references: job.image.edit.references.map(ref => ({ ...ref, path: assetPath(ref.id) })) }));
    try { return JSON.parse(await command(python, [path.join(repo, 'scripts/image_edit.py'), action, '--request', file, '--folder', folder], signal, 90000)); }
    catch (error) { if (action === 'finish' && !signal.aborted) throw new ImageFinalizationError('The native image is saved. Check & resume retries local export without generating again: ' + (error as Error).message); throw error; }
  }
  if (job.image.version === 'imagen-v1') {
    await writeFile(file, JSON.stringify({ version: 'imagen-v1', settings: job.image.settings, geometry: job.image.geometry,
      source: assetPath(job.sourceId), reference: assetPath(job.referenceId), face: assetPath(job.image.faceId), clothing: assetPath(job.image.clothingId || null) }));
    try { return JSON.parse(await command(python, [path.join(repo, 'scripts/imagen_image.py'), action, '--request', file, '--folder', folder], signal, 90000)); }
    catch (error) { if (action === 'finish' && !signal.aborted) throw new ImageFinalizationError('The paid image is saved. Check & resume retries local PNG finalization without generating again: ' + (error as Error).message); throw error; }
  }
  const reused = job.image.reusedBody;
  const bodyBase = reused ? store.job(reused.jobId)?.output : null;
  if (reused && !bodyBase) throw new Error('The saved body image is unavailable. It will not be regenerated automatically.');
  await writeFile(file, JSON.stringify({ version: job.image.version, settings: job.image.settings, geometry: job.image.geometry, source: assetPath(job.sourceId), reference: assetPath(job.referenceId), ...(job.image.scopeMaskId ? { scopeMask: assetPath(job.image.scopeMaskId) } : {}), ...(reused ? { bodyBase, bodyBaseSHA256: reused.sha256 } : {}),
    face: job.image.version?.startsWith('body-only-') || job.image.settings.faceDetail || job.image.settings.identityRefine || (job.image.version?.startsWith('scene-anchor-') || ['native-mask-v1', 'native-scene-v1', 'identity-first-v1', 'identity-first-v2', 'body-identity-v1', 'body-identity-v2'].includes(job.image.version || '')) && job.image.settings.qwenHeadRefine ? assetPath(job.image.faceId) : null, mask: job.image.settings.protectBackground ? assetPath(job.image.maskId) : null }));
  try {
    const result = await command(python, [path.join(repo, 'scripts/image_replacement.py'), action, '--request', file, '--folder', folder, '--model', path.join(repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx')], signal, 90000);
    return JSON.parse(result);
  } catch (error) {
    if (action === 'finish' && !signal.aborted) throw new ImageFinalizationError('The paid image is saved locally, but finalization needs another check: ' + (error as Error).message + ' Check & resume retries local processing without generating again.');
    throw error;
  }
}
