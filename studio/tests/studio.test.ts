import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createApplication } from '../server/index';
import { applyProgress, localEndpoint } from '../server/comfy';
import { command, probe } from '../server/media';
import { compileWorkflow, validateGraph, RELIGHT } from '../server/workflow';
import { defaults, geometry, nextSegment, segmentCount } from '../shared/types';
import type { Catalog, Graph, Job } from '../shared/types';

const repo = path.resolve(import.meta.dirname, '../..');
const catalog: Catalog = JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));
const template: Graph = JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
let fixtures: string, video: string, image: string;
beforeAll(async () => {
  fixtures = await mkdtemp(path.join(os.tmpdir(), 'recast-fixtures-')); video = path.join(fixtures, 'source.mp4'); image = path.join(fixtures, 'character.png');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=16:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await command('ffmpeg', ['-v', 'error', '-y', '-i', video, '-frames:v', '1', image]);
});
afterAll(async () => { await rm(fixtures, { recursive: true, force: true }); });
async function until<T>(read: () => T, predicate: (value: T) => boolean, timeout = 12000): Promise<T> {
  const start = Date.now(); let value = read();
  while (!predicate(value)) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for state: ' + JSON.stringify(value)); await new Promise(r => setTimeout(r, 35)); value = read(); }
  return value;
}
function jobFixture(): Job {
  return { id: randomUUID(), title: 'Protocol test', status: 'running', sourceId: 'video', referenceId: 'image', settings: { ...defaults }, createdAt: new Date().toISOString(), favorite: false, deleted: false,
    width: 480, height: 800, progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 48, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: { source: 'source.mp4', reference: 'character.png' }, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}

// A local protocol fixture, never a product mode. Media is FFmpeg passthrough;
// it checks API contracts, recovery and assembly, not model quality or speed.
async function mockComfy() {
  const app = express(), server = createServer(app), ws = new WebSocketServer({ server, path: '/ws' });
  const localCatalog = structuredClone(catalog), sockets = new Map<string, WebSocket>(), uploads = new Map<string, string>(), files = new Map<string, string>();
  const pending = new Map<string, any[]>(), history: Record<string, any> = {}, submissions: any[] = [], cancelled: string[] = [], calls: string[] = [];
  let mode: 'complete' | 'hold' | 'lose-response' = 'complete', dropHistory = false, dropCancel = false;
  app.use(express.json({ limit: '5mb' })); app.use((req, _res, next) => { calls.push(req.method + ' ' + req.path); next(); });
  ws.on('connection', (socket, req) => { sockets.set(new URL(req.url!, 'http://localhost').searchParams.get('clientId')!, socket); });
  const emit = (client: string, type: string, data: unknown) => sockets.get(client)?.send(JSON.stringify({ type, data }));
  app.get('/system_stats', (_req, res) => res.json({ devices: [{ type: 'cuda', name: 'Fixture GPU, no inference' }] }));
  app.get('/object_info', (_req, res) => res.json(localCatalog));
  app.post('/upload/image', multer({ storage: multer.memoryStorage() }).single('image'), async (req, res) => {
    const name = req.file!.originalname, file = path.join(fixtures, randomUUID() + path.extname(name)); await writeFile(file, req.file!.buffer); uploads.set(name, file);
    for (const choices of [localCatalog.LoadImage.input.required!.image[0], localCatalog.VHS_LoadVideo.input.required!.video[0]]) if (Array.isArray(choices)) choices.push(name);
    res.json({ name, subfolder: '', type: 'input' });
  });
  app.get('/queue', (_req, res) => res.json({ queue_running: [...pending.values()], queue_pending: [] }));
  app.get('/history', (_req, res) => res.json(history));
  app.get('/history/:id', (req, res) => { if (dropHistory) { dropHistory = false; req.socket.destroy(); return; } res.json(history[req.params.id] ? { [req.params.id]: history[req.params.id] } : {}); });
  async function complete(id: string) {
    const entry = pending.get(id); if (!entry) return;
    const graph = entry[2] as Graph, controls = graph['1'].inputs, fps = Number(controls.fps), cap = Number(controls.frame_cap), skip = Number(controls.skip_frames), overlap = skip ? 5 : 0;
    const filename = id + '.mp4', file = path.join(fixtures, filename);
    await command('ffmpeg', ['-v', 'error', '-y', '-ss', String((skip + overlap) / fps), '-i', uploads.get(String(graph['2'].inputs.video))!, '-frames:v', String(cap - overlap), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    files.set(filename, file); history[id] = { prompt: entry, status: { status_str: 'success', completed: true, messages: [] }, outputs: {
      '46': { gifs: [{ filename, subfolder: 'recast', type: 'output' }] }, '47': { context: [{ path: '/gpu/output/context-' + id + '.safetensors', source_count: cap, source_end_frame: skip + cap, fps }] }
    } }; pending.delete(id); emit(entry[3].client_id, 'executing', { prompt_id: id, node: null });
  }
  app.post('/prompt', (req, res) => {
    const id = randomUUID(), entry = [submissions.length, id, req.body.prompt, { client_id: req.body.client_id }, []];
    submissions.push({ id, ...req.body, socketReady: sockets.get(req.body.client_id)?.readyState === WebSocket.OPEN }); pending.set(id, entry);
    if (mode === 'lose-response') { req.socket.destroy(); return; }
    emit(req.body.client_id, 'execution_start', { prompt_id: id });
    emit(req.body.client_id, 'executing', { prompt_id: id, node: '43' });
    emit(req.body.client_id, 'progress', { prompt_id: id, node: '43', value: 2, max: 6 });
    res.json({ prompt_id: id, node_errors: {} });
    if (mode === 'complete') void complete(id);
  });
  app.post('/api/jobs/:id/cancel', (req, res) => { if (dropCancel) { dropCancel = false; req.socket.destroy(); return; } cancelled.push(req.params.id); pending.delete(req.params.id); res.json({ cancelled: true }); });
  app.get('/view', (req, res) => { const file = files.get(String(req.query.filename)); if (file) res.sendFile(file); else res.sendStatus(404); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { endpoint: `http://127.0.0.1:${address.port}`, calls, submissions, cancelled, pending, history, complete, emit,
    setMode(value: typeof mode) { mode = value; }, loseNextHistory() { dropHistory = true; }, loseNextCancel() { dropCancel = true; },
    async close() { for (const socket of ws.clients) socket.terminate(); ws.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  };
}

describe('native workflow and progress contracts', () => {
  it('uses five-frame continuity without duplicating output frames', () => {
    expect(segmentCount(94, 81)).toBe(2); expect(nextSegment(0, 94)).toEqual({ overlap: 0, skip: 0, cap: 81 }); expect(nextSegment(81, 94)).toEqual({ overlap: 5, skip: 76, cap: 18 });
    expect(geometry(defaults, { width: 480, height: 768 })).toEqual([480, 768]);
  });
  it('preserves shared model sampling, independent LoRA slots and native replacement flags', () => {
    const job = jobFixture(), local = structuredClone(catalog); (local.LoadImage.input.required!.image[0] as string[]).push('character.png');
    const graph = compileWorkflow(template, job); expect(validateGraph(graph, local)).toEqual([]);
    expect(graph['22'].inputs.model).toEqual(['50', 0]); expect(graph['50'].inputs.lora_name).toBe(RELIGHT);
    expect(graph['42'].inputs.model).toEqual(graph['43'].inputs.model); expect(graph['40'].inputs.replacement_mode).toBe(true);
    job.settings = { ...job.settings, preset: 'quality', mode: 'motion', loraA: 'missing-adapter.safetensors' }; const quality = compileWorkflow(template, job);
    expect(quality['50']).toBeUndefined(); expect(quality['24'].inputs.strength_model).toBe(0); expect(quality['42'].inputs.steps).toBe(20);
    expect(quality['43'].inputs.cfg).toBe(5); expect(quality['41'].inputs.sampler_name).toBe('uni_pc'); expect(quality['11'].inputs.replacement_mode).toBe(false);
    expect(validateGraph(quality, local).join()).toContain('missing-adapter.safetensors');
  });
  it('reports actual native counters and resets to indeterminate for stages without counters', () => {
    const job = jobFixture(); job.pendingPrompt = 'ours';
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'theirs', node: '43', value: 6, max: 6 } })).toBe(false);
    expect(applyProgress(job, { type: 'progress_state', data: { prompt_id: 'ours', nodes: { '43': { node_id: '43', state: 'running', value: 2, max: 6 } } } })).toBe(true);
    expect(job.progress).toMatchObject({ stage: 'Generating video', value: 2, max: 6, unit: 'steps' });
    applyProgress(job, { type: 'executing', data: { prompt_id: 'ours', node: '44' } }); expect(job.progress).toMatchObject({ stage: 'Decoding video', value: null, max: null });
  });
  it('keeps GPU URLs on the private local tunnel', () => {
    expect(localEndpoint('http://127.0.0.1:8188')).toBe('http://127.0.0.1:8188');
    for (const url of ['http://example.com', 'file:///etc/passwd', 'http://localhost:8188/path', 'http://user:secret@localhost']) expect(() => localEndpoint(url)).toThrow();
  });
});

describe('local app with the captured ComfyUI protocol', () => {
  let local: Awaited<ReturnType<typeof createApplication>> | undefined, mock: Awaited<ReturnType<typeof mockComfy>> | undefined, root = '';
  afterEach(async () => {
    if (local) { local.connection.disconnect(); local.runner.abort?.abort(); await until(() => local!.runner.busy, busy => !busy); local.store.close(); }
    await mock?.close(); if (root) await rm(root, { recursive: true, force: true }); local = undefined; mock = undefined;
  });
  async function setup() { root = await mkdtemp(path.join(os.tmpdir(), 'recast-test-')); mock = await mockComfy(); local = await createApplication({ dataRoot: root, seed: false, allowSSH: false, repo }); return request(local.app); }
  async function inputs(agent: ReturnType<typeof request>) {
    const source = await agent.post('/api/assets/video').attach('file', video).expect(201); const ref = await agent.post('/api/assets/image').attach('file', image).expect(201);
    return { sourceId: source.body.id, referenceId: ref.body.id, settings: { ...defaults, seconds: 3 } };
  }
  async function connect(agent: ReturnType<typeof request>) {
    await agent.post('/api/connection/connect').send({ endpoint: mock!.endpoint, useSSH: false }).expect(202);
    await until(() => local!.connection.status.state, state => state === 'online');
  }
  it('works offline, rejects invalid media and saves drafts without probing a GPU', async () => {
    const agent = await setup(); const values = await inputs(agent);
    expect((await agent.get('/api/bootstrap')).body.connection.state).toBe('offline'); expect(mock!.calls).toEqual([]);
    await agent.post('/api/draft').send(values).expect(200); expect(local!.store.draft().sourceId).toBe(values.sourceId);
    await agent.post('/api/jobs').set('Idempotency-Key', 'offline').send(values).expect(503);
    await agent.post('/api/assets/image').attach('file', Buffer.from('not an image'), 'invalid.png').expect(400);
    await agent.post('/api/draft').set('Origin', 'https://unrelated.example').send(values).expect(403);
    const media = await agent.get(`/api/assets/${values.sourceId}/original`).set('Range', 'bytes=0-99').expect(206); expect(media.body.length).toBe(100);
    expect(mock!.calls).toEqual([]);
  });
  it('submits once, receives real counters and assembles two segments with one audio track', async () => {
    const agent = await setup(), values = await inputs(agent); values.settings.seconds = 5.875; await connect(agent);
    const stages: any[] = []; local!.store.on('event', e => { if (e.type === 'job') stages.push(e.data.progress); });
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'two-segments').send(values).expect(201);
    const duplicate = await agent.post('/api/jobs').set('Idempotency-Key', 'two-segments').send(values).expect(200); expect(duplicate.body.id).toBe(response.body.id);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status), 25000);
    expect(job.error).toBeNull(); expect(job.status).toBe('completed'); expect(job.progress.completedFrames).toBe(94); expect(job.segments.map(s => s.frames)).toEqual([81, 13]);
    expect(mock!.submissions).toHaveLength(2); expect(mock!.submissions.every(s => s.socketReady)).toBe(true);
    expect(mock!.submissions[1].prompt['36'].inputs.context_path).toContain('context-'); expect(mock!.submissions[1].prompt['1'].inputs.skip_frames).toBe(76);
    expect(stages.some(s => s.node === '43' && s.value === 2 && s.max === 6)).toBe(true);
    const meta = await probe(job.output!); expect(meta.duration).toBeCloseTo(5.875, 1); expect(meta.fps).toBe(16); expect(meta.hasAudio).toBe(true);
    const frames = JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames,codec_type', '-of', 'json', job.output!]));
    expect(frames.streams.find((s: any) => s.codec_type === 'video').nb_read_frames).toBe('94');
    await agent.get(`/api/jobs/${job.id}/video`).set('Range', 'bytes=0-99').expect(206); await agent.get(`/api/jobs/${job.id}/workflow`).expect(200);
    await agent.patch(`/api/jobs/${job.id}`).send({ favorite: true, title: 'Saved take', deleted: true }).expect(200);
    await agent.patch(`/api/jobs/${job.id}`).send({ deleted: false }).expect(200); expect(local!.store.job(job.id)).toMatchObject({ favorite: true, title: 'Saved take', deleted: false });
  }, 30000);
  it('cancels only its own prompt and requires acknowledgement before showing cancelled', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('hold'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'cancel').send(values).expect(201), id = response.body.id;
    await until(() => local!.store.job(id)!.pendingPrompt, Boolean);
    mock!.pending.set('someone-else', [99, 'someone-else', {}, { client_id: 'another-user' }]);
    await agent.post(`/api/jobs/${id}/cancel`).send({}).expect(200); await until(() => local!.runner.busy, busy => !busy);
    expect(local!.store.job(id)).toMatchObject({ status: 'cancelled', cancellationConfirmed: true }); expect(mock!.cancelled).toEqual([mock!.submissions[0].id]); expect(mock!.pending.has('someone-else')).toBe(true);
    expect(mock!.calls.some(c => c.includes('/interrupt'))).toBe(false);
  });
  it('recovers an accepted submission with a lost response without submitting it twice', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('lose-response'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'ambiguous').send(values).expect(201), id = response.body.id;
    await until(() => local!.store.job(id)!.status, s => s === 'interrupted'); expect(local!.store.job(id)!.submitting).toBe(true); expect(local!.store.job(id)!.pendingPrompt).toBeNull();
    mock!.setMode('hold'); await connect(agent); await mock!.complete(mock!.submissions[0].id);
    await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200);
    const finished = await until(() => local!.store.job(id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status), 20000);
    expect(finished.error).toBeNull(); expect(finished.status).toBe('completed'); expect(mock!.submissions).toHaveLength(1);
  }, 25000);
  it('retains an unconfirmed cancellation and lets the user check it again', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('hold'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'cancel-drop').send(values).expect(201), id = response.body.id;
    await until(() => local!.store.job(id)!.pendingPrompt, Boolean); mock!.loseNextCancel();
    await agent.post(`/api/jobs/${id}/cancel`).send({}).expect(400); await until(() => local!.runner.busy, busy => !busy);
    expect(local!.store.job(id)).toMatchObject({ status: 'interrupted', cancelRequested: true }); expect(local!.store.job(id)!.cancellationConfirmed).not.toBe(true);
    await agent.post(`/api/jobs/${id}/cancel`).send({}).expect(200); expect(local!.store.job(id)).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
  });
});
