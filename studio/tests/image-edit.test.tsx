import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyImageEditDraft, imageEditDraftForJob, imageEditDraftSchema, imageEditFiles, imageEditGeometry, imageEditSampling } from '../shared/image-edit';
import { emptyModels, modelBytes, pinnedModels } from '../shared/models';
import { moduleDownloadPlan, moduleDownloadRequestSchema } from '../shared/module-downloads';
import { runSummary, savedRunSettings } from '../shared/library';
import { offerFiltersSchema } from '../shared/cloud';
import { marketRequirements } from '../server/cloud-market';
import { compileWorkflow, validateGraph } from '../server/workflow';
import { createImageEditJob } from '../server/image-edit';
import { ImageFinalizationError, processImage } from '../server/image-processing';
import { command } from '../server/media';
import { Runner } from '../server/runner';
import { Store } from '../server/store';
import type { ConnectionManager } from '../server/comfy';
import type { ModelManager } from '../server/models';
import type { CloudManager } from '../server/cloud';
import type { Asset, Bootstrap, Catalog } from '../shared/types';
import ImageEditWorkspace from '../src/ImageEditWorkspace';

const repo = path.resolve(import.meta.dirname, '../..');
const catalog: Catalog = JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));
for (const node of Object.values(catalog)) for (const [name, rule] of Object.entries({ ...node.input.required, ...node.input.optional })) {
  if (name === 'image') rule[0] = ['one.png', 'two.png', 'three.png', 'source.png', 'reference.png', 'face.png'];
  if (['unet_name', 'vae_name', 'clip_name', 'lora_name'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(f => f.destination.split('/').at(-1)!)];
}
let root = '', store: Store | undefined;
afterEach(async () => { store?.close(); store = undefined; if (root) await rm(root, { recursive: true, force: true }); root = ''; });
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-image-edit-')); store = new Store(root);
  const file = path.join(root, 'input.png');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=purple:size=64x96', '-frames:v', '1', file]);
  const data = await readFile(file), inputs: Asset[] = [];
  for (let i = 0; i < 3; i++) {
    const image = { id: randomUUID(), kind: 'image' as const, name: `Image ${i + 1}.png`, path: path.join(root, `input-${i}.png`), poster: '', width: 64, height: 96, size: data.length, duration: 0, fps: 0, hasAudio: false, createdAt: new Date().toISOString(), ...(i === 0 ? { sourceFrame: { videoId: 'video-id', time: 2.3 } } : {}) };
    await writeFile(image.path, data); store.addAsset(image); inputs.push(image);
  }
  const state = emptyModels(); for (const f of state.files) f.status = 'installed';
  const models = { state, refresh: vi.fn(async () => state) } as unknown as ModelManager;
  const connection = { status: { state: 'online', endpoint: 'http://fixture:8188' } } as ConnectionManager;
  const runner = { kick: vi.fn(async () => {}), externalGpuBusy: () => false } as unknown as Runner;
  const cloud = { state: { busy: false, launches: [] } } as unknown as CloudManager;
  store.set('cloud-connected-instance', 42);
  const draft = imageEditDraftSchema.parse({ referenceIds: inputs.map(a => a.id), settings: { prompt: '  Edit 图像1 using Image 2.\nKeep the scene.  ', randomSeed: false } });
  const create = (value = draft, key = randomUUID()) => createImageEditJob(store!, connection, runner, cloud, models, value, key);
  return { inputs, state, models, connection, runner, cloud, draft, create };
}
describe('independent Qwen Image Edit 2511', () => {
  it('selects only matching pinned files for each precision and sampling route', () => {
    const s = emptyImageEditDraft().settings;
    expect(s).toMatchObject({ quality: 'native', precision: 'int8', resolution: '1k', format: 'png' });
    expect(imageEditFiles(s)).toHaveLength(3); expect(modelBytes(imageEditFiles(s))).toBe(30137560750);
    expect(modelBytes(imageEditFiles({ ...s, precision: 'bf16' }))).toBe(50499508486);
    const fast = imageEditFiles({ ...s, quality: 'lightning' }); expect(fast).toHaveLength(4); expect(fast.at(-1)).toContain('2511-Lightning-4steps');
    expect(imageEditFiles(s).join()).not.toMatch(/2\.1|qwen3vl|bfs|face_consistency/);
    const plan = moduleDownloadPlan('image-edit', s); expect(plan.files).toEqual(imageEditFiles(s)); expect(plan.runtimes).toEqual([]);
    expect(moduleDownloadRequestSchema.parse({ module: 'image-edit', settings: s })).toMatchObject({ module: 'image-edit' });
  });
  for (const count of [1, 2, 3]) for (const quality of ['native', 'lightning'] as const) it(`compiles ${count} ordered images / ${quality} against the native node contract`, async () => {
    const f = await fixture(), value = { ...f.draft, referenceIds: f.draft.referenceIds.slice(0, count), settings: { ...f.draft.settings, quality } }, job = await f.create(value);
    job.uploads = { source: 'one.png', reference: 'two.png', face: 'three.png' };
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['108'].inputs.prompt).toBe(value.settings.prompt); expect(graph['110'].inputs.prompt).toBe('');
    for (let i = 1; i <= count; i++) expect(graph['108'].inputs[`image${i}`]).toEqual([String(i), 0]);
    expect(graph['108'].inputs[`image${count + 1}`]).toBeUndefined();
    expect(graph['118'].inputs).toMatchObject({ ...((({ steps, cfg }) => ({ steps, cfg }))(imageEditSampling(value.settings))), denoise: 1, sampler_name: 'euler', scheduler: 'simple' });
    expect(graph['106'].inputs.shift).toBe(3.1); expect(graph['109'].class_type).toBe('EmptySD3LatentImage');
    expect(!!graph['105']).toBe(quality === 'lightning');
    expect(Object.values(graph).some(n => /Composite|Mask|QwenImage21Cache|SplitImageWithAlpha/.test(n.class_type))).toBe(false);
    expect(job.image!.edit!.references.map(r => r.id)).toEqual(value.referenceIds);
    expect(job.image!.edit!.references[0].sha256).toBe(createHash('sha256').update(await readFile(f.inputs[0].path)).digest('hex'));
    expect(job.image!.edit!.references[0].sourceFrame).toEqual({ videoId: 'video-id', time: 2.3 });
  });
  it('rejects invalid, missing and oversized inputs and changed readiness without submitting', async () => {
    const f = await fixture();
    expect(imageEditDraftSchema.safeParse({ referenceIds: ['1', '2', '3', '4'] }).success).toBe(false);
    await expect(f.create({ ...f.draft, referenceIds: [] })).rejects.toThrow('at least one');
    await expect(f.create({ ...f.draft, settings: { ...f.draft.settings, prompt: '  ' } })).rejects.toThrow('Describe');
    await expect(f.create({ ...f.draft, referenceIds: ['missing'] })).rejects.toThrow('readable');
    await writeFile(f.inputs[0].path, Buffer.alloc(10_000_001));
    await expect(f.create()).rejects.toThrow('10 MB');
    await copyFile(f.inputs[1].path, f.inputs[0].path);
    f.state.files.find(x => x.id === imageEditFiles(f.draft.settings)[0])!.status = 'missing';
    await expect(f.create()).rejects.toThrow('Download Image Edit');
    for (const x of f.state.files) x.status = 'installed';
    vi.mocked(f.models.refresh).mockImplementationOnce(async () => { store!.set('cloud-connected-instance', 43); return f.state; });
    await expect(f.create()).rejects.toThrow('readiness changed');
    f.connection.status.state = 'offline'; await expect(f.create()).rejects.toThrow('Connect');
    expect(store!.jobs()).toHaveLength(0); expect(f.runner.kick).not.toHaveBeenCalled();
  });
  it('deduplicates a network retry even after disconnection without mutating the frozen run', async () => {
    const f = await fixture(), key = randomUUID(), job = await f.create(f.draft, key), before = JSON.stringify(store!.job(job.id));
    f.connection.status.state = 'offline';
    await f.create({ ...f.draft, settings: { ...f.draft.settings, prompt: 'A new request' } }, key);
    expect(JSON.stringify(store!.job(job.id))).toBe(before); expect(f.runner.kick).toHaveBeenCalledOnce();
    expect(imageEditDraftForJob(job)).toEqual({ referenceIds: f.draft.referenceIds, settings: { ...f.draft.settings, randomSeed: false } });
    expect(savedRunSettings(job)).toMatchObject({ model: 'Qwen Image Edit 2511', prompt: f.draft.settings.prompt, steps: 40 });
    expect(runSummary(job)).toContainEqual(['Workflow', 'Image Edit']);
  });
  it('computes real native dimensions and selected-file marketplace requirements', async () => {
    await fixture(); const s = emptyImageEditDraft().settings;
    for (const aspect of ['source', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const) {
      const g = imageEditGeometry({ ...s, aspect, resolution: '2k' }, { width: 720, height: 1280 });
      expect(g.width % 32).toBe(0); expect(g.height % 32).toBe(0); expect(g.outputWidth).toBe(g.width); expect(g.width * g.height).toBeGreaterThan(4_000_000);
    }
    const compact = marketRequirements(store!, offerFiltersSchema.parse({ workflow: 'image-edit' })).requirements;
    expect(compact.modelGB).toBeCloseTo(30.13756); expect(compact.minVram).toBe(24);
    store!.set('image-edit-draft', { ...emptyImageEditDraft(), settings: { ...s, precision: 'bf16' } });
    const full = marketRequirements(store!, offerFiltersSchema.parse({ workflow: 'image-edit' })).requirements;
    expect(full.modelGB).toBeCloseTo(50.49951); expect(full.minVram).toBe(48); expect(full.minDisk).toBeGreaterThan(compact.minDisk);
  });
  it('keeps download available before references are added and exposes only independent editing controls', () => {
    const state = emptyModels(), draft = emptyImageEditDraft();
    const html = renderToStaticMarkup(<ImageEditWorkspace data={{ assets: [], jobs: [], models: state, cloud: { busy: false }, connection: { state: 'online' } } as unknown as Bootstrap} draft={draft} setDraft={() => {}} downloads={{ state, online: true, blocked: false, download() {}, remove() {} }} selectedId={null} select={() => {}} close={() => {}} asset={() => {}} job={() => {}} error={() => {}} openDownloads={() => {}} openGPU={() => {}} library={() => {}}/>);
    expect(html).toContain('Download Image Edit'); expect(html).toContain('Qwen 2511'); expect(html).toContain('What should change?');
    expect(html).not.toContain('Paint replacement'); expect(html).not.toContain('Character source'); expect(html).not.toContain('Face refinement');
    expect(html.match(/<button[^>]+class="primary-button generate module-primary-button"[^>]*>/)?.[0]).not.toContain('disabled');
  });
  it('saves a paid native receipt once, then finishes JPEG locally after a failed export without resampling', async () => {
    const f = await fixture(), job = await f.create({ ...f.draft, settings: { ...f.draft.settings, format: 'jpeg' } });
    const native = path.join(root, 'native.png');
    await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=orange:size=${job.width}x${job.height}`, '-frames:v', '1', native]);
    const submit = vi.fn(), live = structuredClone(catalog), calls: string[] = [];
    const client = { upload: vi.fn(async (_file: string, name: string) => { const filename = name.split('-').at(-1)! + '.png'; (live.LoadImage.input.required!.image[0] as string[]).push(filename); return filename; }), watch: async () => ({ close() {}, readyState: 1 }),
      json: async (url: string, body?: unknown) => { calls.push(url); if (url === '/object_info') return live; if (url === '/prompt') { submit(body); return { prompt_id: 'paid-once' }; } if (url === '/history/paid-once') return { 'paid-once': { status: { status_str: 'success' }, outputs: { '46': { images: [{ filename: 'paid.png', type: 'output', subfolder: '' }] } } } }; if (url === '/queue') return { queue_running: [], queue_pending: [] }; throw new Error('Unexpected ' + url); }, download: vi.fn(async (_info: unknown, file: string) => copyFile(native, file)) };
    const connection = { ...f.connection, client: () => client } as unknown as ConnectionManager;
    const runner = new Runner(store!, connection, {}, repo); let fail = true;
    runner.imageProcessor = async (action, ...args) => { if (action === 'finish' && fail) { fail = false; throw new ImageFinalizationError('Fixture local export interrupted'); } return processImage(action, ...args); };
    await runner.run(job, new AbortController().signal);
    expect(store!.job(job.id)).toMatchObject({ status: 'interrupted', progress: { completedFrames: 1 }, pendingPrompt: null }); expect(submit).toHaveBeenCalledOnce();
    connection.status.state = 'offline'; calls.length = 0;
    await runner.run(store!.job(job.id)!, new AbortController().signal);
    expect(store!.job(job.id)).toMatchObject({ status: 'completed' }); expect(store!.job(job.id)!.output).toMatch(/final\.jpg$/); expect(submit).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
    expect(client.upload).toHaveBeenCalledTimes(3); expect(client.download).toHaveBeenCalledOnce();
  });
});
