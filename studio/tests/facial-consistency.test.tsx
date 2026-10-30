import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaults, settingsSchema, type Job } from '../shared/types';
import { facialCleanupModelFiles, facialModelFiles, facialEyeFinishModelFiles, modelFilesForSettings } from '../shared/models';
import { canFinishFacialLocally, facialRuntimeReadyForSettings, facialVersionForSettings } from '../shared/facial-consistency';
import { engineIssue } from '../shared/engines';
import { overallProgressEstimate } from '../shared/generation-progress';
import { faceHash, facialFingerprint, FacialConsistencyError, ManagedFacialConsistency, newFacialRun, type FacialBackend } from '../server/facial-consistency';
import { Store } from '../server/store';
import { Runner } from '../server/runner';
import type { ConnectionManager } from '../server/comfy';
import { command } from '../server/media';
import FacialConsistencyControls from '../src/FacialConsistencyControls';
import { emptyModels } from '../shared/models';

const repo = path.resolve(import.meta.dirname, '../..');
let fixtures = '', video = '', image = '';
const stores: Store[] = [], roots: string[] = [];
beforeAll(async () => {
  fixtures = await mkdtemp(path.join(os.tmpdir(), 'face-pipeline-fixture-'));
  video = path.join(fixtures, 'input.mp4'); image = path.join(fixtures, 'reference.png');
  await command('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x128:rate=24', '-frames:v', '5', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  await command('ffmpeg', ['-v', 'error', '-i', video, '-frames:v', '1', image]);
});
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
afterAll(async () => rm(fixtures, { recursive: true, force: true }));

async function fixture(profile: 'perform-onnx60' | 'regional-onnx60' = 'perform-onnx60') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'face-pipeline-')); roots.push(root);
  const store = new Store(root); stores.push(store); store.set('cloud-connected-instance', 123);
  store.addAsset({ id: 'source', kind: 'video', path: video, name: 'Fixture.mp4', width: 128, height: 128, fps: 24, duration: 5/24, size: 1, hasAudio: false, poster: '', createdAt: '' });
  store.addAsset({ id: 'reference', kind: 'image', path: image, name: 'Reference.png', width: 128, height: 128, fps: 24, duration: 0, size: 1, hasAudio: false, poster: '', createdAt: '' });
  const client = { json: vi.fn(() => { throw new Error('Paid/native submission must not be repeated'); }), upload: vi.fn(() => { throw new Error('Inputs must remain uploaded'); }) };
  const connection = { status: { state: 'online' }, client: () => client, disconnect: vi.fn() } as unknown as ConnectionManager;
  const runner = new Runner(store, connection, {}, repo, { prepare: vi.fn(), check: vi.fn(async () => ({ status: 'matched' as const, warnings: [], samples: [] })) });
  const job: Job = { id: randomUUID(), title: 'Protocol-only face pipeline', status: 'queued', settings: { ...defaults, engine: 'viggle', referencePreparation: 'prepared', facialConsistency: profile, facialEyeCalibration: false, seconds: 5/24 },
    sourceId: 'source', referenceId: 'reference', createdAt: '', favorite: false, deleted: false, width: 128, height: 128,
    progress: { stage: 'Rendered prefix saved', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: 5, targetFrames: 5, updatedAt: 0 },
    segments: [{ file: 'segment_0000.mp4', frames: 5, seconds: .01, promptId: 'already-paid' }], context: '', pendingPrompt: null, uploads: { source: 'same.mp4', reference: 'same.png' },
    error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
  job.facialConsistency = newFacialRun(job, repo, 123);
  const folder = path.join(root, 'jobs', job.id); await mkdir(folder, { recursive: true });
  await copyFile(video, path.join(folder, 'segment_0000.mp4')); await copyFile(video, path.join(folder, 'prepared-source.mp4'));
  store.addJob(job);
  return { store, runner, job, folder, client, connection };
}
const successfulFinish: FacialBackend['finish'] = async (job, files, _signal, progress) => {
  await mkdir(files.folder, { recursive: true });
  job.facialConsistency!.baseSHA256 ||= faceHash(files.base);
  progress(5, 5, 'Saving facial consistency result');
  await copyFile(files.base, path.join(files.folder, 'final.mp4'));
  job.output = path.join(files.folder, 'final.mp4');
  Object.assign(job.facialConsistency!, { state: 'complete', processedFrames: 5, refinedFrames: 4, skippedFrames: 1, remoteActive: false });
};

describe('selected automatic facial finishing', () => {
  it.each(['confirmed', 'unknown', 'not-requested'] as const)('rechecks only requested facial cancellations before new work: %s', async mode => {
    const { runner, store, job } = await fixture();
    job.status = 'interrupted'; job.cancelRequested = mode !== 'not-requested';
    job.facialConsistency!.remoteActive = true; store.saveJob(job, false);
    const cancel = vi.fn(async (value: Job) => {
      if (mode === 'unknown') throw new Error('Unreachable worker');
      value.facialConsistency!.remoteActive = false; value.facialConsistency!.cancellationConfirmed = true;
    });
    runner.facial = { cancel, preflight: vi.fn(), finish: vi.fn() };
    await runner.reconcileFaceCancellations();
    expect(cancel).toHaveBeenCalledTimes(mode === 'not-requested' ? 0 : 1);
    expect(runner.hasUnconfirmedFaceWork()).toBe(mode !== 'confirmed');
    expect(store.job(job.id)!.status).toBe(mode === 'confirmed' ? 'cancelled' : 'interrupted');
  });
  it('freezes scene finishing separately while retaining the exact original recipe on request', () => {
    const job = { settings: { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const }, progress: { targetFrames: 120 } } as Job;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v7', anchorFrame: 0, profileSHA256: facialFingerprint(repo, 'source-face-v7') });
    job.settings.facialEyeCalibration = false;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v6', profileSHA256: facialFingerprint(repo, 'source-face-v6') });
    job.settings.facialFeatureCleanup = false;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v2', profileSHA256: '3952a4da82fcb2284788137279c7716102bba1e5755b2f6968502dc38dec3c08' });
    job.settings.facialSceneMatch = false;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v1', profileSHA256: 'ef8f273a320b6d34c5efccf690610ad92f1aac0fdb9c4d60c4906557ade5b419' });
    expect(facialFingerprint(repo, 'source-face-v2')).not.toBe(facialFingerprint(repo));
  });
  it('keeps old jobs off and requires the chosen files without changing the video graph', () => {
    expect(settingsSchema.parse({}).facialConsistency).toBe('off');
    const normal = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const };
    expect(modelFilesForSettings(normal).some(id => id.startsWith('face_consistency/'))).toBe(false);
    expect(facialModelFiles.some(id => /nsfw_\d+/.test(id))).toBe(false);
    for (const facialConsistency of ['perform-onnx60', 'regional-onnx60'] as const) {
      expect(modelFilesForSettings({ ...normal, facialConsistency }).filter(id => id.startsWith('face_consistency/'))).toEqual([...facialModelFiles, ...facialCleanupModelFiles]);
      expect(modelFilesForSettings({ ...normal, facialConsistency, facialFeatureCleanup: false }).filter(id => id.startsWith('face_consistency/'))).toEqual(facialModelFiles);
      expect(engineIssue({ ...normal, facialConsistency })).toBeNull();
      expect(engineIssue({ ...normal, facialConsistency, referencePreparation: 'auto' })).toContain('already edited');
    }
  });
  it('does not confuse legacy runtime readiness with the selected cleanup capability', () => {
    const selected = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const, facialEyeCalibration: false };
    expect(facialRuntimeReadyForSettings(selected, { facialRuntimeReady: true })).toBe(false);
    expect(facialRuntimeReadyForSettings(selected, { facialRuntimeReady: true, facialCleanupRuntimeReady: true, facialGeometryRuntimeReady: true })).toBe(true);
    expect(facialRuntimeReadyForSettings({ ...selected, facialFeatureCleanup: false }, { facialRuntimeReady: true })).toBe(true);
    expect(facialRuntimeReadyForSettings({ ...selected, facialConsistency: 'off' }, {})).toBe(true);
  });
  it('uses the same frozen cleanup fingerprint in TypeScript and the managed Python worker', async () => {
    const output = await command('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(profile_hash("source-face-v3"))', path.join(repo, 'scripts')]);
    expect(output.trim()).toBe(facialFingerprint(repo, 'source-face-v3'));
  });
  it('freezes the matching chronological anchor without changing Regional or legacy recipes', async () => {
    const { job } = await fixture();
    Object.assign(job.settings, { facialEyeCalibration: true, referenceTime: 4.875, start: 3, seconds: 9 });
    job.progress.targetFrames = 216;
    const run = newFacialRun(job, repo, 123)!;
    expect(run).toMatchObject({ version: 'source-face-v7', anchorFrame: 45 });
    job.settings.referenceTime = 5;
    expect(run.anchorFrame).toBe(45);
    expect(newFacialRun({ ...job, settings: { ...job.settings, facialConsistency: 'regional-onnx60' } }, repo, 123)?.version).toBe('source-face-v6');
    expect(facialFingerprint(repo, 'source-face-v3')).toBe('286cb1cb40cc0eab2bdbca50bb365fe0b02dedd21d260f24b5c156013ce663b6');
    expect(() => newFacialRun({ ...job, settings: { ...job.settings, referenceTime: 1 } }, repo, 123)).toThrow(/matching source/);
    const output = await command('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(profile_hash("source-face-v4"))', path.join(repo, 'scripts')]);
    expect(output.trim()).toBe(facialFingerprint(repo, 'source-face-v4'));
  });
  it('requires the calibrated worker capability without any additional model weights', () => {
    const selected = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const, facialConsistency: 'perform-onnx60' as const, facialEyeCalibration: true };
    expect(modelFilesForSettings(selected)).toEqual(modelFilesForSettings({ ...selected, facialEyeCalibration: false }));
    expect(facialRuntimeReadyForSettings(selected, { facialRuntimeReady: true, facialCleanupRuntimeReady: true })).toBe(false);
    expect(facialRuntimeReadyForSettings(selected, { facialCalibratedRuntimeReady: true, facialGeometryRuntimeReady: true })).toBe(true);
    expect(facialRuntimeReadyForSettings({ ...selected, facialConsistency: 'regional-onnx60' }, { facialCleanupRuntimeReady: true, facialGeometryRuntimeReady: true })).toBe(true);
  });
  it.each(['valid', 'valid-skip', 'wrong-anchor', 'missing-state', 'changed-state', 'changed-source', 'mouth-changed', 'cpu-parser'] as const)('validates downloaded calibrated state offline: %s', async variant => {
    const { store, job, folder } = await fixture();
    job.settings.facialEyeCalibration = true;
    job.facialConsistency = newFacialRun(job, repo, 123);
    const run = job.facialConsistency!;
    Object.assign(run, { version: 'source-face-v4', profileSHA256: facialFingerprint(repo, 'source-face-v4') });
    run.state = 'downloaded'; run.remoteActive = false;
    const signature = { baseSHA256: faceHash(video), sourceSHA256: faceHash(video), referenceSHA256: faceHash(image) };
    const destination = path.join(folder, 'facial-consistency'); await mkdir(destination);
    await copyFile(video, path.join(destination, 'final.mp4'));
    const offset = Array.from({ length: 49 }, () => [0, 0, 0]);
    const correctionSHA256 = createHash('sha256').update(Buffer.alloc(147 * 4)).digest('hex');
    const binding = { jobId: job.id, version: run.version, profileSHA256: run.profileSHA256, anchorFrame: run.anchorFrame, sourceSHA256: signature.sourceSHA256, referenceSHA256: signature.referenceSHA256 };
    const skipped = variant === 'valid-skip';
    const metadata = { state: skipped ? 'skipped' : 'active', reason: skipped ? 'anchor-face-uncertain' : null, anchorBGRSHA256: 'a'.repeat(64),
      ...(!skipped ? { eyeGroups: [[27,28,29,30],[34,35,47,48]], eligibleEyes: [true,true], baselineEyeAreas: [600,600], correctionSHA256 } : {}) };
    const saved = { binding, metadata, model: skipped ? null : { ...metadata, offset: [offset] } };
    await writeFile(path.join(destination, 'calibration.json'), JSON.stringify(saved));
    const receipt: any = { complete: true, profile: run.profile, blend: .6,
      inputs: { ...signature, version: run.version, request: { jobId: job.id, profile: run.profile, profileSHA256: run.profileSHA256, anchorFrame: run.anchorFrame }, target: { frames: 5, fps: '24', width: 128, height: 128 }, source: { frames: 5, fps: '24', width: 128, height: 128 } },
      calibration: { ...binding, ...metadata, fileSHA256: faceHash(path.join(destination, 'calibration.json')) },
      outputSHA256: faceHash(path.join(destination, 'final.mp4')), elapsedSeconds: 1, refinedFrames: 4, skippedFrames: 1, gpu: 'Protocol fixture',
      providers: Object.fromEntries(['appearance','motion','warp','decode','identity','parser'].map(k => [k, ['CUDAExecutionProvider']])),
      records: Array.from({ length: 5 }, (_, frame) => ({ frame, action: frame < 4 ? 'refined' : 'preserved', protectedPixelsExact: true, sha256: 'b'.repeat(64),
        ...(frame < 4 ? { cleanup: { sourceEyeGates: [1,1], eyeTexturePixels: 1, editablePixels: 2 }, ...(!skipped ? { calibration: { eyeCalibrationWeights: [1,1], sourceMouthLatentUnchanged: true, sourceJawLatentUnchanged: true } } : {}) } : {}) })) };
    if (variant === 'wrong-anchor') receipt.calibration.anchorFrame = 1;
    if (variant === 'changed-source') receipt.calibration.sourceSHA256 = 'c'.repeat(64);
    if (variant === 'mouth-changed') receipt.records[0].calibration.sourceMouthLatentUnchanged = false;
    if (variant === 'cpu-parser') receipt.providers.parser = ['CPUExecutionProvider'];
    if (variant === 'changed-state') await writeFile(path.join(destination, 'calibration.json'), JSON.stringify({ ...saved, metadata: { ...metadata, state: 'skipped' } }));
    if (variant === 'missing-state') await rm(path.join(destination, 'calibration.json'));
    await writeFile(path.join(destination, 'receipt.json'), JSON.stringify(receipt));
    await writeFile(path.join(destination, 'transport.json'), JSON.stringify({ jobId: job.id, instanceId: 123, receiptSHA256: faceHash(path.join(destination, 'receipt.json')) }));
    const backend = new ManagedFacialConsistency(store, repo, { status: { state: 'offline' } } as ConnectionManager);
    const pending = backend.finish(job, { reference: image, source: video, base: video, folder: destination }, new AbortController().signal, () => {});
    if (variant === 'valid' || variant === 'valid-skip') {
      await pending;
      expect(run).toMatchObject({ state: 'complete', eyeCalibration: { state: skipped ? 'skipped' : 'active', anchorFrame: 0 } });
    } else await expect(pending).rejects.toThrow(FacialConsistencyError);
    expect(faceHash(video)).toBe(signature.baseSHA256);
    expect(faceHash(image)).toBe(signature.referenceSHA256);
  });
  it.each(['valid', 'cpu-parser', 'missing-cleanup'] as const)('checks downloaded cleanup provenance offline: %s', async variant => {
    const { store, job, folder, connection } = await fixture();
    connection.status.state = 'offline';
    const run = job.facialConsistency!;
    Object.assign(run, { version: 'source-face-v3', profileSHA256: facialFingerprint(repo, 'source-face-v3'), preflightComplete: true, state: 'downloaded' });
    const output = path.join(folder, 'facial-consistency'); await mkdir(output);
    const base = path.join(folder, 'final.mp4'); await copyFile(video, base); await copyFile(video, path.join(output, 'final.mp4'));
    const signature = { baseSHA256: faceHash(base), sourceSHA256: faceHash(video), referenceSHA256: faceHash(image) };
    const records = Array.from({ length: 5 }, (_, frame) => ({ frame, action: 'refined', protectedPixelsExact: true, sha256: '1'.repeat(64),
      ...(variant === 'missing-cleanup' ? {} : { cleanup: { sourceEyeGates: [1, 0], eyeTexturePixels: 20, editablePixels: 100 } }) }));
    const info = { frames: 5, fps: '24', width: 128, height: 128 };
    const receipt = { complete: true, profile: run.profile, blend: .6, outputSHA256: faceHash(path.join(output, 'final.mp4')), elapsedSeconds: 1,
      inputs: { ...signature, version: run.version, target: info, source: info, request: { profileSHA256: run.profileSHA256, jobId: job.id, profile: run.profile } },
      records, refinedFrames: 5, skippedFrames: 0, gpu: 'Protocol fixture', providers: Object.fromEntries(['appearance', 'motion', 'warp', 'decode', 'identity', 'parser'].map(key => [key, [key === 'parser' && variant === 'cpu-parser' ? 'CPUExecutionProvider' : 'CUDAExecutionProvider']])) };
    const receiptFile = path.join(output, 'receipt.json'); await writeFile(receiptFile, JSON.stringify(receipt));
    await writeFile(path.join(output, 'transport.json'), JSON.stringify({ instanceId: run.instanceId, jobId: job.id, receiptSHA256: faceHash(receiptFile) }));
    const backend = new ManagedFacialConsistency(store, repo, connection);
    const finish = backend.finish(job, { reference: image, source: video, base, folder: output }, new AbortController().signal, vi.fn());
    if (variant === 'valid') { await finish; expect(run.state).toBe('complete'); }
    else await expect(finish).rejects.toThrow('provenance');
    expect(faceHash(base)).toBe(signature.baseSHA256);
  });
  it.each(['perform-onnx60', 'regional-onnx60'] as const)('automatically finishes %s before marking the original job complete', async profile => {
    const { runner, store, job, folder, client } = await fixture(profile);
    const preflight = vi.fn<FacialBackend['preflight']>(async current => { current.facialConsistency!.preflightComplete = true; });
    runner.facial = { preflight, finish: vi.fn(successfulFinish), cancel: vi.fn() };
    await runner.kick(); const saved = store.job(job.id)!;
    expect(saved.status).toBe('completed'); expect(saved.facialConsistency).toMatchObject({ profile, state: 'complete', blend: .6, refinedFrames: 4, skippedFrames: 1 });
    expect(saved.output).toBe(path.join(folder, 'facial-consistency/final.mp4'));
    expect(await readFile(path.join(folder, 'final.mp4'))).toEqual(await readFile(saved.output!));
    expect(preflight).toHaveBeenCalledOnce(); expect(client.json).not.toHaveBeenCalled(); expect(overallProgressEstimate(saved)).toBe(100);
  });
  it('keeps the rendered video and resumes only the finishing stage after a failure', async () => {
    const { runner, store, job, client } = await fixture();
    const preflight = vi.fn<FacialBackend['preflight']>(async current => { current.facialConsistency!.preflightComplete = true; });
    const finish = vi.fn<FacialBackend['finish']>(async (current, files) => {
      current.facialConsistency!.baseSHA256 = faceHash(files.base); store.saveJob(current);
      const error = new FacialConsistencyError('Simulated interrupted face transfer'); error.remoteStopped = true; throw error;
    });
    runner.facial = { preflight, finish, cancel: vi.fn() };
    await runner.kick(); const interrupted = store.job(job.id)!;
    expect(interrupted.status).toBe('interrupted'); expect(interrupted.progress.completedFrames).toBe(5); expect(interrupted.segments[0].promptId).toBe('already-paid');
    const hash = faceHash(interrupted.output!); finish.mockImplementation(successfulFinish);
    await runner.resume(interrupted); while (runner.busy) await new Promise(resolve => setTimeout(resolve, 20));
    expect(store.job(job.id)!.status).toBe('completed'); expect(faceHash(interrupted.output!)).toBe(hash); expect(preflight).toHaveBeenCalledOnce(); expect(client.json).not.toHaveBeenCalled();
  });
  it('rejects a bad reference before preparing or submitting new video work', async () => {
    const { runner, store, job, client } = await fixture(); job.progress.completedFrames = 0; job.segments = []; store.saveJob(job);
    runner.facial = { preflight: vi.fn(async () => { throw new FacialConsistencyError('Use one clear reference face'); }), finish: vi.fn(), cancel: vi.fn() };
    await runner.kick(); expect(store.job(job.id)).toMatchObject({ status: 'interrupted', error: 'Use one clear reference face' });
    expect(client.json).not.toHaveBeenCalled(); expect(client.upload).not.toHaveBeenCalled();
  });
  it('can finish a fully downloaded result while the GPU is offline', async () => {
    const { runner, store, job, folder, client, connection } = await fixture();
    await copyFile(video, path.join(folder, 'final.mp4'));
    Object.assign(job.facialConsistency!, { preflightComplete: true, state: 'downloaded', baseSHA256: faceHash(path.join(folder, 'final.mp4')) });
    store.saveJob(job); connection.status.state = 'offline';
    const preflight = vi.fn<FacialBackend['preflight']>();
    runner.facial = { preflight, finish: vi.fn(successfulFinish), cancel: vi.fn() };
    await runner.kick(); expect(store.job(job.id)!.status).toBe('completed'); expect(preflight).not.toHaveBeenCalled(); expect(client.json).not.toHaveBeenCalled();
  });
  it('does not rerender or overwrite a changed pre-face input during recovery', async () => {
    const { runner, store, job, folder, client } = await fixture();
    await copyFile(video, path.join(folder, 'final.mp4'));
    Object.assign(job.facialConsistency!, { preflightComplete: true, state: 'interrupted', baseSHA256: faceHash(path.join(folder, 'final.mp4')) });
    await writeFile(path.join(folder, 'final.mp4'), 'tampered'); store.saveJob(job);
    const finish = vi.fn<FacialBackend['finish']>(); runner.facial = { preflight: vi.fn(), finish, cancel: vi.fn() };
    await runner.kick(); expect(store.job(job.id)).toMatchObject({ status: 'interrupted' });
    expect(await readFile(path.join(folder, 'final.mp4'), 'utf8')).toBe('tampered'); expect(finish).not.toHaveBeenCalled(); expect(client.json).not.toHaveBeenCalled();
  });
  it('waits for confirmed remote cancellation before declaring the face pass cancelled', async () => {
    const { runner, store, job } = await fixture();
    runner.facial = { preflight: vi.fn(async current => { current.facialConsistency!.preflightComplete = true; }), cancel: vi.fn(),
      finish: vi.fn(async (current, _files, signal) => {
        current.facialConsistency!.remoteActive = true; store.saveJob(current);
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        const error = new FacialConsistencyError('Confirmed facial cancellation'); error.remoteStopped = true; error.cancellationConfirmed = true; throw error;
      }) };
    const task = runner.kick();
    while (!store.job(job.id)!.facialConsistency?.remoteActive) await new Promise(resolve => setTimeout(resolve, 10));
    await runner.cancel(store.job(job.id)!); await task;
    expect(store.job(job.id)).toMatchObject({ status: 'cancelled', cancellationConfirmed: true, facialConsistency: { remoteActive: false, cancellationConfirmed: true } });
  });
  it('does not report 100% while facial processing or output saving is still running', async () => {
    const { job } = await fixture(); job.status = 'running'; job.output = 'raw-render';
    job.facialConsistency!.state = 'processing'; job.facialConsistency!.processedFrames = 2;
    const mid = overallProgressEstimate(job); expect(mid).toBeGreaterThan(80); expect(mid).toBeLessThan(96);
    job.facialConsistency!.state = 'saving'; expect(overallProgressEstimate(job)).toBeLessThan(100);
    job.facialConsistency!.state = 'downloaded'; expect(canFinishFacialLocally(job)).toBe(true); expect(overallProgressEstimate(job)).toBe(98);
    job.status = 'completed'; expect(overallProgressEstimate(job)).toBe(100);
  });
  it('shows both choices without a Library step or an implicit download', () => {
    const download = vi.fn();
    const html = renderToStaticMarkup(<FacialConsistencyControls value="perform-onnx60" change={vi.fn()} downloads={{ state: emptyModels(), online: false, blocked: false, download, remove: vi.fn() }} />);
    expect(html).toContain('Standard + ONNX 60%'); expect(html).toContain('Regional + ONNX 60%'); expect(html).toContain('Facial consistency'); expect(download).not.toHaveBeenCalled();
  });
  it('shows calibration only for Standard and distinguishes a code update from missing weights', () => {
    const download = vi.fn();
    const state = emptyModels();
    state.files = state.files.map(file => ({ ...file, status: 'installed' as const }));
    state.facialRuntimeReady = true; state.facialCleanupRuntimeReady = true; state.facialGeometryRuntimeReady = true; state.facialCalibratedRuntimeReady = false;
    const common = { change: vi.fn(), sceneMatch: true, changeSceneMatch: vi.fn(), cleanup: true, changeCleanup: vi.fn(), eyeCalibration: true, changeEyeCalibration: vi.fn(),
      downloads: { state, online: false, blocked: false, download, remove: vi.fn() } };
    const standard = renderToStaticMarkup(<FacialConsistencyControls {...common} value="perform-onnx60" />);
    expect(standard).toContain('Calibrate eye appearance');
    expect(standard).toContain('Prepare / update facial tools');
    const regional = renderToStaticMarkup(<FacialConsistencyControls {...common} value="regional-onnx60" />);
    expect(regional).not.toContain('Calibrate eye appearance');
    expect(regional).not.toContain('Prepare / update facial tools');
    expect(download).not.toHaveBeenCalled();
  });
});

describe('optional eye finishing', () => {
  it('pins an explicit opt-in, extra files and capability without migrating v4 or Regional', async () => {
    expect(settingsSchema.parse({}).facialEyeFinish).toBe(false);
    const settings = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const, facialEyeFinish: true };
    const job = { settings, progress: { targetFrames: 120 } } as Job;
    expect(newFacialRun(job, repo, 123)?.version).toBe('source-face-v8');
    expect(newFacialRun({ ...job, settings: { ...settings, facialEyeFinish: false } }, repo, 123)?.version).toBe('source-face-v7');
    expect(newFacialRun({ ...job, settings: { ...settings, facialConsistency: 'regional-onnx60' } }, repo, 123)?.version).toBe('source-face-v6');
    expect(modelFilesForSettings(settings).filter(id => id.startsWith('face_consistency/'))).toEqual([...facialModelFiles, ...facialCleanupModelFiles, ...facialEyeFinishModelFiles]);
    expect(modelFilesForSettings({ ...settings, facialEyeCalibration: false }).some(id => facialEyeFinishModelFiles.includes(id))).toBe(false);
    expect(facialRuntimeReadyForSettings(settings, { facialCalibratedRuntimeReady: true })).toBe(false);
    expect(facialRuntimeReadyForSettings(settings, { facialEyeFinishRuntimeReady: true, facialGeometryRuntimeReady: true })).toBe(true);
    const output = await command('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(profile_hash("source-face-v5"))', path.join(repo, 'scripts')]);
    expect(output.trim()).toBe(facialFingerprint(repo, 'source-face-v5'));
    expect(facialFingerprint(repo, 'source-face-v4')).toBe('4520b9613ed3e9d9b5e105baa85cc3332064d3564a0e759fa2af91426ac65239');
  });
  it('advances from saved work milestones without inventing finished frame counts', async () => {
    const { job } = await fixture();
    Object.assign(job.facialConsistency!, { version: 'source-face-v5', state: 'processing', processedFrames: 0, workUnits: { completed: 10, total: 20 } });
    expect(overallProgressEstimate(job)).toBe(88); expect(job.facialConsistency!.processedFrames).toBe(0);
    expect(overallProgressEstimate({ ...job, status: 'completed', output: null })).not.toBe(100);
  });
  it.each(['valid', 'wrong-model', 'source-rgb', 'cpu-enhancer', 'changed-frame', 'changed-native'] as const)('validates the downloaded v5 chain offline: %s', async variant => {
    const { store, job, folder } = await fixture();
    Object.assign(job.settings, { facialEyeCalibration: true, facialEyeFinish: true });
    job.facialConsistency = newFacialRun(job, repo, 123);
    const run = job.facialConsistency!; Object.assign(run, { version: 'source-face-v5', profileSHA256: facialFingerprint(repo, 'source-face-v5') }); run.state = 'downloaded'; run.remoteActive = false;
    const dest = path.join(folder, 'facial-consistency'); await mkdir(path.join(dest, 'eye-finish'), { recursive: true });
    await copyFile(video, path.join(dest, 'final.mp4'));
    const save = async (name: string, value: unknown) => { const file = path.join(dest, name); await writeFile(file, JSON.stringify(value)); return faceHash(file); };
    const info = { frames: 5, fps: '24', width: 128, height: 128 };
    const signature = { baseSHA256: faceHash(video), sourceSHA256: faceHash(video), referenceSHA256: faceHash(image) };
    const binding = { jobId: job.id, version: run.version, profileSHA256: run.profileSHA256, anchorFrame: 0, sourceSHA256: signature.sourceSHA256, referenceSHA256: signature.referenceSHA256 };
    const metadata = { state: 'skipped', reason: 'anchor-face-uncertain', anchorBGRSHA256: 'a'.repeat(64) };
    const calibrationSHA = await save('calibration.json', { binding, metadata, model: null });
    const native: any = { complete: true, profile: run.profile, blend: .6, outputSHA256: faceHash(path.join(dest, 'final.mp4')), elapsedSeconds: 1,
      inputs: { ...signature, version: run.version, request: { jobId: job.id, profile: run.profile, profileSHA256: run.profileSHA256, anchorFrame: 0 }, target: info, source: info },
      calibration: { ...binding, ...metadata, fileSHA256: calibrationSHA }, records: Array.from({ length: 5 }, (_, frame) => ({ frame, action: 'preserved', protectedPixelsExact: true, sha256: 'b'.repeat(64) })),
      refinedFrames: 0, skippedFrames: 5, gpu: 'Protocol fixture; no GPU used', providers: Object.fromEntries(['appearance', 'motion', 'warp', 'decode', 'identity', 'parser', 'eyeEnhancer', 'eyeParser'].map(key => [key, ['CUDAExecutionProvider']])) };
    const nativeSHA = await save('native-receipt.json', native);
    const manifest = JSON.parse(await readFile(path.join(repo, 'config/facial-consistency-eye-finish-models.lock.json'), 'utf8'));
    const request = { profileSHA256: run.profileSHA256, nativeReceiptSHA256: nativeSHA, restorationModelSHA256: manifest.files[0].sha256, observationModelSHA256: manifest.files[1].sha256 };
    const requestSHA = await save('eye-finish/request.json', request);
    const restoration = { complete: true, inputs: request, records: native.records.map((r: any) => ({ frame: r.frame, nativeSHA256: r.sha256, sha256: 'c'.repeat(64), protectedPixelsExact: true })) };
    const restorationSHA = await save('eye-finish/restoration.json', restoration);
    const obsSHA = await save('eye-finish/observations.json', { complete: true, inputs: { requestSHA256: requestSHA, restorationReceiptSHA256: restorationSHA }, records: native.records.map((r: any) => ({ frame: r.frame })) });
    const placement = { complete: true, inputs: { observationsSHA256: obsSHA }, records: native.records.map((r: any) => ({ frame: r.frame, sha256: 'd'.repeat(64), protectedPixelsExact: true })) };
    const placementSHA = await save('eye-finish/placement.json', placement);
    const receipt: any = { ...native, records: native.records.map((r: any, i: number) => ({ ...r, nativeSHA256: r.sha256, sha256: placement.records[i].sha256, eyeFinish: { restoration: restoration.records[i] } })),
      eyeFinish: { complete: true, version: 'source-eye-finish-v1', requestSHA256: requestSHA, nativeReceiptSHA256: nativeSHA, nativeOutputSHA256: native.outputSHA256,
        restorationModelSHA256: request.restorationModelSHA256, observationModelSHA256: request.observationModelSHA256, restorationReceiptSHA256: restorationSHA, observationReceiptSHA256: obsSHA, placementReceiptSHA256: placementSHA,
        restorationFrames: 0, placementFrames: 0, restorationSeconds: 0, observationSeconds: 0, placementSeconds: 0, sourceRGBTransferred: false } };
    if (variant === 'wrong-model') receipt.eyeFinish.restorationModelSHA256 = 'e'.repeat(64);
    if (variant === 'source-rgb') receipt.eyeFinish.sourceRGBTransferred = true;
    if (variant === 'cpu-enhancer') receipt.providers.eyeEnhancer = ['CPUExecutionProvider'];
    if (variant === 'changed-frame') receipt.records[0].sha256 = 'e'.repeat(64);
    if (variant === 'changed-native') { native.inputs.sourceSHA256 = 'e'.repeat(64); await save('native-receipt.json', native); }
    const receiptSHA = await save('receipt.json', receipt);
    await save('transport.json', { jobId: job.id, instanceId: 123, receiptSHA256: receiptSHA });
    const backend = new ManagedFacialConsistency(store, repo, { status: { state: 'offline' } } as ConnectionManager);
    const pending = backend.finish(job, { reference: image, source: video, base: video, folder: dest }, new AbortController().signal, vi.fn());
    if (variant === 'valid') { await pending; expect(run).toMatchObject({ state: 'complete', eyeFinish: { sourceRGBTransferred: false } }); }
    else await expect(pending).rejects.toThrow(FacialConsistencyError);
    expect(faceHash(video)).toBe(signature.baseSHA256); expect(faceHash(image)).toBe(signature.referenceSHA256);
  });
});

describe('jaw-aware facial recipes', () => {
  it('retains all five historical fingerprints and matches the three new Python fingerprints', async () => {
    const legacy = ['ef8f273a320b6d34c5efccf690610ad92f1aac0fdb9c4d60c4906557ade5b419',
      '3952a4da82fcb2284788137279c7716102bba1e5755b2f6968502dc38dec3c08',
      '286cb1cb40cc0eab2bdbca50bb365fe0b02dedd21d260f24b5c156013ce663b6',
      '4520b9613ed3e9d9b5e105baa85cc3332064d3564a0e759fa2af91426ac65239',
      '665bac84437c6e61a91db8a25d193abd1989e1c7ddabb3815a38d8a267e02dfe'];
    for (const [i, hash] of legacy.entries()) expect(facialFingerprint(repo, `source-face-v${i + 1}` as any)).toBe(hash);
    const output = await command('python3', ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(json.dumps([profile_hash("source-face-v"+str(i))for i in [6,7,8]]))', path.join(repo, 'scripts')]);
    expect(JSON.parse(output)).toEqual(['source-face-v6', 'source-face-v7', 'source-face-v8'].map(v => facialFingerprint(repo, v as any)));
  });
  it('requires the updated compositor capability, independently of already installed weights', () => {
    const settings = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const };
    expect(facialRuntimeReadyForSettings(settings, { facialCalibratedRuntimeReady: true })).toBe(false);
    expect(facialRuntimeReadyForSettings(settings, { facialCalibratedRuntimeReady: true, facialGeometryRuntimeReady: true })).toBe(true);
  });
  it.each(['valid', 'hidden-source', 'missing', 'impossible-count', 'insufficient-visibility'] as const)('checks downloaded jaw permission evidence offline: %s', async variant => {
    const { store, job, folder, connection } = await fixture();
    connection.status.state = 'offline';
    const run = job.facialConsistency!; expect(run.version).toBe('source-face-v6');
    Object.assign(run, { preflightComplete: true, state: 'downloaded' });
    const output = path.join(folder, 'facial-consistency'); await mkdir(output);
    const base = path.join(folder, 'final.mp4'); await copyFile(video, base); await copyFile(video, path.join(output, 'final.mp4'));
    const signature = { baseSHA256: faceHash(base), sourceSHA256: faceHash(video), referenceSHA256: faceHash(image) };
    const jaw: any = variant === 'hidden-source'
      ? { version: 'source-jaw-geometry-v1', sourceJawVisibility: .2, extensionPixels: 0, bridgePixels: 0, supportPixels: 0, reason: 'source-jaw-not-visible' }
      : { version: 'source-jaw-geometry-v1', sourceJawVisibility: .95, extensionPixels: 50, bridgePixels: 10, supportPixels: 60, reason: null };
    if (variant === 'impossible-count') jaw.supportPixels = 40;
    if (variant === 'insufficient-visibility') jaw.sourceJawVisibility = .8;
    const records = Array.from({ length: 5 }, (_, frame) => ({ frame, action: 'refined', protectedPixelsExact: true, sha256: '1'.repeat(64),
      cleanup: { sourceEyeGates: [1, 0], eyeTexturePixels: 20, editablePixels: 100, ...(variant === 'missing' ? {} : { jawGeometry: jaw }) } }));
    const info = { frames: 5, fps: '24', width: 128, height: 128 };
    const receipt = { complete: true, profile: run.profile, blend: .6, outputSHA256: faceHash(path.join(output, 'final.mp4')), elapsedSeconds: 1,
      inputs: { ...signature, version: run.version, target: info, source: info, request: { profileSHA256: run.profileSHA256, jobId: job.id, profile: run.profile } },
      records, refinedFrames: 5, skippedFrames: 0, gpu: 'Protocol fixture; no GPU used', providers: Object.fromEntries(['appearance', 'motion', 'warp', 'decode', 'identity', 'parser'].map(key => [key, ['CUDAExecutionProvider']])) };
    const receiptFile = path.join(output, 'receipt.json'); await writeFile(receiptFile, JSON.stringify(receipt));
    await writeFile(path.join(output, 'transport.json'), JSON.stringify({ instanceId: run.instanceId, jobId: job.id, receiptSHA256: faceHash(receiptFile) }));
    const backend = new ManagedFacialConsistency(store, repo, connection);
    const finish = backend.finish(job, { reference: image, source: video, base, folder: output }, new AbortController().signal, vi.fn());
    if (variant === 'valid' || variant === 'hidden-source') { await finish; expect(run.state).toBe('complete'); }
    else await expect(finish).rejects.toThrow('jaw-geometry');
    expect(faceHash(base)).toBe(signature.baseSHA256);
  });
});

describe('optional inward face-boundary treatment', () => {
  it('keeps existing routes as defaults and adds no weights or beta eye stages', async () => {
    expect(settingsSchema.parse({}).facialBoundaryBlend).toBe(false);
    const settings = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const, facialBoundaryBlend: true };
    expect(facialVersionForSettings(settings)).toBe('source-face-v10');
    expect(facialVersionForSettings({ ...settings, facialEyeCalibration: false })).toBe('source-face-v9');
    expect(facialVersionForSettings({ ...settings, facialConsistency: 'regional-onnx60' })).toBe('source-face-v9');
    expect(facialVersionForSettings({ ...settings, facialEyeFinish: true })).toBe('source-face-v8');
    expect(facialVersionForSettings({ ...settings, facialFeatureCleanup: false })).toBe('source-face-v2');
    expect(modelFilesForSettings(settings)).toEqual(modelFilesForSettings({ ...settings, facialBoundaryBlend: false }));
    const output = await command('python3', ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(json.dumps([profile_hash("source-face-v"+str(i))for i in [6,7,8,9,10]]))', path.join(repo, 'scripts')]);
    expect(JSON.parse(output)).toEqual(['6ce5188c6f39a7aebc38d38eeb2a7d37fada236fce1c0908246e179773fa84d8',
      'dc4776f15dd9829b995c46972de52baf9f74af32a1ecc08ffc261b9a1aec4294',
      '2653e3d2c8d27223f2861f69efb461456493666bca4131c3995e3a38d3d3765f',
      facialFingerprint(repo, 'source-face-v9'), facialFingerprint(repo, 'source-face-v10')]);
  });
  it('requires explicit updated capability without mistaking installed weights for ready tools', () => {
    const selected = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const, facialBoundaryBlend: true };
    const ready = { facialCalibratedRuntimeReady: true, facialGeometryRuntimeReady: true };
    expect(facialRuntimeReadyForSettings(selected, ready)).toBe(false);
    expect(facialRuntimeReadyForSettings(selected, { ...ready, facialBoundaryRuntimeReady: true })).toBe(true);
    const downloads = { state: { ...emptyModels(), files: [] }, online: false, blocked: false } as any;
    const render = (eyeFinish = false) => renderToStaticMarkup(<FacialConsistencyControls value="perform-onnx60" change={() => {}} downloads={downloads} cleanup sceneMatch eyeCalibration eyeFinish={eyeFinish} boundaryBlend changeBoundaryBlend={() => {}} />);
    expect(render()).toContain('Soften face boundary');
    expect(render(true)).toContain('Soften face boundary');
    expect(render(true)).toContain('disabled=""');
    expect(render(true)).toContain('Boundary blending is inactive');
  });
  it.each(['valid', 'missing', 'wrong-version', 'outward-growth', 'source-rgb', 'invalid-count'] as const)('validates saved boundary receipts offline: %s', async variant => {
    const { store, job, folder, connection } = await fixture();
    connection.status.state = 'offline';
    job.settings.facialBoundaryBlend = true;
    job.facialConsistency = newFacialRun(job, repo, 123);
    const run = job.facialConsistency!;
    expect(run.version).toBe('source-face-v9');
    Object.assign(run, { preflightComplete: true, state: 'downloaded' });
    const output = path.join(folder, 'facial-consistency'); await mkdir(output);
    await copyFile(video, path.join(output, 'final.mp4'));
    const signature = { baseSHA256: faceHash(video), sourceSHA256: faceHash(video), referenceSHA256: faceHash(image) };
    const boundary: any = { version: 'face-boundary-v1', strength: .65, boundaryPixels: 100, outwardGrowth: false, sourceRGBTransferred: false };
    if (variant === 'wrong-version') boundary.version = 'other';
    if (variant === 'outward-growth') boundary.outwardGrowth = true;
    if (variant === 'source-rgb') boundary.sourceRGBTransferred = true;
    if (variant === 'invalid-count') boundary.boundaryPixels = 512 * 512 + 1;
    const jaw = { version: 'source-jaw-geometry-v1', sourceJawVisibility: .2, extensionPixels: 0, bridgePixels: 0, supportPixels: 0, reason: 'source-jaw-not-visible' };
    const info = { frames: 5, fps: '24', width: 128, height: 128 };
    const receipt = { complete: true, profile: run.profile, blend: .6, outputSHA256: faceHash(path.join(output, 'final.mp4')), elapsedSeconds: 1,
      inputs: { ...signature, version: run.version, target: info, source: info, request: { profileSHA256: run.profileSHA256, jobId: job.id, profile: run.profile } },
      records: Array.from({ length: 5 }, (_, frame) => ({ frame, action: 'refined', protectedPixelsExact: true, sha256: '1'.repeat(64),
        cleanup: { sourceEyeGates: [1, 0], eyeTexturePixels: 0, editablePixels: 100, jawGeometry: jaw, ...(variant === 'missing' ? {} : { boundaryBlend: boundary }) } })),
      refinedFrames: 5, skippedFrames: 0, gpu: 'Protocol fixture; no GPU', providers: Object.fromEntries(['appearance', 'motion', 'warp', 'decode', 'identity', 'parser'].map(key => [key, ['CUDAExecutionProvider']])) };
    const file = path.join(output, 'receipt.json'); await writeFile(file, JSON.stringify(receipt));
    await writeFile(path.join(output, 'transport.json'), JSON.stringify({ instanceId: run.instanceId, jobId: job.id, receiptSHA256: faceHash(file) }));
    const backend = new ManagedFacialConsistency(store, repo, connection);
    const finish = backend.finish(job, { reference: image, source: video, base: video, folder: output }, new AbortController().signal, vi.fn());
    if (variant === 'valid') { await finish; expect(run.state).toBe('complete'); }
    else await expect(finish).rejects.toThrow('face-boundary');
    expect(faceHash(video)).toBe(signature.baseSHA256);
  });
});
