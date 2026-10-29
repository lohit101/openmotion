import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaults, settingsSchema, type Job } from '../shared/types';
import { facialModelFiles, modelFilesForSettings } from '../shared/models';
import { canFinishFacialLocally } from '../shared/facial-consistency';
import { engineIssue } from '../shared/engines';
import { overallProgressEstimate } from '../shared/generation-progress';
import { faceHash, FacialConsistencyError, newFacialRun, type FacialBackend } from '../server/facial-consistency';
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
  const job: Job = { id: randomUUID(), title: 'Protocol-only face pipeline', status: 'queued', settings: { ...defaults, engine: 'viggle', referencePreparation: 'prepared', facialConsistency: profile, seconds: 5/24 },
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
  it('keeps old jobs off and requires the chosen files without changing the video graph', () => {
    expect(settingsSchema.parse({}).facialConsistency).toBe('off');
    const normal = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const };
    expect(modelFilesForSettings(normal).some(id => id.startsWith('face_consistency/'))).toBe(false);
    for (const facialConsistency of ['perform-onnx60', 'regional-onnx60'] as const) {
      expect(modelFilesForSettings({ ...normal, facialConsistency }).filter(id => id.startsWith('face_consistency/'))).toEqual(facialModelFiles);
      expect(engineIssue({ ...normal, facialConsistency })).toBeNull();
      expect(engineIssue({ ...normal, facialConsistency, referencePreparation: 'auto' })).toContain('already edited');
    }
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
});
