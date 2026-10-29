import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { assertRepaintReady, fileSHA256, prepareSegmentRepaint, replaceFailedRepaint, resolveRepaintProfile } from '../server/segment-repaint';
import { defaults, type Asset, type Job } from '../shared/types';
import { imageGeometry, sourceFrameImageSettings } from '../shared/image-replacement';
import { snapshotCharacter, type Character } from '../shared/characters';

const roots: string[] = [], stores: Store[] = [];
afterEach(() => { stores.forEach(s => s.close()); roots.forEach(r => rmSync(r, { recursive: true, force: true })); stores.length = 0; roots.length = 0; });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'segment-repaint-')); roots.push(root); const store = new Store(root); stores.push(store);
  const c: Character = { id: 'character', name: 'Frozen character', revision: 1, bodyId: 'body', faceId: 'face', bodyView: { assetId: 'body', x: 0, y: 0, width: 64, height: 96 }, faceView: { assetId: 'face', x: 0, y: 0, width: 64, height: 96 }, createdAt: '', updatedAt: '', archived: false };
  store.saveCharacter(c);
  for (const id of ['body', 'face', 'source', 'prepared']) store.addAsset({ id, kind: 'image', width: 64, height: 96, name: id, path: '/private/' + id, poster: '', duration: 0, fps: 0, size: 1, hasAudio: false, createdAt: '', ...(id === 'source' ? { sourceFrame: { videoId: 'video', time: 0 } } : {}) });
  const parent: Job = { id: 'video-job', title: 'Video', status: 'interrupted', sourceId: 'video', referenceId: 'prepared', settings: { ...defaults, engine: 'viggle', fps: 24, seconds: 10, referencePreparation: 'prepared', imagenRepaintEnabled: true, imagenRepaint: { characterId: c.id, revision: c.revision, bodyView: c.bodyView, faceView: c.faceView, sourceImageJobId: null } },
    width: 64, height: 96, createdAt: '', favorite: false, deleted: false, viggleSegmentation: 'last-frame-v2', viggleRepaint: { version: 'imagen-face-v1', character: snapshotCharacter(c), imageSettings: sourceFrameImageSettings(), records: [{ segment: 2, frame: 123, status: 'rendering', photoJobId: 'photo' }], activePhotoId: 'photo' },
    progress: { stage: '', node: null, value: null, max: null, unit: 'steps', segment: 2, segments: 2, completedFrames: 124, targetFrames: 240, updatedAt: 0 }, segments: [{ promptId: 'paid', frames: 124, seconds: 1, file: 'paid.mp4' }], context: 'context', uploads: null, pendingPrompt: null, output: null, poster: null, workflow: null, error: 'Photo needs attention', elapsedSeconds: null, origin: 'render', cancelRequested: false };
  const photo: Job = { ...structuredClone(parent), id: 'photo', mediaType: 'image', sourceId: 'source', referenceId: 'body', segments: [], viggleRepaint: undefined, viggleSegmentation: undefined,
    image: { version: 'body-only-v2', settings: sourceFrameImageSettings(), geometry: imageGeometry({ width: 64, height: 96 }, 1, 'qwen21'), maskId: 'mask', faceId: 'face', character: snapshotCharacter(c), segmentRepaint: { videoJobId: parent.id, segment: 2, frame: 123 } },
    progress: { ...parent.progress, completedFrames: 0, targetFrames: 1 } };
  store.addJob(parent); store.addJob(photo); return { root, store, parent, photo, c };
}
it('freezes current profile views and rejects changed manual selections before paid work', () => {
  const { store, parent, c } = fixture();
  const result = resolveRepaintProfile(store, parent.settings, parent.referenceId, parent.sourceId)!;
  store.saveCharacter({ ...c, revision: 2, name: 'Changed', archived: true });
  expect(result.character).toEqual(snapshotCharacter(c));
  expect(() => resolveRepaintProfile(store, parent.settings, parent.referenceId, parent.sourceId)).toThrow('character changed');
  expect(resolveRepaintProfile(store, { ...parent.settings, imagenRepaintEnabled: false }, parent.referenceId, parent.sourceId)).toBeUndefined();
});
it('rejects missing local preparation and missing character files before paid work', async () => {
  const { root, store, parent } = fixture(), state = parent.viggleRepaint!;
  await expect(assertRepaintReady(root, store, state)).rejects.toThrow('Nothing was queued');
  for (const relative of ['.local/geometry-venv/' + (process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), '.local/geometry-models/face_detection_yunet_2023mar.onnx']) {
    const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'fixture');
  }
  await expect(assertRepaintReady(root, store, state)).rejects.toThrow('no longer readable');
  for (const id of ['body', 'face']) { const asset = store.asset(id)!; asset.path = path.join(root, id); writeFileSync(asset.path, 'saved sheet'); store.addAsset(asset); }
  await expect(assertRepaintReady(root, store, state)).resolves.toBeUndefined();
});
it('uses the immutable starting photo snapshot even after library edits, while checking the video/start binding', () => {
  const { store, parent, photo, c } = fixture();
  photo.status = 'completed'; photo.image!.resultAssetId = 'prepared'; photo.output = '/saved/photo.png'; store.saveJob(photo);
  parent.settings.imagenRepaint!.sourceImageJobId = photo.id;
  store.saveCharacter({ ...c, revision: 2, name: 'Changed', archived: true });
  expect(resolveRepaintProfile(store, parent.settings, 'prepared', 'video')!.character.name).toBe('Frozen character');
  expect(() => resolveRepaintProfile(store, { ...parent.settings, start: 1 }, 'prepared', 'video')).toThrow('different video or reference moment');
  expect(() => resolveRepaintProfile(store, parent.settings, 'other-prepared-image', 'video')).toThrow('no longer matches');
});
it('restores a missing local reference from its saved paid photo without new inference', async () => {
  const { root, store, parent, photo } = fixture(); const folder = path.join(root, 'jobs', parent.id, 'repaint_0001'); mkdirSync(folder, { recursive: true });
  const output = path.join(root, 'paid.png'); writeFileSync(output, 'paid pixels'); photo.status = 'completed'; photo.output = output; store.saveJob(photo);
  Object.assign(parent.viggleRepaint!.records[0], { status: 'completed', referenceSHA256: await fileSHA256(output) });
  const runPhoto = vi.fn(), recoverPhoto = vi.fn();
  const file = await prepareSegmentRepaint({ store, repo: '', save: j => store.saveJob(j), stage: vi.fn(), runPhoto, recoverPhoto }, parent, new AbortController().signal);
  expect(readFileSync(file, 'utf8')).toBe('paid pixels'); expect(runPhoto).not.toHaveBeenCalled(); expect(recoverPhoto).not.toHaveBeenCalled();
});
it('never calls inference when recovery reports a missing paid photo that needs an explicit retry', async () => {
  const { store, parent, photo } = fixture(); photo.submitting = true; photo.status = 'interrupted'; store.saveJob(photo);
  const runPhoto = vi.fn(), recoverPhoto = vi.fn(async (p: Job) => { p.retryRequired = true; p.status = 'interrupted'; });
  await expect(prepareSegmentRepaint({ store, repo: '', save: j => store.saveJob(j), stage: vi.fn(), runPhoto, recoverPhoto }, parent, new AbortController().signal)).rejects.toThrow('requested retry');
  expect(runPhoto).not.toHaveBeenCalled(); expect(store.jobs()).toHaveLength(2);
});
it('an explicitly requested retry gets a new child and preserves the failed receipt and all video pixels', () => {
  const { store, parent, photo } = fixture(); photo.status = 'failed'; photo.error = 'Native failure'; photo.workflow = { saved: { class_type: 'KSampler', inputs: {} } }; store.saveJob(photo);
  const old = structuredClone(store.job(photo.id));
  const retry = replaceFailedRepaint(store, parent, photo);
  expect(retry.id).not.toBe(photo.id); expect(retry.status).toBe('queued'); expect(retry.pendingPrompt).toBeNull(); expect(retry.segments).toEqual([]);
  expect(retry.image?.character).toEqual(photo.image?.character); expect(store.job(photo.id)).toEqual(old);
  expect(parent.viggleRepaint!.records[0].previousPhotoJobIds).toEqual([photo.id]); expect(parent.segments[0].promptId).toBe('paid');
});
