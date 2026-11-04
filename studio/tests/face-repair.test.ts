import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Store, publicJob } from '../server/store';
import { FaceRepairManager, FaceRepairError, type FaceRepairExecutor, type FaceRepairRequest } from '../server/face-repair';
import { facialFingerprint } from '../server/facial-consistency';
import { command } from '../server/media';
import { defaults, type Job } from '../shared/types';
import { faceRepairEligibilityReason, normalizeRepairRanges, repairFrameWeight, type FaceRepairCandidate } from '../shared/face-repair';
import type { ConnectionManager } from '../server/comfy';
import { Runner } from '../server/runner';

const repo = path.resolve(import.meta.dirname, '../..'), roots: string[] = [], stores: Store[] = [];
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fakeHash = 'a'.repeat(64);
afterEach(() => { for (const store of stores) store.close(); for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = stores.length = 0; });
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'face-repair-')); roots.push(root);
  const store = new Store(path.join(root, 'data')); stores.push(store); store.set('cloud-connected-instance', 42);
  const id = randomUUID(), folder = path.join(store.root, 'jobs', id), finish = path.join(folder, 'facial-consistency'); mkdirSync(finish, { recursive: true });
  const raw = path.join(folder, 'final.mp4'), source = path.join(folder, 'prepared-source.mp4'), output = path.join(finish, 'final.mp4');
  await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x96:r=24', '-frames:v', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', raw]);
  copyFileSync(raw, source); copyFileSync(raw, output);
  const reference = path.join(root, 'reference.png'); writeFileSync(reference, 'fixture reference');
  store.addAsset({ id: 'reference', kind: 'image', name: 'Character', path: reference, poster: reference, size: 17, width: 64, height: 96, duration: 0, fps: 24, hasAudio: false, createdAt: '2026-11-04' });
  const profile = facialFingerprint(repo, 'source-face-v8');
  const calibration = path.join(finish, 'calibration.json'); writeFileSync(calibration, JSON.stringify({ binding: { jobId: id, profileSHA256: profile } }));
  writeFileSync(path.join(finish, 'receipt.json'), JSON.stringify({ complete: true, inputs: { request: { jobId: id, profileSHA256: profile } }, outputSHA256: hash(output), calibration: { fileSHA256: hash(calibration) } }));
  const parent: Job = { id, title: 'Original paid Remotion', status: 'completed', settings: { ...defaults, engine: 'viggle', facialConsistency: 'perform-onnx60', facialEyeFinish: true, fps: 24, seconds: .5 }, sourceId: 'source', referenceId: 'reference', createdAt: '2026-11-04', favorite: true, deleted: false, width: 64, height: 96,
    output, poster: null, error: null, cancelRequested: false, pendingPrompt: null, uploads: null, elapsedSeconds: 25, origin: 'render', workflow: {}, segments: [], context: '',
    progress: { stage: 'Complete', node: null, value: 12, max: 12, unit: 'frames', segment: 1, segments: 1, completedFrames: 12, targetFrames: 12, updatedAt: 0 },
    facialConsistency: { version: 'source-face-v8', profile: 'perform-onnx60', blend: .6, instanceId: 42, profileSHA256: profile, anchorFrame: 6, frames: 12, processedFrames: 12, state: 'complete', baseSHA256: hash(raw), sourceSHA256: hash(source), referenceSHA256: hash(reference), outputSHA256: hash(output) } };
  store.addJob(parent);
  const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188' } } as ConnectionManager;
  let calls = 0, blocked = false, failure = '', cancelUnknown = false;
  const execute: FaceRepairExecutor = {
    async run(request, _requestFile, destination, signal, progress) {
      calls++; signal.throwIfAborted();
      if (failure === 'not-started') { const error = new FaceRepairError('preflight failed before launch'); error.notStarted = true; throw error; }
      mkdirSync(destination, { recursive: true }); progress(3, 12, 'Fixture face repair');
      const candidates: (FaceRepairCandidate & { preview: string; master: string; losslessDecodedPixelsVerified: boolean; audioPacketsExact: boolean; masterAudioPCMExact: boolean; mp4Recompressed: boolean })[] = [];
      for (const id of request.goal === 'auto' ? ['boundary', 'identity80'] : [request.goal === 'boundary' ? 'boundary' : 'identity80']) {
        const preview = `candidate-${id}.mp4`, master = `candidate-${id}.mkv`;
        copyFileSync(output, path.join(destination, preview));
        await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', output, '-c:v', 'ffv1', '-pix_fmt', 'bgr0', path.join(destination, master)]);
        candidates.push({ id, recipe: 'test-only-protocol', qualified: true, preview, master, previewSHA256: hash(path.join(destination, preview)), masterSHA256: hash(path.join(destination, master)), changedFrames: 1, protectedFramesExact: true, protectedPixelsExact: true, losslessDecodedPixelsVerified: true, audioPacketsExact: true, masterAudioPCMExact: true, mp4Recompressed: true, warnings: [] });
      }
      // This is a transport/protocol fixture, not evidence of image improvement.
      const records = Array.from({ length: request.frames }, (_, frame) => ({ frame, parentDecodedSHA256: fakeHash, weight: repairFrameWeight(frame, request.ranges), outputs: Object.fromEntries(candidates.map(candidate => [candidate.id, { sha256: fakeHash, decodedSHA256: frame === 4 ? 'b'.repeat(64) : fakeHash, changedPixels: frame === 4 ? 1 : 0, editablePixels: frame === 4 ? 1 : 0, protectedPixelsExact: true }])) }));
      if (failure === 'protected') records[0].outputs.boundary!.changedPixels = 1;
      const receipt = { version: 'face-repair-v1', complete: true, profileSHA256: request.binding.profileSHA256, request, parent: request.binding, inheritance: request.inheritance,
        frames: request.frames, fps: request.fps, width: request.width, height: request.height, candidates, records,
        providers: Object.fromEntries(['appearance', 'motion', 'warp', 'decode', 'identity', 'parser'].map(key => [key, [failure === 'cpu' ? 'CPUExecutionProvider' : 'CUDAExecutionProvider']])),
        tracking: { receiptSHA256: fakeHash, target: 'finished-parent', recomputedForRepair: true }, optionalEyeFinish: { inherited: true, recomputed: false, eyeInteriorsProtected: true } };
      writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt));
      writeFileSync(path.join(destination, 'transport.json'), JSON.stringify({ jobId: request.jobId, instanceId: request.instanceId, receiptSHA256: hash(path.join(destination, 'receipt.json')) }));
      if (failure === 'file') writeFileSync(path.join(destination, candidates[0]!.preview), 'tampered');
      progress(12, 12, 'Ready for comparison');
    },
    async cancel() { if (cancelUnknown) throw new FaceRepairError('Remote stop unknown'); },
  };
  const manager = new FaceRepairManager(store, repo, connection, () => { if (blocked) throw new Error('setup busy'); }, execute, async () => fakeHash);
  const selection = { requestId: 'attempt-one', goal: 'auto', ranges: [{ startFrame: 4, endFrame: 5 }] };
  return { store, manager, parent, raw, output, connection, selection, calls: () => calls, block: () => { blocked = true; }, fail: (value: string) => { failure = value; }, unknown: () => { cancelUnknown = true; } };
}
it('normalizes half-open ranges and bounds explicit handles at 0.25 seconds', () => {
  const result = normalizeRepairRanges([{ startFrame: 110, endFrame: 134 }, { startFrame: 55, endFrame: 79 }], 240, 24);
  expect(result).toEqual([{ startFrame: 55, endFrame: 79, editableStartFrame: 49, editableEndFrame: 85 }, { startFrame: 110, endFrame: 134, editableStartFrame: 104, editableEndFrame: 140 }]);
  expect(repairFrameWeight(48, result)).toBe(0); expect(repairFrameWeight(49, result)).toBe(0); expect(repairFrameWeight(55, result)).toBe(1); expect(repairFrameWeight(84, result)).toBe(0);
  expect(normalizeRepairRanges([{ startFrame: 0, endFrame: 1 }, { startFrame: 1, endFrame: 2 }], 12, 24)).toHaveLength(1);
  expect(() => normalizeRepairRanges([{ startFrame: 12, endFrame: 13 }], 12, 24)).toThrow();
});
it('creates an immutable v8-derived repair, deduplicates requests, and rejects changed duplicate bodies', async () => {
  const f = await fixture(), before = hash(f.output), [a, b] = await Promise.all([f.manager.create(f.parent.id, f.selection), f.manager.create(f.parent.id, f.selection)]);
  expect(a.id).toBe(b.id); expect(a.origin).toBe('repair'); expect(a.facialConsistency).toBeUndefined(); expect(a.faceRepair?.rootJobId).toBe(f.parent.id);
  expect(f.store.job(f.parent.id)).toEqual(f.parent); expect(hash(f.output)).toBe(before); expect(f.calls()).toBe(0);
  await expect(f.manager.create(f.parent.id, { ...f.selection, goal: 'identity' })).rejects.toThrow(/different selections/);
  expect(JSON.stringify(publicJob(a))).not.toContain(f.store.root);
});
it('requires explicit review, accepts a separate verified revision, and reuses original raw inputs for further repairs', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection);
  await f.manager.run(job, new AbortController().signal, () => {});
  const review = f.store.job(job.id)!; expect(review.status).toBe('completed'); expect(review.output).toBeNull(); expect(review.faceRepair?.state).toBe('review');
  expect(f.store.job(f.parent.id)).toEqual(f.parent);
  const accepted = await f.manager.accept(job.id, 'identity80'); expect(accepted.faceRepair?.state).toBe('accepted'); expect(accepted.output).toContain('candidate-identity80.mp4');
  expect((await f.manager.accept(job.id, 'identity80')).id).toBe(job.id);
  await expect(f.manager.accept(job.id, 'boundary')).rejects.toThrow(/already has/);
  expect(faceRepairEligibilityReason(accepted)).toBeNull();
  const next = await f.manager.create(accepted.id, { ...f.selection, requestId: 'second-attempt' });
  expect(next.faceRepair).toMatchObject({ parentJobId: accepted.id, rootJobId: f.parent.id }); expect(next.faceRepair?.binding.rawSHA256).toBe(hash(f.raw));
});
it.each(['file', 'cpu', 'protected'])('rejects %s violations and leaves the original untouched', async failure => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); f.fail(failure);
  await f.manager.run(job, new AbortController().signal, () => {});
  expect(f.store.job(job.id)?.status).toBe('interrupted'); expect(f.store.job(job.id)?.output).toBeNull(); expect(f.store.job(f.parent.id)).toEqual(f.parent);
});
it('validates frozen inputs again before accepting a result', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); await f.manager.run(job, new AbortController().signal, () => {});
  writeFileSync(f.raw, 'changed raw'); await expect(f.manager.accept(job.id, 'boundary')).rejects.toThrow(/changed or is missing/); expect(f.store.job(job.id)?.output).toBeNull();
});
it('finishes downloaded results offline without another GPU call', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); await f.manager.run(job, new AbortController().signal, () => {});
  const interrupted = f.store.job(job.id)!; interrupted.status = 'interrupted'; interrupted.faceRepair!.state = 'downloaded'; f.store.saveJob(interrupted);
  f.connection.status.state = 'offline'; f.store.set('cloud-connected-instance', 99); await f.manager.resume(interrupted);
  expect(f.calls()).toBe(1); expect(f.store.job(job.id)?.faceRepair?.state).toBe('review');
});
it('preserves unknown remote repair activity in the indexed queue until an exact later provider stop', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); job.status = 'interrupted'; job.faceRepair!.remoteActive = true; f.store.saveJob(job, false);
  const runner = new Runner(f.store, f.connection, {}, repo); runner.faceRepairs = f.manager;
  expect(f.store.unsettledJobs().map(j => j.id)).toContain(job.id); expect(runner.hasUnconfirmedFaceWork()).toBe(true);
  f.unknown(); await expect(runner.cancel(job)).rejects.toThrow(/unknown/); expect(f.store.job(job.id)?.faceRepair?.remoteActive).toBe(true);
  f.manager.observeProviderStop(99, Date.now()); expect(runner.hasUnconfirmedFaceWork()).toBe(true);
  f.manager.observeProviderStop(42, Date.parse(job.createdAt) - 1); expect(runner.hasUnconfirmedFaceWork()).toBe(true);
  f.manager.observeProviderStop(42, Date.now()); expect(runner.hasUnconfirmedFaceWork()).toBe(false); expect(f.store.job(job.id)?.status).toBe('cancelled');
});
it('blocks missing tools, unsupported clock and unvalidated eye goals without submitting work', async () => {
  const f = await fixture(); f.block(); await expect(f.manager.create(f.parent.id, f.selection)).rejects.toThrow(/setup busy/); expect(f.store.jobs()).toHaveLength(1);
  await expect(f.manager.create(f.parent.id, { ...f.selection, goal: 'eyes' })).rejects.toThrow(/not passed validation/);
  const wrong = { ...f.parent, settings: { ...f.parent.settings, fps: 30 as const } }; expect(faceRepairEligibilityReason(wrong)).toMatch(/24 fps/);
});
it('serializes repairs with renders and stops advancing when a detached worker becomes unknown', async () => {
  const f = await fixture(), first = await f.manager.create(f.parent.id, f.selection), second = await f.manager.create(f.parent.id, { ...f.selection, requestId: 'queued-second' });
  const runner = new Runner(f.store, f.connection, {}, repo); runner.faceRepairs = f.manager; runner.externalGpuBusy = () => runner.hasUnconfirmedFaceWork();
  const called: string[] = [];
  runner.run = async job => { called.push(job.id); job.status = 'interrupted'; job.faceRepair!.remoteActive = true; f.store.saveJob(job); };
  await runner.kick();
  expect(called).toHaveLength(1); expect([first.id, second.id]).toContain(called[0]);
  expect(f.store.jobs().filter(job => job.origin === 'repair' && job.status === 'queued')).toHaveLength(1);
  expect(runner.hasUnconfirmedFaceWork()).toBe(true);
});
it('cancels a queued repair without launching any worker', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection);
  const runner = new Runner(f.store, f.connection, {}, repo); runner.faceRepairs = f.manager; await runner.cancel(job);
  expect(f.store.job(job.id)).toMatchObject({ status: 'cancelled', cancellationConfirmed: true, faceRepair: { remoteActive: false } });
  expect(f.calls()).toBe(0); expect(f.store.job(f.parent.id)).toEqual(f.parent);
});
it('requires exact stopped and checkpoint proofs before allowing offline assembly of downloaded selected frames', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); await f.manager.run(job, new AbortController().signal, () => {});
  const folder = path.join(f.store.root, 'jobs', job.id, 'face-repair'), receiptFile = path.join(folder, 'receipt.json');
  const request: FaceRepairRequest = JSON.parse(readFileSync(path.join(folder, 'request.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')), files = [];
  for (const candidate of receipt.candidates) {
    rmSync(path.join(folder, candidate.preview)); rmSync(path.join(folder, candidate.master));
    const imageFolder = path.join(folder, 'frames', candidate.id); mkdirSync(imageFolder, { recursive: true });
    const image = path.join(imageFolder, 'frame-000004.png'); writeFileSync(image, 'checkpoint protocol fixture');
    receipt.records[4].outputs[candidate.id].sha256 = hash(image);
    files.push({ candidate: candidate.id, frame: 4, sha256: hash(image), decodedSHA256: receipt.records[4].outputs[candidate.id].decodedSHA256 });
  }
  writeFileSync(receiptFile, JSON.stringify(receipt)); rmSync(path.join(folder, 'transport.json'));
  const requestSHA256 = (await command('python3', ['-c', 'import json,hashlib;v=json.loads(__import__("sys").argv[1]);print(hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest())', JSON.stringify(request)])).trim();
  writeFileSync(path.join(folder, 'checkpoint-ready.json'), JSON.stringify({ version: 'face-repair-checkpoints-v1', jobId: job.id, instanceId: 42, requestSHA256, receiptSHA256: hash(receiptFile), frames: 12, complete: true, files }));
  expect(f.manager.localRecoveryReady(job)).toBe(false);
  writeFileSync(path.join(folder, 'remote-stopped.json'), JSON.stringify({ jobId: job.id, instanceId: 42, requestSHA256, stopped: true }));
  expect(f.manager.localRecoveryReady(job)).toBe(true);
  f.connection.status.state = 'offline'; f.store.set('cloud-connected-instance', 99); job.status = 'interrupted'; job.faceRepair!.state = 'processing'; f.store.saveJob(job);
  await f.manager.resume(job); expect(f.store.job(job.id)).toMatchObject({ status: 'queued', faceRepair: { state: 'downloaded', remoteActive: false } });
  writeFileSync(path.join(folder, 'frames', files[0]!.candidate, 'frame-000004.png'), 'tampered checkpoint'); expect(f.manager.localRecoveryReady(job)).toBe(false);
});
it('rejects a modified accepted parent before freezing a new repair canonical video', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); await f.manager.run(job, new AbortController().signal, () => {});
  const accepted = await f.manager.accept(job.id, 'boundary'); writeFileSync(accepted.output!, 'modified accepted video');
  await expect(f.manager.create(accepted.id, { ...f.selection, requestId: 'tampered-parent' })).rejects.toThrow(/accepted parent revision changed/);
});
it('does not turn deterministic fresh preflight failures into unknown activity or clear prior unknown workers', async () => {
  const f = await fixture(), job = await f.manager.create(f.parent.id, f.selection); f.fail('not-started');
  await f.manager.run(job, new AbortController().signal, () => {}); expect(f.store.job(job.id)?.faceRepair?.remoteActive).toBe(false);
  const unknown = f.store.job(job.id)!; unknown.faceRepair!.remoteActive = true; f.store.saveJob(unknown, false);
  await f.manager.resume(unknown); await f.manager.run(unknown, new AbortController().signal, () => {});
  expect(f.store.job(job.id)?.faceRepair?.remoteActive).toBe(true);
});
