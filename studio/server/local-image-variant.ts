import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isImageJob, localFramingSchema, type ImageReview } from '../shared/image-replacement';
import { outputDimensions, type Job } from '../shared/types';
import type { Store } from './store';

const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Import an explicitly reviewed CPU derivative. Never queues work or changes its parent. */
export function importImageVariant(store: Store, parentId: string, inputFolder: string, title: string): Job {
  const parent = store.job(parentId);
  if (!parent || !isImageJob(parent) || !parent.image || parent.status !== 'completed' || !parent.output) throw new Error('Choose a completed parent image.');
  const receipt = localFramingSchema.parse(JSON.parse(readFileSync(path.join(inputFolder, 'framing.json'), 'utf8')));
  const parentFolder = path.join(store.root, 'jobs', parent.id);
  const [width, height] = outputDimensions(parent);
  if (receipt.width !== width || receipt.height !== height || receipt.parentSHA256 !== hash(parent.output) || receipt.sourceSHA256 !== hash(path.join(parentFolder, 'original.png'))) throw new Error('Framing receipt does not match the immutable parent/source.');
  if (receipt.resultSHA256 !== hash(path.join(inputFolder, 'final.png')) || receipt.maskSHA256 !== hash(path.join(inputFolder, 'edit-mask.png')) || receipt.matteSHA256 !== hash(path.join(inputFolder, 'actor-matte.png'))) throw new Error('Framing files changed after validation.');
  const [[sx, xy], [yx, sy]] = receipt.matrix;
  if (Math.abs(sx - receipt.scale) > 1e-6 || Math.abs(sy - receipt.scale) > 1e-6 || xy !== 0 || yx !== 0) throw new Error('Use uniform scale and translation only.');
  const key = `local-framing:${parent.id}:${receipt.resultSHA256}`, existing = store.byKey(key);
  if (existing) return existing;
  const id = randomUUID(), folder = path.join(store.root, 'jobs', id), time = new Date().toISOString();
  const review: ImageReview = JSON.parse(readFileSync(path.join(inputFolder, 'image-review.json'), 'utf8'));
  if (!review.backgroundProtected || review.outsideMaskMaxDifference !== 0) throw new Error('Protected source pixels must be preserved.');
  const localFraming = { ...receipt, parentJobId: parent.id };
  mkdirSync(folder);
  try {
    copyFileSync(path.join(parentFolder, 'original.png'), path.join(folder, 'original.png'));
    for (const name of ['final.png', 'edit-mask.png', 'actor-matte.png', 'poster.jpg', 'source-face.png', 'output-face.png']) {
      if (existsSync(path.join(inputFolder, name))) copyFileSync(path.join(inputFolder, name), path.join(folder, name));
    }
    if (existsSync(path.join(parentFolder, 'reference-face.png'))) { copyFileSync(path.join(parentFolder, 'reference-face.png'), path.join(folder, 'reference-face.png')); review.referenceFace = true; }
    writeFileSync(path.join(folder, 'framing.json'), JSON.stringify(localFraming, null, 2) + '\n');
    writeFileSync(path.join(folder, 'image-review.json'), JSON.stringify(review, null, 2) + '\n');
    const job: Job = { ...structuredClone(parent), id, title, createdAt: time, startedAt: time, finishedAt: time, favorite: true, deleted: false,
      image: { ...structuredClone(parent.image), resultAssetId: undefined, localFraming, review }, origin: 'import',
      output: path.join(folder, 'final.png'), poster: path.join(folder, 'poster.jpg'), elapsedSeconds: receipt.elapsedSeconds,
      segments: [], context: '', uploads: null, workflow: null, timings: [], pendingPrompt: null, submitting: false, retryRequired: false,
      cancelRequested: false, cancellationConfirmed: undefined, error: null,
      progress: { stage: 'Local framing complete', node: null, value: 1, max: 1, unit: 'image', segment: 1, segments: 1, completedFrames: 1, targetFrames: 1, updatedAt: Date.now() } };
    store.addJob(job, key); return job;
  } catch (error) { rmSync(folder, { recursive: true, force: true }); throw error; }
}
