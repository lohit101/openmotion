import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createApplication } from '../server/index';
import { applyProgress, localEndpoint, OfflineError } from '../server/comfy';
import { command, probe, prepareVideo } from '../server/media';
import { compileWorkflow, validateGraph, RELIGHT, NATURAL_SPEED } from '../server/workflow';
import { defaults, geometry, nextSegment, segmentCount } from '../shared/types';
import { imageModelFiles, pinnedModels } from '../shared/models';
import { compilePrompt, PROMPT_VERSION } from '../shared/prompts';
import type { ReferenceGeometry } from '../server/framing';
import prompts from '../../config/prompts.json';
import type { Asset, Catalog, Graph, Job, Settings } from '../shared/types';
import { imageDefaults } from '../shared/image-replacement';
import { ImageFinalizationError } from '../server/image-processing';

const repo = path.resolve(import.meta.dirname, '../..');
const catalog: Catalog = JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));
const template: Graph = JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
let fixtures: string, video: string, image: string, longVideo: string;
beforeAll(async () => {
  fixtures = await mkdtemp(path.join(os.tmpdir(), 'recast-fixtures-')); video = path.join(fixtures, 'source.mp4'); image = path.join(fixtures, 'character.png');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=16:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await command('ffmpeg', ['-v', 'error', '-y', '-i', video, '-frames:v', '1', image]);
  longVideo = path.join(fixtures, 'long-source.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '5', '-i', video, '-t', '32', '-c', 'copy', longVideo]);
});
afterAll(async () => { await rm(fixtures, { recursive: true, force: true }); });
async function until<T>(read: () => T, predicate: (value: T) => boolean, timeout = 12000): Promise<T> {
  const start = Date.now(); let value = read();
  while (!predicate(value)) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for state: ' + JSON.stringify(value)); await new Promise(r => setTimeout(r, 35)); value = read(); }
  return value;
}
function jobFixture(): Job {
  return { id: randomUUID(), title: 'Protocol test', status: 'running', sourceId: 'video', referenceId: 'image', settings: { ...defaults, preset: 'fast' }, createdAt: new Date().toISOString(), favorite: false, deleted: false,
    width: 480, height: 800, progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 48, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: { source: 'source.mp4', reference: 'character.png' }, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}

// A local protocol fixture, never a product mode. Media is FFmpeg passthrough;
// it checks API contracts, recovery and assembly, not model quality or speed.
async function mockComfy(viggle = false) {
  const app = express(), server = createServer(app), ws = new WebSocketServer({ server, path: '/ws' });
  const localCatalog = structuredClone(catalog), sockets = new Map<string, WebSocket>(), uploads = new Map<string, string>(), files = new Map<string, string>();
  (localCatalog.LoraLoaderModelOnly.input.required!.lora_name[0] as string[]).push(NATURAL_SPEED);
  if (viggle) {
    Object.assign(localCatalog, JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/viggle-node-schemas.json'), 'utf8')));
    for (const schema of Object.values(localCatalog)) for (const [name, rule] of Object.entries({ ...schema.input.required, ...schema.input.optional })) {
      if (['unet_name', 'vae_name', 'clip_name', 'lora_name', 'text_cond'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(f => f.destination.split('/').at(-1))];
    }
  }
  const pending = new Map<string, any[]>(), history: Record<string, any> = {}, submissions: any[] = [], cancelled: string[] = [], calls: string[] = [];
  let mode: 'complete' | 'hold' | 'lose-response' = 'complete', dropHistory = false, dropCancel = false, dropLatent = false, dropDownload = 0, dropContext = 0;
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
    if (entry[2]['46'].class_type === 'SaveImage') {
      // Protocol only: return the uploaded source, never synthetic model quality.
      const graph = entry[2] as Graph, filename = id + '.png';
      const source = uploads.get(String((graph['128'] || graph['1']).inputs.image))!;
      const file = path.join(fixtures, filename); await copyFile(source, file); files.set(filename, file);
      history[id] = { prompt: entry, status: { status_str: 'success', completed: true, messages: [] }, outputs: { '46': { images: [{ filename, subfolder: 'recast', type: 'output' }] } } };
      pending.delete(id); emit(entry[3].client_id, 'executing', { prompt_id: id, node: null }); return;
    }
    const graph = entry[2] as Graph, controls = graph['1']?.inputs, fps = controls ? Number(controls.fps) : 24, cap = controls ? Number(controls.frame_cap) : Number(graph['2'].inputs.frame_load_cap), skip = controls ? Number(controls.skip_frames) : Number(graph['2'].inputs.skip_first_frames), overlap = controls ? skip ? 5 : 0 : Number(graph['45'].inputs.overlap);
    const filename = id + '.mp4', file = path.join(fixtures, filename);
    const scale = graph['52'] ? ['-vf', `scale=${graph['52'].inputs.width}:${graph['52'].inputs.height}:flags=lanczos`] : [];
    await command('ffmpeg', ['-v', 'error', '-y', '-ss', String((skip + overlap) / fps), '-i', uploads.get(String(graph['2'].inputs.video))!, '-frames:v', String(cap - overlap), ...scale, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    files.set(filename, file); history[id] = { prompt: entry, status: { status_str: 'success', completed: true, messages: [] }, outputs: {
      '46': { gifs: [{ filename, subfolder: 'recast', type: 'output' }] }, '47': { context: [{ path: '/gpu/output/context-' + id + '.safetensors', source_count: cap, source_end_frame: skip + cap, fps }] }
    } };
    if (graph['47'].class_type === 'RecastViggleSaveContext') {
      const receipt = history[id].outputs['47'].context[0];
      Object.assign(receipt, { version: graph['47'].inputs.version || 'five-frame-v1', job_id: graph['47'].inputs.job_id });
      if (graph['47'].inputs.terminal) Object.assign(receipt, { path: '', terminal: true });
      else {
        const contextName = id + '.safetensors', contextFile = path.join(fixtures, contextName);
        await writeFile(contextFile, 'Protocol fixture anchor; real tensors are checked separately in CPU ComfyUI tests.'); files.set(contextName, contextFile);
        Object.assign(receipt, { source_anchor_frame: graph['47'].inputs.next_skip_frames, artifact: { filename: contextName, type: 'output' } });
      }
    }
    if (graph['121']) {
      const keyframe = id + '_keyframe.png'; files.set(keyframe, image);
      history[id].outputs['121'] = { images: [{ filename: keyframe, subfolder: 'recast', type: 'output' }] };
    }
    if (graph['51'] && !dropLatent) {
      const latentName = id + '.latent', latentFile = path.join(fixtures, latentName); await writeFile(latentFile, 'Protocol fixture latent, not a sampled tensor'); files.set(latentName, latentFile);
      history[id].outputs['51'] = { latents: [{ filename: latentName, subfolder: 'recast', type: 'output' }] };
    }
    dropLatent = false; pending.delete(id); emit(entry[3].client_id, 'executing', { prompt_id: id, node: null });
  }
  app.post('/prompt', (req, res) => {
    const id = randomUUID(), entry = [submissions.length, id, req.body.prompt, { client_id: req.body.client_id }, []];
    submissions.push({ id, ...req.body, socketReady: sockets.get(req.body.client_id)?.readyState === WebSocket.OPEN }); pending.set(id, entry);
    if (mode === 'lose-response') { req.socket.destroy(); return; }
    emit(req.body.client_id, 'execution_start', { prompt_id: id });
    const imageRun = req.body.prompt['46'].class_type === 'SaveImage', stepNode = req.body.prompt[imageRun ? '115' : '42'], node = imageRun ? '118' : '43';
    emit(req.body.client_id, 'executing', { prompt_id: id, node });
    const steps = stepNode.class_type === 'ManualSigmas' ? String(stepNode.inputs.sigmas).split(',').length - 1 : stepNode.inputs.steps;
    emit(req.body.client_id, 'progress', { prompt_id: id, node, value: 2, max: typeof steps === 'number' ? steps : 6 });
    res.json({ prompt_id: id, node_errors: {} });
    if (mode === 'complete') void complete(id);
  });
  app.post('/api/jobs/:id/cancel', (req, res) => { if (dropCancel) { dropCancel = false; req.socket.destroy(); return; } cancelled.push(req.params.id); pending.delete(req.params.id); res.json({ cancelled: true }); });
  app.get('/view', (req, res) => { if (dropDownload > 0) { dropDownload--; req.socket.destroy(); return; } if (dropContext > 0 && String(req.query.filename).endsWith('.safetensors')) { dropContext--; req.socket.destroy(); return; } const file = files.get(String(req.query.filename)); if (file) res.sendFile(file); else res.sendStatus(404); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { endpoint: `http://127.0.0.1:${address.port}`, calls, submissions, cancelled, pending, history, complete, emit, uploads, catalog: localCatalog,
    setMode(value: typeof mode) { mode = value; }, loseNextHistory() { dropHistory = true; }, loseNextCancel() { dropCancel = true; }, omitNextLatent() { dropLatent = true; }, loseNextDownload() { dropDownload = 3; }, loseNextContext() { dropContext = 3; },
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
    expect(quality['50']).toBeUndefined(); expect(quality['24']).toBeUndefined(); expect(quality['25'].inputs.model).toEqual(['23', 0]); expect(quality['42'].inputs.steps).toBe(20);
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
  it('does not replace a valid prepared clip when local FFmpeg preparation is aborted', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'recast-preparation-'));
    try {
      const existing = path.join(folder, 'prepared-source.mp4'); await writeFile(existing, 'previous complete file');
      const controller = new AbortController(); controller.abort();
      await expect(prepareVideo(jobFixture(), { path: video, hasAudio: true } as Asset, folder, controller.signal)).rejects.toThrow();
      expect(await readFile(existing, 'utf8')).toBe('previous complete file');
      expect(await readdir(folder)).toEqual(['prepared-source.mp4']);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});

describe('local app with the captured ComfyUI protocol', () => {
  let local: Awaited<ReturnType<typeof createApplication>> | undefined, mock: Awaited<ReturnType<typeof mockComfy>> | undefined, root = '';
  let geometry: ReferenceGeometry;
  afterEach(async () => {
    if (local) { local.connection.disconnect(); local.runner.abort?.abort(); await until(() => local!.runner.busy, busy => !busy); local.store.close(); }
    await mock?.close(); if (root) await rm(root, { recursive: true, force: true }); local = undefined; mock = undefined;
  });
  async function setup(viggle = false) {
    root = await mkdtemp(path.join(os.tmpdir(), 'recast-test-')); mock = await mockComfy(viggle);
    // Synthetic media has no faces. This injected protocol fixture checks that
    // prepared inputs and quality reports are wired correctly; detector/affine
    // behavior is verified separately by the CPU geometry tests.
    geometry = {
      prepare: vi.fn<ReferenceGeometry['prepare']>(async (job, _source, reference, folder, signal) => {
        const file = path.join(folder, 'aligned-reference.png');
        await command('ffmpeg', ['-v', 'error', '-y', '-i', reference, '-vf', `scale=${job.width}:${job.height}`, '-frames:v', '1', file], signal);
        return { file, summary: { version: 'face-v1', status: 'aligned', width: job.width, height: job.height, anchorFrame: 0, scale: 2, translateX: 10, translateY: 20, preparedSha256: 'a'.repeat(64), warnings: [] } };
      }),
      check: vi.fn<ReferenceGeometry['check']>(async () => ({ status: 'matched', warnings: [], samples: [{ scaleRatio: 1, centerDistance: 0 }] })),
    };
    local = await createApplication({ dataRoot: root, seed: false, allowSSH: false, repo, geometry }); return request(local.app);
  }
  async function inputs(agent: ReturnType<typeof request>) {
    const source = await agent.post('/api/assets/video').attach('file', video).expect(201); const ref = await agent.post('/api/assets/image').attach('file', image).expect(201);
    return { sourceId: source.body.id, referenceId: ref.body.id, settings: { ...defaults, preset: 'fast' as Settings['preset'], fps: 16 as Settings['fps'], seconds: 3 } };
  }
  async function connect(agent: ReturnType<typeof request>) {
    await agent.post('/api/connection/connect').send({ endpoint: mock!.endpoint, useSSH: false }).expect(202);
    await until(() => local!.connection.status.state, state => state === 'online');
  }
  async function imageInputs(agent: ReturnType<typeof request>) {
    const source = await agent.post('/api/assets/image').attach('file', image).expect(201), reference = await agent.post('/api/assets/image').attach('file', image).expect(201);
    local!.runner.imageProcessor = async (action, job, store, _repo, folder) => {
      if (action === 'prepare') {
        await copyFile(store.asset(job.sourceId)!.path, path.join(folder, 'target.png')); await copyFile(store.asset(job.sourceId)!.path, path.join(folder, 'original.png'));
        await copyFile(store.asset(job.referenceId)!.path, path.join(folder, 'identity.png'));
        return { hasFace: false, warnings: [] };
      }
      await copyFile(path.join(folder, 'gpu-result.png'), path.join(folder, 'final.png'));
      return { status: 'review', warnings: [], backgroundProtected: false, outsideMaskMaxDifference: null, sourceFace: false, referenceFace: false, outputFace: false };
    };
    return { sourceId: source.body.id, referenceId: reference.body.id, faceId: null, maskId: null, settings: { ...imageDefaults, protectBackground: false, faceDetail: false } };
  }
  it('saves independent image settings offline and never downloads or submits a missing-model request', async () => {
    const agent = await setup(), values = await imageInputs(agent), before = local!.store.draft();
    await agent.post('/api/images/draft').send(values).expect(200);
    expect(local!.store.imageDraft().sourceId).toBe(values.sourceId); expect(local!.store.draft()).toEqual(before);
    expect(mock!.calls).toEqual([]);
    await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-offline').send(values).expect(503);
    await connect(agent);
    const missing = await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-missing').send(values).expect(409);
    expect(missing.body.missingModels).toHaveLength(3); expect(mock!.submissions).toHaveLength(0);
    expect(mock!.calls.some(call => /download|\/prompt/.test(call))).toBe(false);
  });
  it('saves one PNG image with its receipt, library entry and reproducible workflow', async () => {
    const agent = await setup(true), values = await imageInputs(agent); await connect(agent);
    const response = await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-once').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status));
    expect(job.status).toBe('completed'); expect(job.error).toBeNull(); expect(job.mediaType).toBe('image');
    expect(job.segments).toHaveLength(1); expect(job.progress.completedFrames).toBe(1); expect(mock!.submissions).toHaveLength(1);
    await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-once').send(values).expect(200); expect(mock!.submissions).toHaveLength(1);
    expect((await readdir(path.join(root, 'jobs', job.id)))).toContain('history_0.json');
    const result = await agent.get(`/api/jobs/${job.id}/image?download=1`).expect(200); expect(result.headers['content-type']).toContain('image/png'); expect(result.headers['content-disposition']).toContain('.png');
    await agent.get(`/api/jobs/${job.id}/image-source`).expect(200);
    expect((await agent.get(`/api/jobs/${job.id}/workflow`).expect(200)).body['46'].class_type).toBe('SaveImage');
    const use = await agent.post(`/api/images/jobs/${job.id}/use`).send({}).expect(200);
    expect(use.body.draft.settings.referencePreparation).toBe('auto'); expect(use.body.draft.referenceId).toBe(use.body.asset.id);
    expect((await agent.post(`/api/images/jobs/${job.id}/use`).send({}).expect(200)).body.asset.id).toBe(use.body.asset.id);
  });
  it('binds masks to their target and carries an extracted video frame back as a prepared reference', async () => {
    const agent = await setup(true), motion = await inputs(agent), values = await imageInputs(agent); await connect(agent);
    const mask = await agent.post(`/api/images/mask/${values.sourceId}`).attach('file', image).expect(201);
    await agent.post('/api/images/jobs').set('Idempotency-Key', 'wrong-mask').send({ ...values, sourceId: values.referenceId, maskId: mask.body.id, settings: { ...values.settings, protectBackground: true } }).expect(400);
    const frame = await agent.post('/api/images/source-frame').send({ sourceId: motion.sourceId, time: .5 }).expect(201);
    expect(frame.body.sourceFrame).toEqual({ videoId: motion.sourceId, time: .5 });
    const response = await agent.post('/api/images/jobs').set('Idempotency-Key', 'source-frame-image').send({ ...values, sourceId: frame.body.id }).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status)); expect(job.status).toBe('completed');
    const use = await agent.post(`/api/images/jobs/${job.id}/use`).send({}).expect(200);
    expect(use.body.draft.sourceId).toBe(motion.sourceId); expect(use.body.draft.settings).toMatchObject({ referencePreparation: 'prepared', engine: 'viggle', fps: 24, start: .5 });
  });
  it('queues images behind the active video without interrupting it or creating a second GPU queue', async () => {
    const agent = await setup(true), motion = await inputs(agent), values = await imageInputs(agent); motion.settings.seconds = .5; await connect(agent); mock!.setMode('hold');
    const video = await agent.post('/api/jobs').set('Idempotency-Key', 'video-before-image').send(motion).expect(201);
    await until(() => mock!.submissions.length, n => n === 1);
    const response = await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-after-video').send(values).expect(201);
    expect(local!.store.job(response.body.id)!.status).toBe('queued'); expect(mock!.cancelled).toEqual([]); expect(mock!.submissions).toHaveLength(1);
    mock!.setMode('complete'); await mock!.complete(mock!.submissions[0].id);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(local!.store.job(video.body.id)!.status).toBe('completed'); expect(job.status).toBe('completed'); expect(mock!.submissions).toHaveLength(2);
  }, 20000);
  it('recovers an accepted image submission after a lost response without generating again', async () => {
    const agent = await setup(true), values = await imageInputs(agent); await connect(agent); mock!.setMode('lose-response');
    const response = await agent.post('/api/images/jobs').set('Idempotency-Key', 'image-lost-response').send(values).expect(201);
    await until(() => local!.store.job(response.body.id)!, j => j.status === 'interrupted'); await until(() => local!.runner.busy, busy => !busy);
    await mock!.complete(mock!.submissions[0].id); await connect(agent);
    await agent.post(`/api/jobs/${response.body.id}/resume`).send({}).expect(200);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(mock!.submissions).toHaveLength(1);
  }, 20000);
  it('retries local image finalization from the paid receipt without another GPU submission', async () => {
    const agent = await setup(true), values = await imageInputs(agent); await connect(agent);
    const original = local!.runner.imageProcessor; let fail = true;
    local!.runner.imageProcessor = async (...args) => { if (args[0] === 'finish' && fail) { fail = false; throw new ImageFinalizationError('Retry local processing.'); } return original(...args); };
    const response = await agent.post('/api/images/jobs').set('Idempotency-Key', 'local-image-retry').send(values).expect(201);
    const saved = await until(() => local!.store.job(response.body.id)!, j => j.status === 'interrupted'); expect(saved.progress.completedFrames).toBe(1); await until(() => local!.runner.busy, busy => !busy);
    local!.connection.disconnect(); // Finalizing a downloaded image needs no rented GPU.
    await agent.post(`/api/jobs/${saved.id}/resume`).send({}).expect(200);
    const job = await until(() => local!.store.job(saved.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(mock!.submissions).toHaveLength(1);
  });
  it('works offline, rejects invalid media and saves drafts without probing a GPU', async () => {
    const agent = await setup(); const values = await inputs(agent);
    expect((await agent.get('/api/bootstrap')).body.connection.state).toBe('offline'); expect(mock!.calls).toEqual([]);
    await agent.post('/api/cloud/key').send({ key: 'unused-fixture-key' }).expect(404);
    await agent.delete('/api/cloud/key').expect(404);
    await agent.post('/api/draft').send(values).expect(200); expect(local!.store.draft().sourceId).toBe(values.sourceId);
    await agent.post('/api/jobs').set('Idempotency-Key', 'offline').send(values).expect(503);
    await agent.post('/api/assets/image').attach('file', Buffer.from('not an image'), 'invalid.png').expect(400);
    await agent.post('/api/draft').set('Origin', 'https://unrelated.example').send(values).expect(403);
    const media = await agent.get(`/api/assets/${values.sourceId}/original`).set('Range', 'bytes=0-99').expect(206); expect(media.body.length).toBe(100);
    expect(mock!.calls).toEqual([]);
  });
  it('runs the Viggle protocol as one 120-frame shot and saves its keyframe, audio and library settings', async () => {
    const agent = await setup(true), values = await inputs(agent);
    Object.assign(values.settings, { engine: 'viggle', fps: 16, seconds: 5 });
    await connect(agent);
    const invalid = await agent.post('/api/jobs').set('Idempotency-Key', 'invalid-viggle-fps').send(values).expect(400);
    expect(invalid.body.error).toContain('24 fps'); expect(mock!.submissions).toHaveLength(0);
    values.settings.fps = 24;
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'viggle-one-shot').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status));
    expect(job.error).toBeNull(); expect(job.status).toBe('completed'); expect(job.settings.engine).toBe('viggle');
    expect(job.progress.completedFrames).toBe(120); expect(job.progress.segments).toBe(1); expect(job.segments).toHaveLength(1);
    expect(mock!.submissions).toHaveLength(1); expect(mock!.submissions[0].prompt['1']).toBeUndefined();
    expect(mock!.submissions[0].prompt['40'].inputs.ref_image).toEqual(['121', 0]);
    expect(geometry.prepare).not.toHaveBeenCalled(); expect(geometry.check).toHaveBeenCalledOnce();
    expect(job.keyframe).toBeTruthy(); await agent.get(`/api/jobs/${job.id}/keyframe`).expect(200);
    const meta = await probe(job.output!); expect(meta.fps).toBe(24); expect(meta.hasAudio).toBe(true);
    const timing = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,duration', '-of', 'json', job.output!])).streams[0];
    expect(timing.nb_read_frames).toBe('120'); expect(Number(timing.duration)).toBeCloseTo(5, 5);
    const bootstrap = (await agent.get('/api/bootstrap')).body;
    expect(bootstrap.jobs[0].keyframe).toBe('ready'); expect(bootstrap.jobs[0].settings.engine).toBe('viggle');
    expect((await readdir(path.join(root, 'jobs', job.id)))).toContain('history_0.json');
  }, 25000);
  it('assembles thirty seconds of Viggle windows at exact 24 fps with one source audio track', async () => {
    const agent = await setup(true);
    const source = await agent.post('/api/assets/video').attach('file', longVideo).expect(201), reference = await agent.post('/api/assets/image').attach('file', image).expect(201);
    await connect(agent);
    const values = { sourceId: source.body.id, referenceId: reference.body.id, settings: { ...defaults, engine: 'viggle', fps: 24, seconds: 30, start: 1.25, referencePreparation: 'prepared' } };
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'viggle-thirty-seconds').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status), 25000);
    expect(job.error).toBeNull(); expect(job.status).toBe('completed');
    expect(job.viggleSegmentation).toBe('last-frame-v2'); expect(job.progress.completedFrames).toBe(720);
    expect(job.progress.segments).toBe(7); expect(job.segments).toHaveLength(7); expect(mock!.submissions).toHaveLength(7);
    expect(job.segments[1].reference).toBe('reference_0001.png');
    await agent.get(`/api/jobs/${job.id}/keyframe?segment=1`).expect(200);
    await agent.get(`/api/jobs/${job.id}/keyframe?segment=-1`).expect(422);
    expect(job.segments.map(segment => segment.frames)).toEqual([124, 119, 119, 119, 119, 119, 1]);
    const last = mock!.submissions.at(-1)!.prompt;
    expect(last['4'].class_type).toBe('RecastViggleContextReference'); expect(last['36'].inputs.context_version).toBe('last-frame-v2');
    expect(last['2'].inputs).toMatchObject({ skip_first_frames: 612, frame_load_cap: 108 });
    expect(last['36'].inputs.overlap).toBe(107); expect(last['45'].inputs.overlap).toBe(107);
    const info = JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', job.output!]));
    const v = info.streams.find((s: any) => s.codec_type === 'video');
    expect(v.nb_read_frames).toBe('720'); expect(Number(v.duration)).toBeCloseTo(30, 3); expect(v.avg_frame_rate).toBe('24/1');
    expect(info.streams.filter((s: any) => s.codec_type === 'audio')).toHaveLength(1);
    const saved = await readdir(path.join(root, 'jobs', job.id));
    for (let i = 0; i < 7; i++) { expect(saved).toContain(`history_${i}.json`); if (i < 6) expect(saved).toContain(`context_${i}.safetensors`); }
    expect(saved).not.toContain('context_6.safetensors'); expect(last['47'].inputs.terminal).toBe(true);
  }, 30000);
  it('resumes a completed anchor transfer without repeating its paid sample or character repaint', async () => {
    const agent = await setup(true), values = await inputs(agent);
    Object.assign(values.settings, { engine: 'viggle', fps: 24, seconds: 5.2, start: .5, viggleReferenceMode: 'original' });
    mock!.loseNextContext(); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'viggle-anchor-recovery').send(values).expect(201), id = response.body.id;
    await until(() => local!.runner.busy, busy => !busy);
    const stopped = local!.store.job(id)!;
    expect(stopped.status).toBe('interrupted'); expect(mock!.submissions).toHaveLength(1);
    expect(stopped.progress.stage).toBe('Download paused · completed render kept'); expect(local!.connection.status.state).toBe('online');
    expect(stopped.progress.completedFrames).toBe(0);
    const originalPrompt = stopped.pendingPrompt!, downloaded = await readFile(path.join(root, 'jobs', id, 'segment_0000.mp4'));
    delete mock!.history[originalPrompt];
    await connect(agent); await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200);
    const job = await until(() => local!.store.job(id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status));
    expect(job.error).toBeNull(); expect(job.status).toBe('completed'); expect(job.segments[0].promptId).toBe(originalPrompt);
    expect(job.progress.completedFrames).toBe(125); expect(mock!.submissions).toHaveLength(2);
    expect(mock!.submissions[1].prompt['118']).toBeUndefined();
    expect(mock!.submissions[1].prompt['4'].inputs.image).toContain('-prepared-frame');
    expect(await readFile(path.join(root, 'jobs', id, 'segment_0000.mp4'))).toEqual(downloaded);
    const timing = JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames', '-of', 'json', job.output!]));
    expect(timing.streams.find((s: any) => s.codec_type === 'video').nb_read_frames).toBe('125');
  }, 25000);
  it('rejects long clips on an old runtime before queueing any paid work', async () => {
    const agent = await setup(true), values = await inputs(agent);
    delete mock!.catalog.RecastViggleAnchor;
    Object.assign(values.settings, { engine: 'viggle', fps: 24, seconds: 6 });
    await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'old-viggle-nodes').send(values).expect(409);
    expect(response.body.error).toContain('updated continuation nodes'); expect(mock!.submissions).toHaveLength(0); expect(local!.store.jobs()).toHaveLength(0);
  });
  it.each([['quality12', 12], ['quality16', 16]] as const)('exports %s at 720p and 24 fps without changing motion duration or continuity geometry', async (preset, steps) => {
    const agent = await setup(), values = await inputs(agent);
    Object.assign(values.settings, { preset, resolution: '720', orientation: 'portrait', fps: 24, seconds: 0.5 });
    await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'hd-' + preset).send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, job => ['completed', 'failed', 'interrupted'].includes(job.status));
    expect(job.error).toBeNull(); expect(job.status).toBe('completed'); expect(job.outputSize).toEqual({ width: 720, height: 1280 });
    expect([job.width, job.height]).toEqual([736, 1312]); expect(job.progress.completedFrames).toBe(12);
    expect(mock!.submissions).toHaveLength(1);
    const graph = mock!.submissions[0].prompt;
    expect(graph['42'].inputs.steps).toBe(steps); expect(graph['24']).toBeUndefined();
    expect(graph['1'].inputs).toMatchObject({ fps: 24, width: 736, height: 1312 });
    expect(graph['46'].inputs.images).toEqual(['52', 0]); expect(graph['47'].inputs.images).toEqual(['45', 2]);
    const meta = await probe(job.output!);
    expect([meta.width, meta.height]).toEqual([720, 1280]); expect(meta.fps).toBe(24); expect(meta.hasAudio).toBe(true);
    // MP4's audio duration can include the final AAC packet. Check actual
    // video timing/frame count rather than requiring an exact container duration.
    const timing = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,duration', '-of', 'json', job.output!])).streams[0];
    expect(timing.nb_read_frames).toBe('12'); expect(Number(timing.duration)).toBeCloseTo(0.5, 5);
  }, 20000);
  it('exposes manual files offline and never downloads from a selection or missing-model generate request', async () => {
    const agent = await setup(), values = await inputs(agent);
    const offline = await agent.get('/api/models').expect(200);
    expect(offline.body.files.map((file: { id: string }) => file.id).sort()).toEqual(pinnedModels.map(file => file.destination).sort());
    expect(mock!.calls).toEqual([]);
    await agent.post('/api/models/download').send({ files: ['loras/untrusted.safetensors'] }).expect(400);
    await connect(agent);
    const live = structuredClone(local!.connection.catalog);
    for (const schema of Object.values(live)) for (const rule of Object.values({ ...schema.input.required, ...schema.input.optional })) {
      if (Array.isArray(rule[0])) rule[0] = rule[0].filter((name: unknown) => name !== NATURAL_SPEED);
    }
    const client = local!.connection.client();
    vi.spyOn(local!.connection, 'client').mockReturnValue({ ...client, json: vi.fn(async () => live) } as unknown as typeof client);
    values.settings.preset = 'natural'; await agent.post('/api/draft').send(values).expect(200);
    const blocked = await agent.post('/api/jobs').set('Idempotency-Key', 'missing-model').send(values).expect(409);
    expect(blocked.body.missingModels).toEqual(['loras/' + NATURAL_SPEED]);
    expect(local!.store.jobs()).toHaveLength(0); expect(mock!.submissions).toHaveLength(0);
    expect(local!.models.state.busy).toBe(false);
  });
  it('blocks automatic Viggle preparation without Klein while allowing a prepared frame without downloading it', async () => {
    const agent = await setup(true), values = await inputs(agent); await connect(agent);
    Object.assign(values.settings, { engine: 'viggle', fps: 24, seconds: 3, referencePreparation: 'auto', loraA: 'None', loraB: 'None' });
    const live = structuredClone(local!.connection.catalog);
    for (const schema of Object.values(live)) for (const rule of Object.values({ ...schema.input.required, ...schema.input.optional })) {
      if (Array.isArray(rule[0])) rule[0] = rule[0].filter((name: unknown) => !imageModelFiles.some(file => file.endsWith('/' + name)));
    }
    const client = local!.connection.client();
    vi.spyOn(local!.connection, 'client').mockReturnValue({ ...client, json: vi.fn(async () => live) } as unknown as typeof client);
    const blocked = await agent.post('/api/jobs').set('Idempotency-Key', 'automatic-needs-klein').send(values).expect(409);
    expect(blocked.body.error).toContain('Automatic frame preparation requires Klein');
    expect(blocked.body.missingModels.sort()).toEqual([...imageModelFiles].sort());
    expect(local!.store.jobs()).toHaveLength(0); expect(mock!.submissions).toHaveLength(0); expect(local!.models.state.busy).toBe(false);
    vi.spyOn(local!.runner, 'kick').mockResolvedValue(undefined);
    values.settings.referencePreparation = 'prepared';
    await agent.post('/api/jobs').set('Idempotency-Key', 'prepared-skips-klein').send(values).expect(201);
    expect(mock!.submissions).toHaveLength(0); expect(local!.models.state.busy).toBe(false);
  });
  it('migrates stale sample drafts and compiles an empty prompt in a newly created job', async () => {
    const agent = await setup(), values = await inputs(agent);
    values.settings.prompt = prompts.legacyDemoPrompts[1];
    const draft = await agent.post('/api/draft').send(values).expect(200);
    expect(draft.body.settings.prompt).toBe(defaults.prompt); expect(mock!.calls).toEqual([]);
    values.settings.prompt = ''; mock!.setMode('hold'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'empty-prompt').send(values).expect(201);
    await until(() => mock!.submissions.length, count => count === 1);
    expect(local!.store.job(response.body.id)!.promptVersion).toBe(PROMPT_VERSION);
    expect(local!.store.job(response.body.id)!.framingVersion).toBe('face-v1');
    expect(local!.store.job(response.body.id)!.renderVersion).toBe('continuous-v1');
    expect(mock!.submissions[0].prompt['44'].class_type).toBe('VAEDecode');
    expect(mock!.submissions[0].prompt['31'].inputs.text).toBe(compilePrompt('swap', ''));
    await agent.post(`/api/jobs/${response.body.id}/cancel`).expect(200);
    await until(() => local!.store.job(response.body.id)!.status, status => status === 'cancelled');
  });
  it('keeps simultaneous Generate retries idempotent across the asynchronous model check', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('hold'); await connect(agent);
    const responses = await Promise.all([agent.post('/api/jobs').set('Idempotency-Key', 'parallel-retry').send(values), agent.post('/api/jobs').set('Idempotency-Key', 'parallel-retry').send(values)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id); expect(local!.store.jobs()).toHaveLength(1);
    await until(() => mock!.submissions.length, count => count === 1);
    await agent.post(`/api/jobs/${responses[0].body.id}/cancel`).expect(200);
  });
  it('submits once, receives real counters and assembles two segments with one audio track', async () => {
    const agent = await setup(), values = await inputs(agent); values.settings.seconds = 5.875; await connect(agent);
    const stages: any[] = []; local!.store.on('event', e => { if (e.type === 'job') stages.push(e.data.progress); });
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'two-segments').send(values).expect(201);
    const duplicate = await agent.post('/api/jobs').set('Idempotency-Key', 'two-segments').send(values).expect(200); expect(duplicate.body.id).toBe(response.body.id);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status), 25000);
    expect(job.error).toBeNull(); expect(job.status).toBe('completed'); expect(job.progress.completedFrames).toBe(94); expect(job.segments.map(s => s.frames)).toEqual([81, 13]);
    expect(mock!.submissions).toHaveLength(2); expect(mock!.submissions.every(s => s.socketReady)).toBe(true);
    expect(geometry.prepare).toHaveBeenCalledOnce(); expect(geometry.check).toHaveBeenCalledOnce();
    expect(job.referenceFraming?.status).toBe('aligned'); expect(job.framingCheck?.status).toBe('matched');
    const uploadedReference = await probe(mock!.uploads.get(String(mock!.submissions[0].prompt['4'].inputs.image))!);
    expect([uploadedReference.width, uploadedReference.height]).toEqual([job.width, job.height]);
    await agent.get(`/api/jobs/${job.id}/aligned-reference`).expect(200);
    expect(mock!.submissions[1].prompt['36'].inputs.context_path).toContain('context-'); expect(mock!.submissions[1].prompt['1'].inputs.skip_frames).toBe(76);
    expect(stages.some(s => s.node === '43' && s.value === 2 && s.max === 6)).toBe(true);
    const meta = await probe(job.output!); expect(meta.duration).toBeCloseTo(5.875, 1); expect(meta.fps).toBe(16); expect(meta.hasAudio).toBe(true);
    const frames = JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames,codec_type', '-of', 'json', job.output!]));
    expect(frames.streams.find((s: any) => s.codec_type === 'video').nb_read_frames).toBe('94');
    await agent.get(`/api/jobs/${job.id}/video`).set('Range', 'bytes=0-99').expect(206); await agent.get(`/api/jobs/${job.id}/workflow`).expect(200);
    await agent.patch(`/api/jobs/${job.id}`).send({ favorite: true, title: 'Saved take', deleted: true }).expect(200);
    await agent.patch(`/api/jobs/${job.id}`).send({ deleted: false }).expect(200); expect(local!.store.job(job.id)).toMatchObject({ favorite: true, title: 'Saved take', deleted: false });
  }, 30000);
  it('rejects ambiguous reference framing locally before any GPU input upload or sampling', async () => {
    const agent = await setup(), values = await inputs(agent); await connect(agent);
    vi.mocked(geometry.prepare).mockRejectedValueOnce(new Error('More than one face was detected. No GPU generation was submitted.'));
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'ambiguous-framing').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => j.status === 'failed');
    expect(job.error).toContain('No GPU generation was submitted'); expect(mock!.submissions).toHaveLength(0);
    expect(mock!.calls.filter(call => call === 'POST /upload/image')).toHaveLength(0);
    expect(geometry.check).not.toHaveBeenCalled();
  });
  it('regenerates an interrupted unverified source preparation before a paid submission can resume', async () => {
    const agent = await setup(), values = await inputs(agent); await connect(agent);
    vi.mocked(geometry.prepare).mockRejectedValueOnce(new OfflineError('Local preparation interrupted by instance stop'));
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'truncated-preparation').send(values).expect(201), id = response.body.id;
    await until(() => local!.store.job(id)!.status, status => status === 'interrupted'); await until(() => local!.runner.busy, busy => !busy);
    await writeFile(path.join(root, 'jobs', id, 'prepared-source.mp4'), 'incomplete source left by an earlier preparation');
    await connect(agent); await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200);
    const job = await until(() => local!.store.job(id)!, j => ['completed', 'failed', 'interrupted'].includes(j.status) && j.progress.completedFrames > 0);
    expect(job.status).toBe('completed'); expect(job.progress.completedFrames).toBe(48); expect(mock!.submissions).toHaveLength(1);
    expect(geometry.prepare).toHaveBeenCalledTimes(2);
    expect((await probe(path.join(root, 'jobs', id, 'prepared-source.mp4'))).duration).toBeCloseTo(3, 1);
  });
  it('keeps a completed render with a framing warning and never automatically retries it', async () => {
    const agent = await setup(), values = await inputs(agent); await connect(agent);
    vi.mocked(geometry.check).mockResolvedValueOnce({ status: 'warning', samples: [{ scaleRatio: 0.5 }], warnings: ['The subject is smaller than the source.'] });
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'framing-warning').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(job.output).toBeTruthy(); expect(job.progress.stage).toBe('Complete · review framing');
    expect(job.framingCheck?.warnings).toEqual(['The subject is smaller than the source.']); expect(mock!.submissions).toHaveLength(1);
    await agent.get(`/api/jobs/${job.id}/video`).expect(200);
  });
  it('bypasses source alignment for motion transfer and leaves older jobs on their original inputs', async () => {
    const agent = await setup(), values = await inputs(agent); values.settings.mode = 'motion'; await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'motion-mode').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(job.framingVersion).toBeUndefined(); expect(geometry.prepare).not.toHaveBeenCalled(); expect(geometry.check).not.toHaveBeenCalled();
    await agent.get(`/api/jobs/${job.id}/aligned-reference`).expect(404);
    const old = jobFixture(); old.id = randomUUID(); old.sourceId = values.sourceId; old.referenceId = values.referenceId; old.uploads = null; old.settings = { ...defaults, seconds: 1 };
    local!.store.addJob(old); void local!.runner.kick();
    const finished = await until(() => local!.store.job(old.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(finished.status).toBe('completed'); expect(geometry.prepare).not.toHaveBeenCalled(); expect(geometry.check).not.toHaveBeenCalled();
  });
  it('retains the finished file if the optional output geometry check cannot run', async () => {
    const agent = await setup(), values = await inputs(agent); await connect(agent);
    vi.mocked(geometry.check).mockRejectedValueOnce(new Error('Face detector unavailable'));
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'check-unavailable').send(values).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(job.framingCheck?.status).toBe('unverified'); expect(mock!.submissions).toHaveLength(1);
    await agent.get(`/api/jobs/${job.id}/video`).expect(200);
  });
  it('exports an optional diagnostic latent while sampling only once with the Natural profile', async () => {
    const agent = await setup(), values = await inputs(agent); values.settings.preset = 'natural'; await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'natural-diagnostic').send({ ...values, saveDiagnosticLatent: true }).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(mock!.submissions).toHaveLength(1); expect(job.settings.preset).toBe('natural');
    expect(mock!.submissions[0].prompt['24'].inputs.lora_name).toBe(NATURAL_SPEED); expect(mock!.submissions[0].prompt['42'].inputs.steps).toBe(8);
    expect(await readFile(path.join(root, 'jobs', job.id, 'latent_0000.latent'), 'utf8')).toBe('Protocol fixture latent, not a sampled tensor');
    await agent.get(`/api/jobs/${job.id}/video`).expect(200);
  });
  it('retains paid video output when an optional latent export is unavailable', async () => {
    const agent = await setup(), values = await inputs(agent); await connect(agent); mock!.omitNextLatent();
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'missing-diagnostic').send({ ...values, saveDiagnosticLatent: true }).expect(201);
    const job = await until(() => local!.store.job(response.body.id)!, j => ['completed', 'failed'].includes(j.status));
    expect(job.status).toBe('completed'); expect(mock!.submissions).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(root, 'jobs', job.id, 'latent_0_unavailable.json'), 'utf8')).warning).toContain('completed video was retained');
    await agent.get(`/api/jobs/${job.id}/video`).expect(200);
  });
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

  it('requires an explicit rerender after a container loses an accepted prompt, even after repeated recovery clicks', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('hold'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'lost-container').send(values).expect(201), id = response.body.id;
    const accepted = await until(() => local!.store.job(id)!, job => !!job.pendingPrompt), prompt = accepted.pendingPrompt!;
    local!.runner.interrupt('Container restarted'); await until(() => local!.runner.busy, busy => !busy); mock!.pending.delete(prompt); await connect(agent);
    await Promise.all([agent.post(`/api/jobs/${id}/resume`).send({}).expect(200), agent.post(`/api/jobs/${id}/resume`).send({}).expect(200)]);
    expect(local!.store.job(id)).toMatchObject({ status: 'interrupted', retryRequired: true, pendingPrompt: prompt });
    expect(local!.store.job(id)!.error).toContain('nothing has been resubmitted'); expect(mock!.submissions).toHaveLength(1);
    await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200); expect(mock!.submissions).toHaveLength(1);
    mock!.setMode('complete'); await agent.post(`/api/jobs/${id}/resume`).send({ retryMissing: true }).expect(200);
    const finished = await until(() => local!.store.job(id)!, job => job.status === 'completed');
    expect(finished.retryRequired).toBe(false); expect(mock!.submissions).toHaveLength(2);
  }, 20000);

  it('preserves an ambiguous submission when the restarted GPU has forgotten both its queue and history', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.setMode('lose-response'); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'lost-ambiguous').send(values).expect(201), id = response.body.id;
    await until(() => local!.runner.busy, busy => !busy); mock!.pending.clear(); await connect(agent);
    await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200);
    expect(local!.store.job(id)).toMatchObject({ status: 'interrupted', retryRequired: true, submitting: true, pendingPrompt: null });
    expect(mock!.submissions).toHaveLength(1);
  });

  it('recovers a completed segment after its transfer fails and ComfyUI loses its in-memory history', async () => {
    const agent = await setup(), values = await inputs(agent); mock!.loseNextDownload(); await connect(agent);
    const response = await agent.post('/api/jobs').set('Idempotency-Key', 'lost-transfer').send(values).expect(201), id = response.body.id;
    await until(() => local!.runner.busy, busy => !busy);
    const interrupted = local!.store.job(id)!;
    expect(interrupted.status).toBe('interrupted'); expect(interrupted.pendingPrompt).toBeTruthy();
    const receipt = JSON.parse(await readFile(path.join(root, 'jobs', id, 'history_0.json'), 'utf8'));
    expect(receipt.prompt[1]).toBe(interrupted.pendingPrompt); delete mock!.history[interrupted.pendingPrompt!];
    await connect(agent); await agent.post(`/api/jobs/${id}/resume`).send({}).expect(200);
    const finished = await until(() => local!.store.job(id)!, job => job.status === 'completed');
    expect(finished.segments).toHaveLength(1); expect(mock!.submissions).toHaveLength(1);
    await agent.get(`/api/jobs/${id}/video`).expect(200);
  }, 20000);
});
