import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import type { Job } from '../shared/types';
import type { ImageReview } from '../shared/image-replacement';
import { command } from './media';
import type { Store } from './store';

export class ImageFinalizationError extends Error {}
export async function processImage(action: 'prepare' | 'finish', job: Job, store: Store, repo: string, folder: string, signal: AbortSignal): Promise<{ hasFace: boolean; warnings: string[] } | ImageReview> {
  if (!job.image) throw new Error('Missing image replacement settings.');
  const python = path.join(repo, '.local/geometry-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await access(python).catch(() => { throw new Error('Local image preparation is not ready. Start Recast with bash scripts/studio.sh once. No new GPU job was submitted.'); });
  const file = path.join(folder, 'image-request.json');
  const assetPath = (id: string | null) => id ? store.asset(id)?.path || (() => { throw new Error('An image input no longer exists.'); })() : null;
  await writeFile(file, JSON.stringify({ version: job.image.version, settings: job.image.settings, geometry: job.image.geometry, source: assetPath(job.sourceId), reference: assetPath(job.referenceId),
    face: job.image.settings.faceDetail || job.image.settings.identityRefine ? assetPath(job.image.faceId) : null, mask: job.image.settings.protectBackground ? assetPath(job.image.maskId) : null }));
  try {
    const result = await command(python, [path.join(repo, 'scripts/image_replacement.py'), action, '--request', file, '--folder', folder, '--model', path.join(repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx')], signal, 90000);
    return JSON.parse(result);
  } catch (error) {
    if (action === 'finish' && !signal.aborted) throw new ImageFinalizationError('The paid image is saved locally, but finalization needs another check: ' + (error as Error).message + ' Check & resume retries local processing without generating again.');
    throw error;
  }
}
