import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imagenDraft, imagenGeometry, imagenPrompt, imagenSettings, imagenWorkflows } from '../shared/imagen';
import { emptyImageDraft, imageDefaults, imageDraftSchema } from '../shared/image-replacement';
import { emptyModels, imageFilesForSettings, pinnedModels } from '../shared/models';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { defaults, type Asset, type Bootstrap, type Catalog, type Job } from '../shared/types';
import { compileWorkflow, validateGraph } from '../server/workflow';
import { createImagenJob } from '../server/imagen-jobs';
import { Store } from '../server/store';
import type { ConnectionManager } from '../server/comfy';
import type { Runner } from '../server/runner';
import type { ModelManager } from '../server/models';
import type { CloudManager } from '../server/cloud';
import ImageWorkspace from '../src/ImageWorkspace';

const catalog: Catalog = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../integration-snapshot/object-info.json'), 'utf8'));
for (const node of Object.values(catalog)) for (const [name, rule] of Object.entries({ ...node.input.required, ...node.input.optional })) {
  if (name === 'image') rule[0] = ['target.png', 'identity.png', 'face.png', 'clothing.png'];
  if (['unet_name', 'vae_name', 'clip_name'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(file => file.destination.split('/').at(-1)!)];
  if (name === 'lora_name' && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.filter(file => file.destination.startsWith('loras/')).map(file => file.destination.slice(6))];
}
const asset = (name: string): Asset => ({ id: randomUUID(), kind: 'image', name, path: '/fixture/' + name, poster: '', width: 720, height: 1280, size: 100, duration: 0, fps: 0, hasAudio: false, createdAt: new Date().toISOString() });
const inputs = [asset('target.png'), asset('character.png'), asset('face.png'), asset('outfit.png')];
const draft = (mode: NonNullable<typeof imageDefaults.workflow>) => imageDraftSchema.parse({ ...emptyImageDraft(), sourceId: inputs[0].id, referenceId: inputs[1].id, faceId: inputs[2].id, clothingId: inputs[3].id, settings: { ...imagenSettings(imageDefaults, mode), prompt: mode === 'text-to-image' ? 'A candid portrait' : '' } });
let store: Store | undefined, root = '';
afterEach(async () => { store?.close(); store = undefined; if (root) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-imagen-')); store = new Store(root);
  for (const image of inputs) store.addAsset(image);
  store.set('cloud-connected-instance', 123);
  const state = emptyModels(); for (const file of state.files) file.status = 'installed';
  const models = { state, refresh: vi.fn(async () => state) } as unknown as ModelManager;
  const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188' } } as ConnectionManager;
  const runner = { kick: vi.fn(async () => {}), externalGpuBusy: () => false } as unknown as Runner;
  const cloud = { state: { busy: false, launches: [] } } as unknown as CloudManager;
  const create = (value: ReturnType<typeof draft>, key = randomUUID()) => createImagenJob(store!, connection, runner, cloud, models, value, key);
  return { state, models, connection, runner, cloud, create };
}
describe('four-mode whole-image Imagen', () => {
  it('uses clean native defaults without enabling old adapters, painting or local passes', () => {
    const value = emptyImageDraft();
    expect(value.settings).toMatchObject({ workflow: 'body-only', qwenQuality: 'quality', megapixels: 2, protectBackground: false });
    const upgraded = imagenSettings({ ...imageDefaults, localIdentity: true, qwenRelight: true, bodyOnlyStrategy: 'staged', bodyOnlyPose: true });
    expect(upgraded).toMatchObject({ protectBackground: false, bodyOnlyStrategy: 'native', localIdentity: false, qwenRelight: false, bodyOnlyPose: false, prompt: '' });
    expect(imageFilesForSettings(upgraded)).toHaveLength(3); expect(moduleDownloadPlan('imagen', upgraded).runtimes).toEqual([]);
    expect(imageDefaults.qwenQuality).toBe('fast'); // Historical preset/compiler stays frozen.
  });
  for (const mode of imagenWorkflows) it(`creates and validates the ${mode.label} graph with the exact native input contract`, async () => {
    const { create, runner } = await fixture(), value = draft(mode.id), job = await create(value);
    job.uploads = { source: 'target.png', reference: 'identity.png', ...(job.image!.faceId ? { face: 'face.png' } : {}), ...(job.image!.clothingId ? { clothing: 'clothing.png' } : {}) };
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(job.image).toMatchObject({ version: 'imagen-v1', maskId: null, settings: { protectBackground: false } });
    expect(graph['118'].inputs).toMatchObject({ steps: 40, cfg: 1, sampler_name: 'euler' });
    expect(graph['119'].class_type).toBe('VAEDecodeTiled');
    expect(Object.values(graph).some(n => /Composite|NoiseMask|BFS/.test(n.class_type))).toBe(false);
    expect(graph['105']).toBeUndefined(); expect(runner.kick).toHaveBeenCalledOnce();
    if (mode.id === 'text-to-image') { expect(graph['1']).toBeUndefined(); expect(graph['109'].class_type).toBe('EmptyLatentImage'); expect(job.sourceId).toBe(''); }
    else expect(graph['108'].inputs['images.image_1']).toEqual(['1', 0]);
    if (mode.id === 'character-outfit') expect(graph['108'].inputs['images.image_4']).toEqual(['6', 0]);
    if (mode.id === 'clothing-only') { expect(job.referenceId).toBe(inputs[3].id); expect(graph['108'].inputs['images.image_3']).toBeUndefined(); }
  });
  it('supports a two-photo identity edit and worn/standalone outfits without inventing a face slot', async () => {
    const { create } = await fixture(), value = draft('character-outfit'); value.faceId = null;
    const job = await create(value); job.uploads = { source: 'target.png', reference: 'person.png', clothing: 'outfit.png' };
    const graph = compileWorkflow({}, job);
    expect(graph['108'].inputs['images.image_3']).toEqual(['6', 0]); expect(graph['108'].inputs['images.image_4']).toBeUndefined();
    expect(job.image!.conditioningPrompt).toContain('skin coverage come only from <image3>');
    expect(job.image!.conditioningPrompt).toContain('Do not keep or restore garments from <image1>');
    value.clothingId = null; const two = await create(value);
    expect(two.image!.conditioningPrompt).toContain('skin coverage come only from <image2>');
    expect(two.image!.faceId).toBeNull();
  });
  it('freezes bilingual roles and preserves extra user directions verbatim', () => {
    const settings = draft('character-outfit').settings; settings.prompt = 'Keep the silver wristwatch.';
    const en = imagenPrompt(settings, true, true), zh = imagenPrompt({ ...settings, promptLanguage: 'zh' }, true, true);
    expect(en).toContain('<image4>'); expect(zh).toContain('<image4>'); expect(zh).toContain('面部身份');
    expect(en.endsWith(settings.prompt)).toBe(true); expect(zh.endsWith(settings.prompt)).toBe(true);
    expect(en).not.toContain('4K'); expect(zh).not.toContain('4K');
  });
  it('retains the full source aspect and records true native output dimensions', () => {
    const g = imagenGeometry(draft('body-only').settings, inputs[0]);
    expect(g).toMatchObject({ outputWidth: 1152, outputHeight: 2048, contentWidth: 1152, contentHeight: 2048 });
    expect(imagenGeometry({ ...draft('text-to-image').settings, outputAspect: '16:9' })).toMatchObject({ outputWidth: 2048, outputHeight: 1152 });
  });
  it('rejects disabled Klein, missing references, stale crops, unavailable models and connection changes without queuing', async () => {
    const f = await fixture(), value = draft('body-only');
    await expect(f.create({ ...value, settings: { ...value.settings, model: 'klein4b' } })).rejects.toThrow('Klein');
    await expect(f.create({ ...value, referenceId: null })).rejects.toThrow('character reference');
    await expect(f.create({ ...value, settings: { ...value.settings, bodyReferenceView: { assetId: randomUUID(), x: 0, y: 0, width: 50, height: 50 } } })).rejects.toThrow('another reference');
    f.state.files.find(file => file.id === imageFilesForSettings(value.settings)[0])!.status = 'missing';
    await expect(f.create(value)).rejects.toThrow('Download Imagen');
    for (const file of f.state.files) file.status = 'installed';
    vi.mocked(f.models.refresh).mockImplementationOnce(async () => { store!.set('cloud-connected-instance', 456); return f.state; });
    await expect(f.create(value)).rejects.toThrow('readiness changed'); expect(store!.jobs()).toHaveLength(0);
  });
  it('deduplicates a retried image request and freezes its paid recipe', async () => {
    const { create, runner } = await fixture(), key = randomUUID(), value = draft('body-only');
    const first = await create(value, key); const frozen = JSON.stringify(store!.job(first.id));
    await create({ ...value, settings: { ...value.settings, prompt: 'Different instruction' } }, key);
    expect(store!.jobs()).toHaveLength(1); expect(JSON.stringify(store!.job(first.id))).toBe(frozen); expect(runner.kick).toHaveBeenCalledOnce();
  });
  for (const mode of imagenWorkflows) it(`shows only the requested inputs and workflow settings for ${mode.label}`, () => {
    const value = draft(mode.id), state = emptyModels();
    const data = { assets: inputs, jobs: [], characters: [], connection: { state: 'offline' }, cloud: { busy: false }, models: state } as unknown as Bootstrap;
    const html = renderToStaticMarkup(<ImageWorkspace data={data} draft={value} motionDraft={{ sourceId: null, referenceId: null, settings: defaults }} downloads={{ state, online: false, blocked: false, download() {}, remove() {} }}
      selectedId={null} select={() => {}} close={() => {}} setDraft={() => {}} asset={() => {}} job={() => {}} error={() => {}} openCharacters={() => {}} openModels={() => {}} openGPU={() => {}} library={() => {}} motion={() => {}} />);
    expect(html).toContain('Imagen workflow'); expect(html).not.toContain('PaintBrush'); expect(html).not.toContain('Paint replacement area'); expect(html).not.toContain('Klein 4B'); expect(html).not.toContain('Whole-person · legacy');
    if (mode.id === 'text-to-image') { expect(html).toContain('Describe your image'); expect(html).not.toContain('Target photo'); }
    if (mode.id === 'clothing-only') { expect(html).toContain('Clothing reference'); expect(html).not.toContain('Face reference · optional'); }
    expect(html).toContain('aria-label="Quality"'); expect(html).toContain('aria-label="Native size"'); expect(html).toContain('2048');
  });
});
