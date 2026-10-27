import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaults, type Catalog, type Job } from '../shared/types';
import { defaultImagePrompt, emptyImageDraft, imageDefaults, imageGeometry, imagePrompt, isImageJob, legacyImagePrompt } from '../shared/image-replacement';
import { IMAGE_IDENTITY, QWEN_HEAD, QWEN_STRUCTURE, QWEN_OUTFIT, QWEN_CONSISTENCY, imageFilesForSettings, imageModelFiles, modelBytes, pinnedModels, qwenImageModelFiles } from '../shared/models';
import { compileWorkflow, validateGraph } from '../server/workflow';
import { applyProgress } from '../server/comfy';
import { publicJob } from '../server/store';

const repo = path.resolve(import.meta.dirname, '../..');
const load = (file: string) => JSON.parse(readFileSync(path.join(repo, file), 'utf8'));
const catalog: Catalog = { ...load('integration-snapshot/object-info.json'), ...load('integration-snapshot/viggle-node-schemas.json'), ...load('integration-snapshot/qwen21-node-schemas.json'), ...load('integration-snapshot/qwen21-control-node-schemas.json') };
catalog.ModelPatchLoader.input.required!.name[0] = [QWEN_STRUCTURE.split('/').at(-1)!];
for (const node of Object.values(catalog)) for (const [name, rule] of Object.entries({ ...node.input.required, ...node.input.optional })) {
  if (name === 'image') rule[0] = ['target.png', 'identity.png', 'face.png', 'original.png', 'mask.png'];
  if (['unet_name', 'vae_name', 'clip_name'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(f => f.destination.split('/').at(-1))];
  if (name === 'lora_name' && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.filter(file => file.destination.startsWith('loras/')).map(file => file.destination.slice(6))];
}
function fixture(): Job {
  const geometry = imageGeometry({ width: 1171, height: 1801 }, 1);
  return { id: 'image-test', title: 'Image replacement', mediaType: 'image', status: 'queued', settings: defaults, image: { version: 'masked-latent-v2', settings: imageDefaults, geometry, maskId: 'mask', faceId: null },
    sourceId: 'target', referenceId: 'identity', width: geometry.width, height: geometry.height, outputSize: { width: geometry.outputWidth, height: geometry.outputHeight }, createdAt: '', favorite: false, deleted: false,
    progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: 0 },
    uploads: { source: 'target.png', reference: 'identity.png', face: 'face.png', original: 'original.png', mask: 'mask.png', noiseMask: 'mask.png' }, segments: [], context: '', pendingPrompt: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}
describe('source-preserving Klein image replacement', () => {
  it('uses a separate draft and only the existing three image models', () => {
    expect(emptyImageDraft().settings.prompt).toBe(defaultImagePrompt);
    expect(emptyImageDraft().settings.protectBackground).toBe(true);
    expect(imageModelFiles).toHaveLength(3); expect(modelBytes(imageModelFiles)).toBe(12_451_817_860);
    expect(imageModelFiles.some(name => /viggle|SCAIL|lora/i.test(name))).toBe(false);
    expect(isImageJob({ mediaType: undefined })).toBe(false);
  });
  it('pads to the model grid without cropping or changing the final camera framing', () => {
    for (const dimensions of [{ width: 941, height: 1672 }, { width: 1920, height: 1080 }, { width: 1171, height: 1801 }]) {
      const g = imageGeometry(dimensions, 1);
      expect(g.width % 16).toBe(0); expect(g.height % 16).toBe(0);
      expect(g.contentWidth + g.x).toBeLessThanOrEqual(g.width); expect(g.contentHeight + g.y).toBeLessThanOrEqual(g.height);
      expect(Math.abs(g.contentWidth / g.contentHeight - dimensions.width / dimensions.height)).toBeLessThan(.003);
      expect([g.outputWidth, g.outputHeight]).toEqual([dimensions.width, dimensions.height]);
    }
    expect(() => imageGeometry({ width: 10000, height: 10000 }, 1)).toThrow('32 megapixels');
    expect(() => imageGeometry({ width: 1600, height: 40 }, 1)).toThrow('aspect ratio');
  });
  it('keeps target first, full identity second and optional facial detail third', () => {
    const job = fixture(), graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['109'].inputs.latent).toEqual(['107', 0]); expect(graph['111'].inputs.latent).toEqual(['108', 0]);
    expect(graph['124'].inputs).toEqual({ conditioning: ['111', 0], latent: ['123', 0] });
    expect(graph['113'].inputs).toMatchObject({ cfg: 1, positive: ['124', 0], negative: ['125', 0] });
    expect(graph['115'].inputs.steps).toBe(4); expect(graph['117'].inputs.sampler_name).toBe('euler');
    expect(graph['134'].inputs).toEqual({ samples: ['107', 0], mask: ['133', 0] });
    expect(graph['118'].inputs.latent_image).toEqual(['134', 0]); expect(graph['114']).toBeUndefined();
    expect(Object.values(graph).some(node => /Viggle|Video|SCAIL|RestoreFace|LoraLoader/.test(node.class_type))).toBe(false);
  });
  it('keeps already paid legacy image conditioning on its original recipe', () => {
    const job = fixture(); delete job.image!.version; delete job.uploads!.noiseMask;
    const graph = compileWorkflow({}, job);
    expect(graph['134']).toBeUndefined(); expect(graph['118'].inputs.latent_image).toEqual(['114', 0]);
    expect(graph['114'].inputs.batch_size).toBe(1);
  });
  it('removes padding and composites only the selected area over the original scene', () => {
    const job = fixture(), g = job.image!.geometry, graph = compileWorkflow({}, job);
    expect(graph['126'].inputs).toEqual({ image: ['119', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y });
    expect(graph['127'].inputs).toMatchObject({ width: 1171, height: 1801, crop: 'disabled' });
    expect(graph['131'].inputs).toMatchObject({ destination: ['128', 0], source: ['127', 0], mask: ['130', 0], resize_source: false });
    expect(graph['130'].inputs.channel).toBe('red');
    expect(graph['46'].inputs).toEqual({ images: ['131', 0], filename_prefix: 'recast/image-test/segment_0000' });
    delete job.uploads!.mask; expect(() => compileWorkflow({}, job)).toThrow('Paint');
  });
  it('makes full-photo edits and a missing face crop explicit rather than inventing conditioning', () => {
    const job = fixture(); job.image!.settings = { ...imageDefaults, protectBackground: false, faceDetail: false };
    job.uploads = { source: 'target.png', reference: 'identity.png' };
    const graph = compileWorkflow({}, job);
    expect(graph['124']).toBeUndefined(); expect(graph['128']).toBeUndefined(); expect(graph['131']).toBeUndefined();
    expect(graph['113'].inputs.positive).toEqual(['111', 0]); expect(graph['46'].inputs.images).toEqual(['127', 0]);
    expect(imagePrompt({ ...imageDefaults, prompt: '' }, false)).toContain(legacyImagePrompt);
    expect(imagePrompt(imageDefaults, true)).toContain('IMAGE 3');
    expect(imagePrompt(imageDefaults, false)).not.toContain('IMAGE 3');
  });
  it('separates the trained identity pass from outfit editing and requires only its selected adapter', () => {
    const job = fixture(); job.image!.version = 'masked-latent-v3';
    job.image!.settings = { ...imageDefaults, identityRefine: true };
    job.uploads!.faceMask = 'mask.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['124']).toBeUndefined();
    expect(graph['113'].inputs.model).toEqual(['102', 0]);
    expect(graph['208'].inputs).toEqual({ model: ['102', 0], lora_name: IMAGE_IDENTITY, strength_model: 1 });
    expect(graph['209'].inputs.model).toEqual(['208', 0]);
    expect(graph['204'].inputs.latent).toEqual(['201', 0]);
    expect(graph['206'].inputs.latent).toEqual(['123', 0]);
    expect(graph['212'].inputs.samples).toEqual(['201', 0]);
    expect(graph['220'].inputs.destination).toEqual(['119', 0]);
    expect(graph['126'].inputs.image).toEqual(['220', 0]);
    expect(graph['105'].inputs.text).not.toContain('IMAGE 3');
    expect(imageFilesForSettings(imageDefaults)).toEqual(imageModelFiles);
    expect(imageFilesForSettings(job.image!.settings)).toEqual([...imageModelFiles, 'loras/' + IMAGE_IDENTITY]);
    delete job.uploads!.faceMask; expect(() => compileWorkflow({}, job)).toThrow('clear reference face');
  });
  it('uses a focused complete-outfit default only on the new recipe, preserving paid legacy prompts', () => {
    expect(imagePrompt({ ...imageDefaults, prompt: legacyImagePrompt }, false, 'masked-latent-v3')).toContain(defaultImagePrompt);
    expect(imagePrompt({ ...imageDefaults, prompt: '' }, false, 'masked-latent-v2')).toContain(legacyImagePrompt);
    expect(imagePrompt({ ...imageDefaults, prompt: '' }, false, 'masked-latent-v3')).toContain('complete outfit');
    expect(defaultImagePrompt).toContain('light direction');
    expect(defaultImagePrompt).not.toContain('maroon');
  });
  it('uses the published fresh-latent adapter recipe and an explicit facial reference budget on v4', () => {
    const job = fixture(); job.image!.version = 'masked-latent-v4'; job.image!.settings = { ...imageDefaults, identityRefine: true }; job.uploads!.faceMask = 'mask.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['123'].inputs.pixels).toEqual(['221', 0]);
    expect(graph['221'].inputs.megapixels).toBe(1);
    expect(graph['218'].inputs.latent_image).toEqual(['214', 0]);
    expect(graph['214'].inputs).toEqual({ width: job.width, height: job.height, batch_size: 1 });
    expect(graph['212']).toBeUndefined();
    expect(graph['220'].inputs.mask).toEqual(['211', 0]);
    expect(graph['131'].inputs.destination).toEqual(['128', 0]);
  });
  it('keeps Qwen whole-person inputs ordered, native latent sizing and matching model families', () => {
    const job = fixture(); job.image!.version = 'masked-latent-v4'; job.image!.settings = { ...imageDefaults, model: 'qwen21', faceDetail: false };
    job.image!.geometry = imageGeometry({ width: 720, height: 1280 }, 2, 'qwen21');
    const graph = compileWorkflow({}, job), g = job.image!.geometry;
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['108'].inputs).toMatchObject({ 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], resolution: 0 });
    expect(graph['118'].inputs).toMatchObject({ latent_image: ['108', 2], steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple' });
    expect(graph['120'].class_type).toBe('SplitImageWithAlpha');
    expect(graph['126'].inputs.image).toEqual(['120', 0]);
    expect(graph['131'].inputs.destination).toEqual(['128', 0]);
    expect(g.width % 32).toBe(0); expect(g.height % 32).toBe(0);
    expect(g.contentWidth * g.contentHeight).toBeGreaterThan(1_990_000);
    expect(imageFilesForSettings(job.image!.settings)).toEqual(qwenImageModelFiles);
    expect(modelBytes(qwenImageModelFiles)).toBe(18_406_159_200);
    expect(qwenImageModelFiles.some(file => /klein|flux2|qwen_3_4b/.test(file))).toBe(false);
    graph['108'].inputs['images.unapproved_17'] = ['4', 0];
    expect(validateGraph(graph, catalog)).toContain('Unsupported input 108.images.unapproved_17.');
  });
  it('reports true four-step image progress and keeps input upload paths private', () => {
    const job = fixture(); job.workflow = compileWorkflow({}, job); job.pendingPrompt = 'paid-image';
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'other', node: '118', value: 2, max: 4 } })).toBe(false);
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'paid-image', node: '118', value: 2, max: 4 } })).toBe(true);
    expect(job.progress).toMatchObject({ value: 2, max: 4, unit: 'steps', stage: 'Replace the character in four image steps' });
    expect(publicJob(job).uploads).toBeNull(); expect(publicJob(job).image?.settings).toEqual(job.image!.settings);
  });
  it('anchors new Qwen edits to source latents, masks and a trained control branch', () => {
    const job = fixture(); job.image!.version = 'scene-anchor-v1';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'source-anchored', faceDetail: false, qwenHeadRefine: false };
    job.uploads!.structure = 'target.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['149'].inputs).toEqual({ samples: ['144', 0], mask: ['143', 0] });
    expect(graph['146'].inputs).toMatchObject({ image: ['141', 0], inpaint_image: ['1', 0], mask: ['143', 0], model_patch: ['140', 0] });
    expect(graph['118'].inputs.latent_image).toEqual(['149', 0]);
    expect(graph['107']).toBeUndefined(); // Reference-prefix cache is not mixed with active structural patches.
    expect(imageFilesForSettings(job.image!.settings)).toContain(QWEN_STRUCTURE);
    expect(imageFilesForSettings(job.image!.settings)).not.toContain('loras/' + QWEN_HEAD);
    delete job.uploads!.structure; expect(() => compileWorkflow({}, job)).toThrow('prepared source structure');
  });
  it('uses independent body/head model branches and true per-pass counters', () => {
    const job = fixture(); job.image!.version = 'scene-anchor-v1';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'source-anchored', qwenHeadRefine: true, qwenQuality: 'quality' };
    Object.assign(job.uploads!, { structure: 'target.png', faceMask: 'mask.png', bodyMask: 'mask.png' });
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['105']).toBeUndefined(); // Native 20-step sampling has no distillation adapter.
    expect(graph['106'].inputs.model).toEqual(['102', 0]);
    expect(graph['206'].inputs.model).toEqual(['102', 0]);
    expect(graph['206'].inputs.lora_name).toBe(QWEN_HEAD);
    expect(graph['208'].inputs).toMatchObject({ 'images.image_1': ['153', 0], 'images.image_2': ['203', 0] });
    expect(graph['208'].inputs['images.image_3']).toBeUndefined();
    expect(graph['218'].inputs).toMatchObject({ steps: 20, cfg: 4, latent_image: ['214', 0] });
    expect(imageFilesForSettings(job.image!.settings)).toContain('loras/' + QWEN_HEAD);
    expect(imageFilesForSettings(job.image!.settings).some(file => file.includes('turbo_lora'))).toBe(false);
    job.workflow = graph; job.pendingPrompt = 'scene-paid';
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'scene-paid', node: '218', value: 3, max: 20 } })).toBe(true);
    expect(job.progress).toMatchObject({ value: 3, max: 20, unit: 'steps', stage: 'Separate facial identity · 20 steps' });
  });
  it('uses the trained native edit latents in v2 while preserving paid v1 source-latent jobs', () => {
    const job = fixture(); job.image!.version = 'scene-anchor-v2';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'source-anchored', qwenHeadRefine: true };
    Object.assign(job.uploads!, { structure: 'target.png', faceMask: 'mask.png', bodyMask: 'mask.png' });
    let graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['118'].inputs.latent_image).toEqual(['108', 2]);
    expect(graph['218'].inputs.latent_image).toEqual(['208', 2]);
    expect(graph['149']).toBeUndefined(); expect(graph['214']).toBeUndefined();
    expect(graph['146'].inputs.inpaint_image).toEqual(['1', 0]);
    expect(graph['215'].inputs.mask).toEqual(['211', 0]);
    job.image!.version = 'scene-anchor-v1'; graph = compileWorkflow({}, job);
    expect(graph['118'].inputs.latent_image).toEqual(['149', 0]);
    expect(graph['218'].inputs.latent_image).toEqual(['214', 0]);
  });
  it('keeps native Qwen CFG at one and removes unused control and acceleration files in v3', () => {
    const job = fixture(); job.image!.version = 'scene-anchor-v3';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'source-anchored', qwenQuality: 'quality', qwenHeadRefine: false, structureStrength: 0 };
    job.uploads!.structure = 'target.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['118'].inputs).toMatchObject({ cfg: 1, steps: 20, latent_image: ['108', 2], model: ['106', 0] });
    expect(graph['140']).toBeUndefined(); expect(graph['146']).toBeUndefined(); expect(graph['105']).toBeUndefined(); expect(graph['218']).toBeUndefined();
    expect(graph['155'].inputs.images).toEqual(['120', 0]);
    expect(imageFilesForSettings(job.image!.settings)).not.toContain(QWEN_STRUCTURE);
    expect(imageFilesForSettings(job.image!.settings).some(file => /turbo|head_v1/.test(file))).toBe(false);
    job.image!.version = 'scene-anchor-v2';
    expect(compileWorkflow({}, job)['118'].inputs.cfg).toBe(4);
  });
  it('guides native edits with a third mask reference and blends once without BFS or head adapters', () => {
    const job = fixture(); job.image!.version = 'native-mask-v1';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'native-masked', qwenQuality: 'quality', qwenHeadRefine: false, faceDetail: false, maskExpand: 24, feather: 16 };
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['108'].inputs).toMatchObject({ 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], 'images.image_3': ['142', 0] });
    expect(graph['118'].inputs).toMatchObject({ cfg: 1, steps: 25, latent_image: ['108', 2] });
    expect(Object.values(graph).filter(node => node.class_type === 'ImageCompositeMasked')).toHaveLength(1);
    expect(Object.values(graph).some(node => node.class_type === 'LoraLoaderModelOnly' || node.class_type === 'ModelPatchLoader')).toBe(false);
    expect(imageFilesForSettings(job.image!.settings)).toHaveLength(3);
    expect(imageFilesForSettings(job.image!.settings).some(file => file.includes('loras/') || file.includes('model_patches/'))).toBe(false);
    delete job.uploads!.noiseMask;
    expect(() => compileWorkflow({}, job)).toThrow('target-aligned painted edit area');
  });
  it('refines native facial identity on the generated scene before a single final scene blend', () => {
    const job = fixture(); job.image!.version = 'native-mask-v1';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'native-masked', qwenHeadRefine: true };
    job.uploads!.faceMask = 'mask.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['208'].inputs['images.image_1']).toEqual(['120', 0]);
    expect(graph['208'].inputs['images.image_2']).toEqual(['203', 0]);
    expect(graph['208'].inputs['images.image_3']).toBeUndefined();
    expect(graph['206'].inputs).toMatchObject({ model: ['102', 0], lora_name: QWEN_HEAD });
    expect(graph['221'].inputs.destination).toEqual(['120', 0]);
    expect(graph['126'].inputs.image).toEqual(['221', 0]);
    expect(Object.values(graph).filter(node => node.class_type === 'ImageCompositeMasked')).toHaveLength(2);
    expect(imageFilesForSettings(job.image!.settings)).toContain('loras/' + QWEN_HEAD);
    expect(imageFilesForSettings(job.image!.settings).some(file => /body_swap|turbo_lora|model_patches/.test(file))).toBe(false);
  });
  it('keeps identity, outfit and lighting adapters on independent native branches', () => {
    const job = fixture(); job.image!.version = 'identity-first-v1';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'identity-first', qwenHeadRefine: true, qwenRelight: true };
    job.uploads!.faceMask = 'mask.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['206'].inputs).toMatchObject({ model: ['102', 0], lora_name: QWEN_HEAD });
    expect(graph['106'].inputs).toMatchObject({ model: ['102', 0], lora_name: QWEN_OUTFIT });
    expect(graph['306'].inputs).toMatchObject({ model: ['102', 0], lora_name: QWEN_CONSISTENCY });
    expect(graph['108'].inputs['images.image_1']).toEqual(['221', 0]);
    expect(graph['223'].inputs.source).toEqual(['220', 0]);
    expect(graph['308'].inputs['images.image_1']).toEqual(['223', 0]);
    expect(graph['308'].inputs['images.image_2']).toEqual(['1', 0]);
    expect(graph['126'].inputs.image).toEqual(['320', 0]);
    expect(imageFilesForSettings(job.image!.settings)).toContain('loras/' + QWEN_CONSISTENCY);
    job.image!.settings.qwenRelight = false;
    expect(compileWorkflow({}, job)['318']).toBeUndefined();
    expect(imageFilesForSettings(job.image!.settings)).not.toContain('loras/' + QWEN_CONSISTENCY);
  });
  it('keeps reference preparation and scene relighting separate from the body adapter', () => {
    const job = fixture(); job.image!.version = 'scene-anchor-v7';
    job.image!.settings = { ...imageDefaults, model: 'qwen21', qwenRecipe: 'source-anchored', qwenQuality: 'quality', qwenHeadRefine: false, structureStrength: .3, qwenNormalizeReference: true, qwenRelight: true, qwenLayoutOnly: true, localIdentity: true };
    job.uploads!.structure = 'target.png';
    const graph = compileWorkflow({}, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['502'].inputs.model).toEqual(['102', 0]);
    expect(graph['108'].inputs['images.image_2']).toEqual(['504', 0]);
    expect(graph['108'].inputs['images.image_3']).toBeUndefined();
    expect(graph['146'].inputs).toMatchObject({ image: ['141', 0], strength: .3, end_percent: .6 });
    expect(graph['146'].inputs.inpaint_image).toBeUndefined();
    expect(graph['146'].inputs.mask).toBeUndefined();
    expect(graph['306'].inputs.model).toEqual(['102', 0]);
    expect(graph['324'].inputs.images).toEqual(['320', 0]);
    expect(imageFilesForSettings(job.image!.settings)).toContain(QWEN_STRUCTURE);
    expect(imageFilesForSettings(job.image!.settings)).toContain('loras/' + QWEN_CONSISTENCY);
    expect(imageFilesForSettings(job.image!.settings)).not.toContain('loras/' + QWEN_HEAD);
    expect(imageFilesForSettings(job.image!.settings).some(file => file.includes('turbo'))).toBe(false);
  });
});
