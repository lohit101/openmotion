import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaults, settingsSchema, type Job } from '../shared/types';
import { facialCleanupModelFiles, facialModelFiles, modelFilesForSettings } from '../shared/models';
import { canFinishFacialLocally, facialRuntimeReadyForSettings } from '../shared/facial-consistency';
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
  it('freezes scene finishing separately while retaining the exact original recipe on request', () => {
    const job = { settings: { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const }, progress: { targetFrames: 120 } } as Job;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v4', anchorFrame: 0, profileSHA256: facialFingerprint(repo, 'source-face-v4') });
    job.settings.facialEyeCalibration = false;
    expect(newFacialRun(job, repo, 123)).toMatchObject({ version: 'source-face-v3', profileSHA256: '286cb1cb40cc0eab2bdbca50bb365fe0b02dedd21d260f24b5c156013ce663b6' });
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
    expect(facialRuntimeReadyForSettings(selected, { facialRuntimeReady: true, facialCleanupRuntimeReady: true })).toBe(true);
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
    expect(run).toMatchObject({ version: 'source-face-v4', anchorFrame: 45 });
    job.settings.referenceTime = 5;
    expect(run.anchorFrame).toBe(45);
    expect(newFacialRun({ ...job, settings: { ...job.settings, facialConsistency: 'regional-onnx60' } }, repo, 123)?.version).toBe('source-face-v3');
    expect(facialFingerprint(repo, 'source-face-v3')).toBe('286cb1cb40cc0eab2bdbca50bb365fe0b02dedd21d260f24b5c156013ce663b6');
    expect(() => newFacialRun({ ...job, settings: { ...job.settings, referenceTime: 1 } }, repo, 123)).toThrow(/matching source/);
    const output = await command('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(profile_hash("source-face-v4"))', path.join(repo, 'scripts')]);
    expect(output.trim()).toBe(facialFingerprint(repo, 'source-face-v4'));
  });
  it('requires the calibrated worker capability without any additional model weights', () => {
    const selected = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const, facialConsistency: 'perform-onnx60' as const, facialEyeCalibration: true };
    expect(modelFilesForSettings(selected)).toEqual(modelFilesForSettings({ ...selected, facialEyeCalibration: false }));
    expect(facialRuntimeReadyForSettings(selected, { facialRuntimeReady: true, facialCleanupRuntimeReady: true })).toBe(false);
    expect(facialRuntimeReadyForSettings(selected, { facialCalibratedRuntimeReady: true })).toBe(true);
    expect(facialRuntimeReadyForSettings({ ...selected, facialConsistency: 'regional-onnx60' }, { facialCleanupRuntimeReady: true })).toBe(true);
  });
  it.each(['valid', 'valid-skip', 'wrong-anchor', 'missing-state', 'changed-state', 'changed-source', 'mouth-changed', 'cpu-parser'] as const)('validates downloaded calibrated state offline: %s', async variant => {
    const { store, job, folder } = await fixture();
    job.settings.facialEyeCalibration = true;
    job.facialConsistency = newFacialRun(job, repo, 123);
    const run = job.facialConsistency!;
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
    Object.assign(run, { preflightComplete: true, state: 'downloaded' });
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
    state.facialRuntimeReady = true; state.facialCleanupRuntimeReady = true; state.facialCalibratedRuntimeReady = false;
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
