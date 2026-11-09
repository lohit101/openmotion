import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { compileOpenjutsu } from '../server/openjutsu-workflow';
import { emptyOpenjutsuDraft, openjutsuDefaults, openjutsuFiles } from '../shared/openjutsu';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { createOpenjutsuJob } from '../server/openjutsu';
import { Store, publicJob } from '../server/store';
import { Runner } from '../server/runner';
import type { ConnectionManager } from '../server/comfy';
import type { ModelManager } from '../server/models';
import type { Asset, Catalog, Graph } from '../shared/types';
import { command } from '../server/media';
import receipts from './fixtures/openjutsu-recent-graphs.json';
import provenance from '../vendor/openjutsu/provenance.json';
import { validateGraph } from '../server/workflow';
import request from 'supertest';
import { createApplication } from '../server/index';

const repo = path.resolve(import.meta.dirname, '../..');
const catalogFor = (graph: Graph): Catalog => Object.fromEntries(Object.values(graph).map(n => [n.class_type, { input: { required: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, [typeof v === 'number' ? 'FLOAT' : 'STRING']])) }, output: Array(20).fill('*') }]));
let folder = '', store: Store | undefined;
afterEach(async () => { store?.close(); store = undefined; if (folder) await rm(folder, { recursive: true, force: true }); folder = ''; });

describe('copied OpenJutsu workflow', () => {
  it('keeps actual chain/output names inside the upstream limit with scene, motion and model suffixes enabled', () => {
    const resolve = (graph: Graph, value: unknown): string => {
      if (typeof value === 'string') return value;
      if (!Array.isArray(value)) throw new Error('Expected a string connection');
      const node = graph[value[0]]; if (node.class_type !== 'StringConcatenate') throw new Error('Unexpected string producer');
      return resolve(graph, node.inputs.string_a) + String(node.inputs.delimiter) + resolve(graph, node.inputs.string_b);
    };
    const names = [];
    for (const referenceScene of [false, true]) for (const id of ['61779044-9815-4f63-a047-99f6e3b8a343', 'e4769bdf-aa7e-4d02-885f-d98911bfe24f']) {
      const settings = { ...openjutsuDefaults, referenceScene, steps: 8, motion: 1376 as const, loras: [...openjutsuDefaults.loras, { name: 'solarrenderer_control_lora.safetensors', strength: 1 }] };
      const graph = compileOpenjutsu(settings, { start: 0, length: 3 }, undefined, id);
      const name = resolve(graph, graph['26'].inputs.run_name);
      const normalized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 96);
      expect(name).toBe(normalized); expect(name.length).toBeLessThanOrEqual(96);
      expect(resolve(graph, graph['67'].inputs.filename)).toBe(name); names.push(name);
    }
    expect(names[0]).not.toBe(names[1]);
    expect(() => compileOpenjutsu(openjutsuDefaults, { start: 0, length: 3 }, undefined, 'a'.repeat(97))).toThrow('namespace');
  });
  for (const [name, receipt] of Object.entries(receipts)) it('matches the native saved workflow of ' + name + ' after media/runtime-cache normalization', () => {
    const graph = compileOpenjutsu({ ...openjutsuDefaults, clipSeconds: receipt.clipSeconds }, receipt.section);
    expect(graph).toEqual(receipt.graph);
  });
  it('retains exact copied source bytes and the MIT licence', async () => {
    for (const [name, sha256] of Object.entries(provenance.files)) expect(createHash('sha256').update(await readFile(path.join(repo, 'studio/vendor/openjutsu', name))).digest('hex')).toBe(sha256);
  });
  it('keeps imported 480p/6-step/15-second settings and selected-only dependencies', () => {
    expect(openjutsuDefaults).toMatchObject({ resolution: '480p', steps: 6, clipSeconds: 15, motion: 512, seed: 0, noLipSync: false, referenceScene: false });
    const plan = moduleDownloadPlan('openjutsu', openjutsuDefaults);
    expect(plan.files).toEqual(openjutsuFiles(openjutsuDefaults)); expect(plan.files).toHaveLength(7);
    expect(plan.files.some(id => /viggle|face_consistency|upscale/.test(id))).toBe(false);
    expect(plan.runtimes).toEqual(['openjutsu-tools']);
  });
  it('makes reference-scene generation a separate explicit choice and preserves mouth-control semantics', () => {
    const original = compileOpenjutsu(openjutsuDefaults, { start: 0, length: 6 });
    expect(original['55']).toBeDefined(); expect(original['41'].inputs.neutral_background).toBeUndefined();
    const scene = compileOpenjutsu({ ...openjutsuDefaults, referenceScene: true }, { start: 1, length: 6 });
    expect(scene['55']).toBeUndefined(); expect(scene['56']).toBeUndefined(); expect(scene['41'].inputs.neutral_background).toBe(true);
    expect(scene['57'].inputs.latent).toEqual(['30', 1]); expect(scene['5'].inputs.skip_first_frames).toBe(24);
    expect(scene.reference_scene_prompt).toBeDefined();
    const silent = compileOpenjutsu({ ...openjutsuDefaults, noLipSync: true }, { start: 0, length: 6 });
    expect(silent['41'].inputs.faces).toBeDefined(); expect(original['41'].inputs.faces).toBeUndefined();
    expect(() => compileOpenjutsu({ ...openjutsuDefaults, acceleration: 'spectrum' }, { start: 0, length: 6 })).toThrow('Spectrum');
  });
});

async function fixture() {
  folder = await mkdtemp(path.join(os.tmpdir(), 'recast-openjutsu-')); store = new Store(folder);
  const source: Asset = { id: 'source', kind: 'video', name: 'Source.mp4', path: path.join(folder, 'source.mp4'), width: 64, height: 96, size: 4, duration: 6, fps: 24, hasAudio: true, poster: '', createdAt: new Date().toISOString() };
  const reference: Asset = { ...source, id: 'reference', kind: 'image', name: 'Reference.png', path: path.join(folder, 'reference.png'), duration: 0, fps: 0, hasAudio: false };
  await writeFile(source.path, 'source'); await writeFile(reference.path, 'reference'); store.addAsset(source); store.addAsset(reference);
  const graph = compileOpenjutsu(openjutsuDefaults, { start: 0, length: 6 });
  const catalog = catalogFor(compileOpenjutsu(openjutsuDefaults, { start: 0, length: 6 }, undefined, 'fixture')), request = vi.fn(async (_body?: unknown) => ({ prompt_id: 'paid-once' }));
  const client = { json: vi.fn(async (route: string, body?: unknown): Promise<any> => route === '/object_info' ? catalog : route === '/prompt' ? request(body) : route.startsWith('/history/') ? {} : route.startsWith('/history?') ? {} : route === '/queue' ? { queue_running: [], queue_pending: [] } : {}), upload: vi.fn(async (_path: string, name: string) => name + '.png'), watch: vi.fn(async () => ({ close: () => {} })), download: vi.fn(), cancel: vi.fn() };
  const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188', loras: [] }, catalog, client: () => client } as unknown as ConnectionManager;
  const runner = new Runner(store, connection, {}, repo); vi.spyOn(runner, 'kick').mockResolvedValue();
  const models = {} as ModelManager, draft = { ...emptyOpenjutsuDraft(), sourceId: source.id, referenceId: reference.id, length: 6 };
  const create = (key = 'request-once') => createOpenjutsuJob(store!, connection, runner, models, draft, key, () => {});
  return { source, reference, runner, client, request, connection, create, draft, catalog };
}
it('freezes an independent run, deduplicates retries, and does not rewrite the old video/image drafts', async () => {
  const f = await fixture(), before = JSON.stringify([store!.draft(), store!.imageDraft()]);
  const job = await f.create(); expect(job.settings.engine).toBe('openjutsu'); expect(job.facialConsistency).toBeUndefined(); expect(job.viggleSegmentation).toBeUndefined();
  expect(job.openjutsu?.settings).toEqual(openjutsuDefaults); expect(job.workflow?.['16'].inputs.strength_model).toBe(1);
  expect(JSON.stringify([store!.draft(), store!.imageDraft()])).toBe(before);
  expect((await f.create()).id).toBe(job.id); expect(store!.jobs()).toHaveLength(1); expect(f.client.json).not.toHaveBeenCalledWith('/prompt');
});
for (const sourceFaceGuide of ['source-face-guide-v1', 'source-face-detail-v1'] as const) it('freezes the explicit experimental guide without editing the saved draft: ' + sourceFaceGuide, async () => {
  const f = await fixture(), before = JSON.stringify([store!.draft(), store!.imageDraft()]);
  f.draft.settings.sourceFaceGuide = sourceFaceGuide;
  Object.assign(f.catalog, catalogFor(compileOpenjutsu(f.draft.settings, { start: 0, length: 6 })));
  const job = await f.create();
  expect(job.openjutsu?.settings.sourceFaceGuide).toBe(sourceFaceGuide);
  expect(job.workflow?.['41'].inputs.faces).toEqual(['71', 0]);
  expect(job.workflow?.['30'].inputs['ref_video_audios.ref_video_audio_0']).toEqual(['29', 12]);
  expect(job.facialConsistency).toBeUndefined(); expect(job.smoothMotion).toBeUndefined();
  expect(JSON.stringify([store!.draft(), store!.imageDraft()])).toBe(before);
  expect(f.client.json).not.toHaveBeenCalledWith('/prompt');
});
for (const interactionGuide of ['reference-interactions-v1', 'aligned-interactions-v1'] as const) it('freezes an explicit interaction comparison without editing saved drafts or submitting: ' + interactionGuide, async () => {
  const f = await fixture(), before = JSON.stringify([store!.draft(), store!.imageDraft()]);
  f.draft.length = 5; f.draft.settings.referenceScene = true; f.draft.settings.clipSeconds = 5;
  f.draft.settings.interactionGuide = interactionGuide;
  Object.assign(f.catalog, catalogFor(compileOpenjutsu(f.draft.settings, { start: 0, length: 5 })));
  const job = await f.create();
  expect(job.openjutsu?.settings.interactionGuide).toBe(interactionGuide);
  expect(job.workflow?.['57'].inputs.latent).toEqual(['30', 1]);
  expect(job.workflow?.['30'].inputs['ref_videos.ref_video_0']).toEqual(interactionGuide === 'reference-interactions-v1' ? ['34', 0] : undefined);
  expect(job.openjutsu?.settings.loras).toEqual(openjutsuDefaults.loras);
  expect(JSON.stringify([store!.draft(), store!.imageDraft()])).toBe(before);
  expect(f.client.json).not.toHaveBeenCalledWith('/prompt');
});
it('persists a successful native receipt and finishes a failed download without submitting again', async () => {
  const f = await fixture(), job = await f.create(), native = path.join(folder, 'fixture.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:size=64x96:rate=24', '-frames:v', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', native]);
  f.client.json.mockImplementation(async (route, body) => {
    if (route === '/object_info') return f.catalog;
    if (route === '/prompt') return f.request(body);
    if (route === '/history/paid-once') return { 'paid-once': { status: { status_str: 'success' }, outputs: { '67': { images: [{ filename: 'assembled.mp4', subfolder: '', type: 'output' }] } } } };
    if (route === '/queue') return { queue_running: [], queue_pending: [] };
    throw new Error('Unexpected ' + route);
  });
  f.client.download.mockRejectedValueOnce(new Error('Download interrupted')).mockImplementationOnce(async (_descriptor, destination) => copyFile(native, destination));
  await f.runner.run(job, new AbortController().signal); expect(store!.job(job.id)?.status).toBe('interrupted'); expect(f.request).toHaveBeenCalledOnce();
  const saved = JSON.parse(await readFile(path.join(folder, 'jobs', job.id, 'openjutsu-history.json'), 'utf8')); expect(saved.promptId).toBe('paid-once');
  f.client.json.mockImplementation(async () => { throw new Error('No GPU request needed for saved history'); });
  await f.runner.run(store!.job(job.id)!, new AbortController().signal);
  const result = store!.job(job.id)!; expect(result.status).toBe('completed'); expect(result.openjutsu?.actualFrames).toBe(5); expect(f.request).toHaveBeenCalledOnce();
  expect(await readFile(result.output!)).toEqual(await readFile(native)); expect(publicJob(result).openjutsu?.nativeFile).toBe('ready'); expect(publicJob(result).workflow).toBeNull();
  result.status = 'interrupted'; store!.saveJob(result); f.connection.status.state = 'offline';
  await f.runner.run(store!.job(job.id)!, new AbortController().signal);
  expect(store!.job(job.id)?.status).toBe('completed'); expect(f.request).toHaveBeenCalledOnce();
});
it('keeps a lost submission ambiguous and prevents an automatic paid retry', async () => {
  const f = await fixture(), job = await f.create(); f.request.mockRejectedValueOnce(new Error('Network lost after send'));
  await f.runner.run(job, new AbortController().signal); expect(store!.job(job.id)).toMatchObject({ status: 'interrupted', submitting: true, pendingPrompt: null });
  await f.runner.run(store!.job(job.id)!, new AbortController().signal); expect(f.request).toHaveBeenCalledOnce();
});

it('retains a terminal GPU failure and never treats it as a resumable paid request', async () => {
  const f = await fixture(), job = await f.create();
  const failed = { status: { status_str: 'error', messages: [['execution_start', {}], ['execution_error', { node_id: '26', node_type: 'MiniMaxH3ChainPlanModern', exception_message: 'H3 run_name must be 1-96 characters', traceback: ['private runtime stack'] }]] }, outputs: {} };
  f.client.json.mockImplementation(async (route, body) => route === '/object_info' ? f.catalog : route === '/prompt' ? f.request(body) : route === '/history/paid-once' ? { 'paid-once': failed } : { queue_running: [], queue_pending: [] });
  await f.runner.run(job, new AbortController().signal);
  const saved = store!.job(job.id)!;
  expect(saved).toMatchObject({ status: 'failed', pendingPrompt: null, submitting: false, retryRequired: false });
  expect(saved.error).toContain('internal run name'); expect(saved.error).not.toContain('private runtime stack');
  const receipt = JSON.parse(await readFile(path.join(folder, 'jobs', job.id, 'openjutsu-failure.json'), 'utf8'));
  expect(receipt.promptId).toBe('paid-once'); expect(receipt.history).toEqual(failed);
  f.connection.status.state = 'offline'; f.client.json.mockRejectedValue(new Error('No further GPU call expected')); vi.mocked(f.runner.kick).mockClear();
  await f.runner.resume(saved, true);
  expect(store!.job(job.id)?.status).toBe('failed'); expect(f.request).toHaveBeenCalledOnce(); expect(f.runner.kick).not.toHaveBeenCalled();
});

it('reconciles a verified native failure through the HTTP API offline, while rejecting an unrelated receipt', async () => {
  const f = await fixture(), job = await f.create(); job.status = 'interrupted'; job.pendingPrompt = 'terminal-id'; store!.saveJob(job);
  const directory = path.join(folder, 'jobs', job.id); await mkdir(directory, { recursive: true });
  const receipt = { jobId: job.id, promptId: job.pendingPrompt, graphSHA256: 'unrelated', history: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'H3 run_name must be 1-96 characters' }]] } } };
  const file = path.join(directory, 'openjutsu-failure.json'); await writeFile(file, JSON.stringify(receipt));
  const local = await createApplication({ repo, dataRoot: folder, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false, fetcher: vi.fn().mockRejectedValue(new Error('No provider request expected')) } });
  const gpu = vi.spyOn(local.connection, 'client').mockImplementation(() => { throw new Error('No GPU request expected'); });
  try {
    await request(local.app).post(`/api/jobs/${job.id}/resume`).send({}).expect(503);
    await writeFile(file, JSON.stringify({ ...receipt, graphSHA256: job.openjutsu!.graphSHA256 }));
    const result = await request(local.app).post(`/api/jobs/${job.id}/resume`).send({}).expect(200);
    expect(result.body.status).toBe('failed'); expect(result.body.pendingPrompt).toBeNull(); expect(result.body.error).toContain('internal run name');
    expect(gpu).not.toHaveBeenCalled(); expect(local.runner.active).toBeNull();
  } finally { local.idle.dispose(); local.models.dispose(); local.cloud.dispose(); local.store.close(); }
});

it('rejects an engine change during admission without saving or submitting a run', async () => {
  const f = await fixture();
  f.client.json.mockImplementation(async () => { f.connection.status.endpoint = 'http://127.0.0.1:8189'; return f.catalog; });
  await expect(f.create()).rejects.toThrow('GPU changed'); expect(store!.jobs()).toHaveLength(0); expect(f.request).not.toHaveBeenCalled();
});

it('does not upload or submit a queued run on a different GPU endpoint', async () => {
  const f = await fixture(), job = await f.create(); f.connection.status.endpoint = 'http://127.0.0.1:8189';
  await f.runner.run(job, new AbortController().signal);
  expect(store!.job(job.id)?.status).toBe('failed'); expect(f.client.upload).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});

it('validates native prefix-based H3 reference inputs without accepting arbitrary fields or broken links', () => {
  const catalog = {
    Source: { input: { required: {} }, output: ['IMAGE'] },
    Reference: { input: { required: { size: ['COMBO', { options: ['match', 'max'] }] }, optional: { refs: ['COMFY_AUTOGROW_V3', { template: { prefix: 'ref_', min: 0, max: 3, input: { required: { ref: ['IMAGE', {}] } } } }] } }, output: ['LATENT'] },
  } as unknown as Catalog;
  const graph: Graph = { source: { class_type: 'Source', inputs: {} }, target: { class_type: 'Reference', inputs: { size: 'match', 'refs.ref_0': ['source', 0], 'refs.ref_2': ['source', 0] } } };
  expect(validateGraph(graph, catalog)).toEqual([]);
  for (const invalid of ['refs.ref_3', 'refs.ref_-1', 'refs.ref_00', 'refs.other_0', 'refs.ref_0.extra']) {
    const bad = structuredClone(graph); bad.target.inputs[invalid] = ['source', 0];
    expect(validateGraph(bad, catalog)).toContain(`Unsupported input target.${invalid}.`);
  }
  const broken = structuredClone(graph); broken.target.inputs['refs.ref_0'] = ['source', 1]; broken.target.inputs.size = 'unsupported';
  expect(validateGraph(broken, catalog)).toEqual(['Unavailable size: unsupported.', 'Broken workflow connection at target.refs.ref_0.']);
});
