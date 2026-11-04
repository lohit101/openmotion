import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createKieApplication } from '../server/kie-index';
import { command, probe } from '../server/media';
import { kieFileHash, type KieClientLike } from '../server/kie-jobs';
import { KieApiError, type KieTask, type KieVideoInput } from '../server/kie-client';
import { KIE_MODEL, kieDefaults, type KieDraft } from '../shared/kie';
import type { Job } from '../shared/types';

vi.setConfig({ testTimeout: 20000 });
const apps: Awaited<ReturnType<typeof createKieApplication>>[] = [], roots: string[] = [];
let mediaRoot: string, source: string, reference: string, generated: string;
const apiKey = 'fixture-kie-key-1234567890';
beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'kie-local-media-')); source = path.join(mediaRoot, 'source.mp4'); reference = path.join(mediaRoot, 'reference.png'); generated = path.join(mediaRoot, 'generated.mp4');
  await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x320:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
  await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=240x320', '-frames:v', '1', '-threads', '2', reference]);
  await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x320:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', generated]);
});
afterEach(async () => { for (const app of apps) await app.shutdown(); apps.length = 0; for (const root of roots) await rm(root, { recursive: true, force: true }); roots.length = 0; });
afterAll(async () => { await rm(mediaRoot, { recursive: true, force: true }); });
async function until(read: () => Job | null, predicate: (job: Job) => boolean) { for (let i = 0; i < 1000; i++) { const job = read(); if (job && predicate(job)) return job; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('The isolated mock task did not settle.'); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.kie-app-test-')); roots.push(root);
  const calls = { credits: 0, uploads: [] as string[], creates: [] as KieVideoInput[], tasks: [] as string[], downloads: 0 };
  let mode = 'success', outputFile = generated, lastInput: KieVideoInput | undefined;
  const client: KieClientLike = {
    async getCredits() { calls.credits++; if (mode === 'invalid-key') throw new KieApiError('Invalid API key', 'rejected', 401); return 100; },
    async uploadFile(file, _key, kind) { calls.uploads.push(kind); return { url: `https://media.example.test/${kind}/${await kieFileHash(file)}`, expiresAt: new Date(Date.now() + 24*3600*1000).toISOString(), fileName: kind, bytes: (await stat(file)).size }; },
    async createTask(_key, input) { calls.creates.push(input); lastInput = input; if (mode === 'ambiguous') throw new KieApiError('Response lost', 'ambiguous'); if (mode === 'not-sent') throw new KieApiError('Reference DNS failed before POST', 'transient', undefined, undefined, true); if (mode === 'rejected') throw new KieApiError('Invalid provider request', 'rejected', 422); return { taskId: 'task_fixture_1' }; },
    async getTask(_key, id) { calls.tasks.push(id); return { taskId: id, state: mode === 'waiting' ? 'waiting' : 'succeeded', providerState: mode === 'waiting' ? 'waiting' : 'success', model: KIE_MODEL, input: mode === 'wrong-task' ? { ...lastInput!, prompt: 'Other request' } : lastInput, progress: mode === 'waiting' ? 0 : 100, urls: ['https://media.example.test/completed.mp4'], creditsConsumed: 12, costTime: 15 } satisfies KieTask; },
    async downloadResult(_url, destination) { calls.downloads++; await copyFile(outputFile, destination); if (mode === 'missing-audio') await rename(path.join(path.dirname(destination), 'prepared-source.mp4'), path.join(path.dirname(destination), 'prepared-source.saved.mp4')); return { path: destination, bytes: (await stat(destination)).size, sha256: await kieFileHash(destination) }; },
  };
  const app = await createKieApplication({ dataRoot: root, apiClient: client, pollMs: 10 }); apps.push(app);
  async function saveKey() { await request(app.app).post('/api/kie/account').send({ apiKey }).expect(200); }
  async function inputs() {
    const video = await request(app.app).post('/api/assets/video').attach('file', source).expect(201), image = await request(app.app).post('/api/assets/image').attach('file', reference).expect(201);
    return { ...kieDefaults, sourceId: video.body.id, referenceId: image.body.id, seconds: 2 } satisfies KieDraft;
  }
  async function start(draft: KieDraft, id = randomUUID()) { const response = await request(app.app).post('/api/kie/jobs').set('Idempotency-Key', id).send(draft).expect(202); return response.body as Job; }
  return { app, calls, root, client, saveKey, inputs, start, mode: (value: string) => { mode = value; }, output: (file: string) => { outputFile = file; } };
}
it('starts an isolated API workspace with no implicit provider activity or GPU routes', async () => {
  const f = await fixture(), response = await request(f.app.app).get('/api/bootstrap').expect(200);
  expect(response.body.kie).toMatchObject({ provider: 'kie.ai', draft: { resolution: '480P', seconds: 5 }, account: { configured: false } });
  expect(response.body.jobs).toEqual([]); expect(response.body.cloud.instances).toEqual([]); expect(response.body.models.files).toEqual([]);
  for (const route of ['/api/cloud', '/api/models', '/api/connection/connect', '/api/images/jobs']) await request(f.app.app).get(route).expect(404);
  for (const route of ['/api/cloud/instances/42/start', '/api/models/download', '/api/jobs']) await request(f.app.app).post(route).send({}).expect(404);
  expect(f.calls).toMatchObject({ credits: 0, uploads: [], creates: [], tasks: [], downloads: 0 });
});
it('validates the key with a read-only credit call and stores it privately without browser/database exposure', async () => {
  const f = await fixture(); await f.saveKey(); expect(f.calls.credits).toBe(1); expect(f.calls.creates).toEqual([]);
  const file = path.join(f.root, 'secrets/kie-api-key.json'); expect((await stat(file)).mode & 0o777).toBe(0o600); expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  const body = (await request(f.app.app).get('/api/bootstrap').expect(200)).body; expect(JSON.stringify(body)).not.toContain(apiKey); expect(body.kie.account.keyHint).toBe('••••7890');
  const settings = f.app.store.db.prepare('SELECT data FROM settings').all(); expect(JSON.stringify(settings)).not.toContain(apiKey);
  await request(f.app.app).get('/api/kie/account').expect(200); expect(f.calls.credits).toBe(1);
  await request(f.app.app).get('/api/kie/account?refresh=1').expect(200); expect(f.calls.credits).toBe(2);
  await request(f.app.app).post('/api/kie/account').set('Origin', 'https://example.com').send({ apiKey }).expect(403);
});
it('submits only after Generate, saves the task handle, copies source audio and reports actual output metadata', async () => {
  const f = await fixture(); await f.saveKey(); const draft = await f.inputs();
  expect(f.calls.uploads).toEqual([]); await request(f.app.app).put('/api/kie/draft').send(draft).expect(200); expect(f.calls.creates).toEqual([]);
  const job = await f.start(draft), completed = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status));
  expect(completed.error).toBeNull(); expect(completed.status).toBe('completed'); expect(completed.origin).toBe('api'); expect(completed.kie).toMatchObject({ taskId: 'task_fixture_1', submission: 'submitted', phase: 'complete', creditsConsumed: 12, output: { duration: 2, fps: 24, frames: 48, width: 240, height: 320, audio: 'source' } });
  expect(f.calls.creates).toHaveLength(1); expect(f.calls.creates[0]).toMatchObject({ resolution: '480P', duration: 2, aspect_ratio: '3:4', audio: false }); expect(f.calls.creates[0]?.prompt).toContain('Video1');
  expect(f.calls.uploads).toEqual(['video', 'image']); expect(f.calls.tasks).toEqual(['task_fixture_1']);
  const publicData = (await request(f.app.app).get('/api/bootstrap')).body; expect(JSON.stringify(publicData)).not.toContain('media.example.test'); expect(JSON.stringify(publicData)).not.toContain(f.root); expect(JSON.stringify(publicData)).not.toContain(apiKey);
  await request(f.app.app).get(`/api/jobs/${job.id}/video`).set('Range', 'bytes=0-15').expect(206);
  const receipt = await request(f.app.app).get(`/api/jobs/${job.id}/receipt`).expect(200); expect(JSON.stringify(receipt.body)).not.toContain('https://');
});
it('requests and retains provider-generated audio when original audio is disabled', async () => {
  const f = await fixture(); await f.saveKey(); const draft = { ...await f.inputs(), keepSourceAudio: false, resolution: '1080P' as const, seed: 99 };
  const job = await f.start(draft), done = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status));
  expect(done.error).toBeNull(); expect(done.kie?.output?.audio).toBe('generated'); expect(f.calls.creates[0]).toMatchObject({ audio: true, resolution: '1080P', seed: 99 });
});
it('does not resubmit an ambiguous paid creation, including different local request IDs for the same inputs', async () => {
  const f = await fixture(); await f.saveKey(); const draft = await f.inputs(); f.mode('ambiguous');
  const job = await f.start(draft), interrupted = await until(() => f.app.store.job(job.id), j => j.status === 'interrupted');
  expect(interrupted.kie).toMatchObject({ submission: 'unknown', phase: 'attention' }); expect(interrupted.kie?.taskId).toBeUndefined();
  await request(f.app.app).post(`/api/kie/jobs/${job.id}/resume`).send({}).expect(400);
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', randomUUID()).send(draft).expect(400);
  expect(f.calls.creates).toHaveLength(1);
  f.mode('wrong-task'); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({ taskId: 'history_task' }).expect(400); expect(f.app.store.job(job.id)?.kie?.taskId).toBeUndefined();
  f.mode('success'); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({ taskId: 'history_task' }).expect(200);
  const recovered = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status)); expect(recovered.error).toBeNull(); expect(recovered.kie?.taskId).toBe('history_task'); expect(f.calls.creates).toHaveLength(1);
});
it('stops only local observation and recovers the same accepted task without another upload or paid POST', async () => {
  const f = await fixture(); await f.saveKey(); const draft = await f.inputs(); f.mode('waiting'); const job = await f.start(draft);
  await until(() => f.app.store.job(job.id), j => !!j.kie?.taskId && j.kie.phase === 'waiting');
  await request(f.app.app).post('/api/kie/account').send({ apiKey }).expect(409);
  const cancelled = await request(f.app.app).post(`/api/kie/jobs/${job.id}/cancel`).send({}).expect(200); expect(cancelled.body.kie.cancellationNotice).toMatch(/Kie.ai may continue/); expect(cancelled.body.kie.taskId).toBe('task_fixture_1');
  f.mode('success'); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(200);
  const done = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status)); expect(done.error).toBeNull(); expect(f.calls.creates).toHaveLength(1); expect(f.calls.uploads).toHaveLength(2);
});
it('holds definite provider rejections without silently retrying the paid POST', async () => {
  const f = await fixture(); await f.saveKey(); f.mode('rejected'); const job = await f.start(await f.inputs());
  const done = await until(() => f.app.store.job(job.id), j => j.status === 'failed'); expect(done.kie?.submission).toBe('rejected');
  await request(f.app.app).post(`/api/kie/jobs/${job.id}/resume`).send({}).expect(400); expect(f.calls.creates).toHaveLength(1);
});
it('rejects unsupported durations and out-of-range selections before external upload', async () => {
  const f = await fixture(); await f.saveKey(); const draft = await f.inputs();
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', randomUUID()).send({ ...draft, seconds: 2.5 }).expect(422);
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', randomUUID()).send({ ...draft, start: 3, seconds: 2 }).expect(400);
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', randomUUID()).send({ ...draft, seconds: 16 }).expect(422);
  expect(f.calls.uploads).toEqual([]); expect(f.calls.creates).toEqual([]);
});
it('refuses a legacy database folder before opening or modifying it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kie-protected-db-')); roots.push(root); const db = path.join(root, 'studio.sqlite'); await writeFile(db, 'legacy paid records');
  const before = await readFile(db); await expect(createKieApplication({ dataRoot: root })).rejects.toThrow(/existing database was not opened/); expect(await readFile(db)).toEqual(before);
});
it('keeps the existing key when replacement validation fails', async () => {
  const f = await fixture(); await f.saveKey(); const file = path.join(f.root, 'secrets/kie-api-key.json'), before = await readFile(file);
  f.mode('invalid-key'); await request(f.app.app).post('/api/kie/account').send({ apiKey: 'invalid-replacement-fixture' }).expect(400);
  expect(await readFile(file)).toEqual(before); expect(f.calls.creates).toEqual([]); expect(f.calls.uploads).toEqual([]);
});
it('deduplicates concurrent Generate requests and rejects reuse of an ID with different settings', async () => {
  const f = await fixture(); await f.saveKey(); const draft = await f.inputs(); f.mode('waiting'); const key = randomUUID();
  const [a, b] = await Promise.all([f.start(draft, key), f.start(draft, key)]); expect(a.id).toBe(b.id);
  await until(() => f.app.store.job(a.id), j => !!j.kie?.taskId);
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', key).send({ ...draft, seed: 1 }).expect(400);
  await request(f.app.app).post('/api/kie/jobs').set('Idempotency-Key', randomUUID()).send(draft).expect(400);
  expect(f.calls.creates).toHaveLength(1); expect(f.app.store.jobs()).toHaveLength(1);
});
it('restores a journaled task ID after restart without provider calls, then recovers that same task', async () => {
  const f = await fixture(); await f.saveKey(); f.mode('waiting'); const job = await f.start(await f.inputs());
  await until(() => f.app.store.job(job.id), j => !!j.kie?.taskId); await f.app.jobs.cancel(f.app.store.job(job.id)!);
  const saved = f.app.store.job(job.id)!; delete saved.kie!.taskId; saved.kie!.submission = 'submitting'; saved.status = 'running'; f.app.store.saveJob(saved, false);
  await f.app.shutdown(); apps.splice(apps.indexOf(f.app), 1); const before = JSON.stringify(f.calls);
  const restarted = await createKieApplication({ dataRoot: f.root, apiClient: f.client, pollMs: 10 }); apps.push(restarted);
  expect(JSON.stringify(f.calls)).toBe(before); expect(restarted.store.job(job.id)).toMatchObject({ status: 'interrupted', kie: { taskId: 'task_fixture_1', submission: 'submitted' } });
  f.mode('success'); await request(restarted.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(200);
  const done = await until(() => restarted.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status)); expect(done.error).toBeNull(); expect(f.calls.creates).toHaveLength(1); expect(f.calls.uploads).toHaveLength(2);
});
it('finishes a verified paid download offline without a key or a second provider request', async () => {
  const f = await fixture(); await f.saveKey(); f.mode('missing-audio'); const job = await f.start(await f.inputs());
  const held = await until(() => f.app.store.job(job.id), j => j.status === 'interrupted'); expect(held.error).toMatch(/paid provider video is saved/);
  const folder = path.join(f.root, 'jobs', job.id); await rename(path.join(folder, 'prepared-source.saved.mp4'), path.join(folder, 'prepared-source.mp4')); await unlink(path.join(f.root, 'secrets/kie-api-key.json'));
  const before = JSON.stringify(f.calls); f.mode('success'); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(200);
  const done = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status)); expect(done.error).toBeNull(); expect(done.status).toBe('completed'); expect(JSON.stringify(f.calls)).toBe(before);
});
it('allows an explicit retry after a verified pre-POST failure without treating it as an unknown paid task', async () => {
  const f = await fixture(); await f.saveKey(); f.mode('not-sent'); const job = await f.start(await f.inputs());
  const held = await until(() => f.app.store.job(job.id), j => j.status === 'interrupted'); expect(held.kie?.submission).toBe('not-submitted'); expect(f.calls.creates).toHaveLength(1);
  f.mode('success'); await request(f.app.app).post(`/api/kie/jobs/${job.id}/resume`).send({}).expect(200);
  const done = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status)); expect(done.error).toBeNull(); expect(f.calls.creates).toHaveLength(2); expect(f.calls.uploads).toHaveLength(2);
});
it('adopts only a task-bound verified client download after a crash, without a key or network', async () => {
  const f = await fixture(); await f.saveKey(); f.mode('missing-audio'); const job = await f.start(await f.inputs());
  await until(() => f.app.store.job(job.id), j => j.status === 'interrupted');
  const folder = path.join(f.root, 'jobs', job.id), output = path.join(folder, 'api-output.mp4'), journal = path.join(folder, 'kie-download.json'), resultFile = path.join(folder, 'kie-result.json');
  const result = JSON.parse(await readFile(resultFile, 'utf8')), proofFile = output + '.download.json';
  const proof = { path: output, sourceHash: createHash('sha256').update(new URL(result.url).href).digest('hex'), sha256: await kieFileHash(output), bytes: (await stat(output)).size };
  await writeFile(proofFile, JSON.stringify(proof)); await unlink(journal); await unlink(path.join(f.root, 'secrets/kie-api-key.json'));
  await rename(path.join(folder, 'prepared-source.saved.mp4'), path.join(folder, 'prepared-source.mp4'));
  const before = JSON.stringify(f.calls);
  // None of these invalid proofs may create a manager receipt or contact Kie.
  for (const bad of [{ ...proof, sourceHash: 'a'.repeat(64) }, { ...proof, sha256: 'b'.repeat(64) }, { ...proof, bytes: proof.bytes + 1 }]) {
    await writeFile(proofFile, JSON.stringify(bad)); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(400);
    await expect(stat(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  await writeFile(proofFile, JSON.stringify(proof)); await writeFile(resultFile, JSON.stringify({ ...result, taskId: 'unrelated_task' }));
  await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(400); await expect(stat(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(resultFile, JSON.stringify(result)); await request(f.app.app).post(`/api/kie/jobs/${job.id}/recover`).send({}).expect(200);
  const done = await until(() => f.app.store.job(job.id), j => ['completed', 'interrupted', 'failed'].includes(j.status));
  expect(done.error).toBeNull(); expect(done.status).toBe('completed'); expect(JSON.stringify(f.calls)).toBe(before);
  expect(JSON.parse(await readFile(journal, 'utf8')).recoveredFrom).toBe('verified-client-download');
});
