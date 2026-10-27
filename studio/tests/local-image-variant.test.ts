import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/store';
import { importImageVariant } from '../server/local-image-variant';
import { defaults, type Job } from '../shared/types';
import { imageDefaults, imageGeometry } from '../shared/image-replacement';

const roots: string[] = [], stores: Store[] = [];
afterEach(() => { stores.forEach(s => s.close()); stores.length = 0; roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0; });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'framing-')); roots.push(root);
  const store = new Store(path.join(root, 'data')); stores.push(store);
  const parentFolder = path.join(store.root, 'jobs', 'parent'), folder = path.join(root, 'variant'); mkdirSync(parentFolder); mkdirSync(folder);
  const hash = (v: string) => createHash('sha256').update(v).digest('hex');
  writeFileSync(path.join(parentFolder, 'final.png'), 'accepted'); writeFileSync(path.join(parentFolder, 'original.png'), 'source');
  for (const [name, value] of [['final.png', 'framed'], ['edit-mask.png', 'mask'], ['actor-matte.png', 'matte'], ['poster.jpg', 'poster']]) writeFileSync(path.join(folder, name), value);
  const receipt = { version: 'foreground-scale-v1', scale: 1.25, matrix: [[1.25, 0, 2], [0, 1.25, 3]], width: 64, height: 64, parentSHA256: hash('accepted'), sourceSHA256: hash('source'), resultSHA256: hash('framed'), maskSHA256: hash('mask'), matteSHA256: hash('matte'), elapsedSeconds: .4, paidInference: false, geometry: null };
  writeFileSync(path.join(folder, 'framing.json'), JSON.stringify(receipt));
  writeFileSync(path.join(folder, 'image-review.json'), JSON.stringify({ backgroundProtected: true, outsideMaskMaxDifference: 0, warnings: [], sourceFace: true, referenceFace: false, outputFace: true, status: 'review' }));
  const parent: Job = { id: 'parent', title: 'Accepted', status: 'completed', settings: defaults, sourceId: 'source', referenceId: 'reference', createdAt: '2026-10-27', favorite: true, deleted: false, width: 64, height: 64, image: { settings: imageDefaults, geometry: imageGeometry({ width: 64, height: 64 }, 1), faceId: null, maskId: 'mask' }, mediaType: 'image', segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: path.join(parentFolder, 'final.png'), poster: null, cancelRequested: false, elapsedSeconds: 200, origin: 'render', workflow: {}, progress: { stage: 'Completed', node: null, value: 1, max: 1, unit: 'image', segment: 1, segments: 1, completedFrames: 1, targetFrames: 1, updatedAt: 0 } };
  store.addJob(parent);
  return { store, parent, folder, receipt };
}
it('saves a separate local derivative once, with no render queue or parent mutation', () => {
  const { store, parent, folder } = fixture();
  const variant = importImageVariant(store, parent.id, folder, 'Closer framing');
  expect(variant).toMatchObject({ origin: 'import', status: 'completed', workflow: null, uploads: null, pendingPrompt: null, segments: [], image: { localFraming: { parentJobId: parent.id, paidInference: false } } });
  expect(store.job(parent.id)).toEqual(parent); expect(readFileSync(parent.output!, 'utf8')).toBe('accepted');
  expect(importImageVariant(store, parent.id, folder, 'Again').id).toBe(variant.id); expect(store.jobs()).toHaveLength(2);
});
it('rejects altered media and nonuniform body scaling without importing a result', () => {
  const { store, parent, folder, receipt } = fixture();
  writeFileSync(path.join(folder, 'final.png'), 'altered');
  expect(() => importImageVariant(store, parent.id, folder, 'Bad')).toThrow('changed after validation');
  writeFileSync(path.join(folder, 'final.png'), 'framed'); receipt.matrix[1][1] = 1.1;
  writeFileSync(path.join(folder, 'framing.json'), JSON.stringify(receipt));
  expect(() => importImageVariant(store, parent.id, folder, 'Bad')).toThrow('uniform scale'); expect(store.jobs()).toHaveLength(1);
});
