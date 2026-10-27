import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';
import { command, videoFrameInfo } from '../server/media';
import { defaults, type Job } from '../shared/types';
import { clipSeconds, locateTimeline, timelineLayout, trimTimelineClip, type EditorSource, type TimelineClip } from '../shared/clip-editor';
import { runSummary, savedRunSettings } from '../shared/library';

let root: string, local: Awaited<ReturnType<typeof createApplication>>, source: Job;
const digest = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
async function done(id: string) {
  for (let attempt = 0; attempt < 250; attempt++) { const row = local.clipEditor.get(id)!; if (['completed', 'failed', 'cancelled'].includes(row.status)) { if (row.status !== 'completed') throw new Error(row.error || row.stage); return row; } await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Local fixture export did not finish');
}
const hashes = async (file: string, start?: number, end?: number, extraFilter = '') => (await command('ffmpeg', ['-v', 'error', '-i', file, '-an', ...(start !== undefined ? ['-vf', `trim=start_frame=${start}:end_frame=${end}${extraFilter ? ',' + extraFilter : ''}`] : []), '-f', 'framemd5', '-'])).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1)!.trim());

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "recast-edit-'quoted-"));
  const file = path.join(root, 'source.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x224:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest', file]);
  local = await createApplication({ dataRoot: path.join(root, 'data'), seed: false, allowSSH: false });
  source = { id: 'library-video', title: 'Source fixture', status: 'completed', settings: { ...defaults, engine: 'viggle', fps: 24, seconds: 3 }, sourceId: 'input', referenceId: 'reference', createdAt: '2026-10-28', favorite: false, deleted: false, width: 128, height: 224, progress: { stage: 'Complete', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: 72, targetFrames: 72, updatedAt: 0 }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: file, poster: file, cancelRequested: false, elapsedSeconds: 1, origin: 'import', workflow: null };
  local.store.addJob(source);
});
afterAll(async () => { if (local) { await local.clipEditor.shutdown(); local.cloud.dispose(); local.store.close(); } if (root) await rm(root, { recursive: true, force: true }); });

describe('local lightweight clip editor', () => {
  it('trims exact non-keyframe ranges losslessly, joins them, and keeps source files and AI settings unchanged', async () => {
    const originalHash = await digest(source.output!), before = JSON.stringify(local.store.job(source.id));
    const clips = [{ id: randomUUID(), jobId: source.id, inFrame: 7, outFrame: 31 }, { id: randomUUID(), jobId: source.id, inFrame: 13, outFrame: 49 }];
    const result = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'Exact lossless edit', mode: 'lossless', clips });
    expect(result.status).toBe(202); const completed = await done(result.body.id), job = local.store.job(completed.resultJobId!)!;
    expect(job.edit).toMatchObject({ mode: 'lossless', method: 'lossless-encode', format: 'mkv', frames: 60, duration: 2.5 });
    const master = path.join(local.store.root, 'jobs', job.id, 'master.mkv');
    expect(await hashes(master)).toEqual([...(await hashes(source.output!, 7, 31)), ...(await hashes(source.output!, 13, 49))]);
    const expectedAudio = await command('ffmpeg', ['-v', 'error', '-i', source.output!, '-i', source.output!, '-filter_complex', '[0:a]atrim=start_sample=14000:end_sample=62000,asetpts=PTS-STARTPTS[a0];[1:a]atrim=start_sample=26000:end_sample=98000,asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_f32le', '-f', 'hash', '-hash', 'sha256', '-']);
    const actualAudio = await command('ffmpeg', ['-v', 'error', '-i', master, '-vn', '-c:a', 'pcm_f32le', '-f', 'hash', '-hash', 'sha256', '-']);
    expect(actualAudio.trim()).toBe(expectedAudio.trim());
    expect((await videoFrameInfo(job.output!)).frames).toBe(60);
    const download = await request(local.app).get(`/api/jobs/${job.id}/video?download=1`);
    expect(download.status).toBe(200); expect(download.headers['content-disposition']).toContain('.mkv');
    expect(await digest(source.output!)).toBe(originalHash); expect(JSON.stringify(local.store.job(source.id))).toBe(before);
    expect(savedRunSettings(job)).not.toHaveProperty('seed'); expect(runSummary(job)).toContainEqual(['Workflow', 'Local clip edit']);
    expect(local.connection.status.state).toBe('offline'); expect(local.runner.busy).toBe(false);
  }, 20000);
  it('copies compatible whole clips without re-encoding, including paths containing quotes', async () => {
    const file = path.join(root, 'silent-copy.mp4');
    await command('ffmpeg', ['-v', 'error', '-y', '-i', source.output!, '-map', '0:v:0', '-c', 'copy', '-an', file]);
    local.store.addJob({ ...source, id: 'silent-copy', output: file });
    const key = randomUUID(), draft = { title: 'Original streams', mode: 'lossless', clips: [0, 1].map(() => ({ id: randomUUID(), jobId: 'silent-copy', inFrame: 0, outFrame: 72 })) };
    const replies = await Promise.all([0, 1].map(() => request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', key).send(draft)));
    expect(replies.map(reply => reply.status)).toEqual([202, 202]); expect(replies[0].body.id).toBe(replies[1].body.id);
    const complete = await done(replies[0].body.id), job = local.store.job(complete.resultJobId!)!;
    expect(job.edit?.method).toBe('stream-copy'); expect((await videoFrameInfo(job.output!)).frames).toBe(144);
    const expected = await hashes(source.output!); expect(await hashes(job.output!)).toEqual([...expected, ...expected]);
    const mismatch = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', key).send({ ...draft, title: 'Changed' }); expect(mismatch.status).toBe(400);
  }, 20000);
  it('rejects photos, missing media, invalid ranges and foreign origins without touching GPU compute', async () => {
    const base = { title: 'Invalid', mode: 'lossless', clips: [{ id: randomUUID(), jobId: source.id, inFrame: 0, outFrame: 9999 }] };
    expect((await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send(base)).status).toBe(400);
    expect((await request(local.app).get('/api/clip-editor/sources/not-a-job')).status).toBe(400);
    expect((await request(local.app).post('/api/clip-editor/exports').set('Origin', 'https://elsewhere.invalid').set('Idempotency-Key', randomUUID()).send(base)).status).toBe(403);
    local.store.addJob({ ...source, id: 'photo', mediaType: 'image' }); expect((await request(local.app).get('/api/clip-editor/sources/photo')).status).toBe(400);
    expect(local.runner.busy).toBe(false);
  });
  it('exports a playable frame-accurate MP4 as an explicit lossy alternative', async () => {
    const result = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'MP4 edit', mode: 'mp4', clips: [{ id: randomUUID(), jobId: source.id, inFrame: 7, outFrame: 31 }] });
    expect(result.status).toBe(202); const completed = await done(result.body.id), job = local.store.job(completed.resultJobId!)!;
    expect(job.edit).toMatchObject({ format: 'mp4', method: 'h264-encode', frames: 24, duration: 1 });
    expect((await videoFrameInfo(job.output!)).frames).toBe(24);
  }, 20000);
  it('keeps two single-frame silent cuts without duplicate or discarded frames', async () => {
    const file = path.join(root, 'silent.mp4');
    await command('ffmpeg', ['-v', 'error', '-y', '-i', source.output!, '-map', '0:v:0', '-c', 'copy', '-an', file]);
    const silent = { ...source, id: 'silent', output: file }; local.store.addJob(silent);
    const result = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'Single frame cuts', mode: 'lossless', clips: [7, 13].map(start => ({ id: randomUUID(), jobId: silent.id, inFrame: start, outFrame: start + 1 })) });
    expect(result.status).toBe(202); const completed = await done(result.body.id), job = local.store.job(completed.resultJobId!)!, master = path.join(local.store.root, 'jobs', job.id, 'master.mkv');
    expect(await hashes(master)).toEqual([...(await hashes(file, 7, 8)), ...(await hashes(file, 13, 14))]);
  }, 20000);
  it('pads different sizes without changing their selected pixels', async () => {
    const file = path.join(root, 'wide.mp4');
    await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=256x224:rate=24:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    local.store.addJob({ ...source, id: 'wide', width: 256, output: file });
    const result = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'Padded edit', mode: 'lossless', clips: [source.id, 'wide'].map(jobId => ({ id: randomUUID(), jobId, inFrame: 0, outFrame: 12 })) });
    expect(result.status).toBe(202); const completed = await done(result.body.id), job = local.store.job(completed.resultJobId!)!;
    expect(job.edit).toMatchObject({ width: 256, height: 224, frames: 24 });
    expect(await hashes(path.join(local.store.root, 'jobs', job.id, 'master.mkv'))).toEqual([...(await hashes(source.output!, 0, 12, 'pad=256:224:64:0')), ...(await hashes(file, 0, 12))]);
  }, 20000);
  it('requires an explicit MP4 conversion when frame rates differ', async () => {
    const file = path.join(root, 'thirty-fps.mp4');
    await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x224:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    local.store.addJob({ ...source, id: 'thirty-fps', output: file });
    const draft = { title: 'Mixed rates', mode: 'lossless', clips: [{ id: randomUUID(), jobId: source.id, inFrame: 0, outFrame: 24 }, { id: randomUUID(), jobId: 'thirty-fps', inFrame: 0, outFrame: 30 }] };
    expect((await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send(draft)).status).toBe(400);
    const result = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ ...draft, mode: 'mp4' });
    expect(result.status).toBe(202); const completed = await done(result.body.id), job = local.store.job(completed.resultJobId!)!;
    expect(job.edit).toMatchObject({ fps: 30, frames: 60, duration: 2 });
  }, 20000);
  it('uses frame boundaries for inline handles and locates reordered/repeated clips correctly', async () => {
    const meta: EditorSource = await local.clipEditor.sourceInfo(source.id), clip: TimelineClip = { id: randomUUID(), jobId: source.id, inFrame: 7, outFrame: 31 };
    expect(trimTimelineClip(clip, 'in', 100, meta).inFrame).toBe(30); expect(trimTimelineClip(clip, 'out', -10, meta).outFrame).toBe(8);
    const duplicate = { ...clip, id: randomUUID(), inFrame: 13, outFrame: 49 }, sources = { [source.id]: meta }, layout = timelineLayout([clip, duplicate], sources);
    expect(clipSeconds(clip, meta)).toBe(1); expect(layout[1].start).toBe(1); expect(locateTimeline([clip, duplicate], sources, 1)?.clip.id).toBe(duplicate.id);
    expect(locateTimeline([duplicate, clip], sources, 1.5)?.clip.id).toBe(clip.id);
  });
});
