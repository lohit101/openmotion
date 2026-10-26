/** Export standalone native ComfyUI image graphs; no downloads or GPU jobs. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaults, type Job } from '../shared/types';
import { imageDefaults, imageGeometry } from '../shared/image-replacement';
import { compileImageWorkflow } from '../server/image-workflow';

for (const protectBackground of [false, true]) {
  const geometry = imageGeometry({ width: 1024, height: 1024 }, 1);
  // Use a square canvas with no preparation padding for portable examples.
  Object.assign(geometry, { width: 1024, height: 1024, contentWidth: 1024, contentHeight: 1024, x: 0, y: 0 });
  const job: Job = { id: 'klein-image-replacement', title: 'Klein image replacement', mediaType: 'image', status: 'queued', settings: defaults,
    image: { version: 'masked-latent-v2', settings: { ...imageDefaults, faceDetail: false, protectBackground }, geometry, faceId: null, maskId: protectBackground ? 'mask' : null },
    sourceId: '', referenceId: '', width: 1024, height: 1024, outputSize: { width: 1024, height: 1024 },
    createdAt: '', favorite: false, deleted: false, progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: 0 },
    segments: [], context: '', pendingPrompt: null, uploads: { source: 'target.png', reference: 'identity.png', ...(protectBackground ? { original: 'target.png', mask: 'edit-mask.png', noiseMask: 'edit-mask.png' } : {}) }, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
  writeFileSync(path.resolve(import.meta.dirname, `../../workflows/experimental/api/klein4b_image_${protectBackground ? 'masked' : 'replacement'}.json`), JSON.stringify(compileImageWorkflow(job), null, 2) + '\n');
}
