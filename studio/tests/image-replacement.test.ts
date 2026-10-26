import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaults, type Catalog, type Job } from '../shared/types';
import { defaultImagePrompt, emptyImageDraft, imageDefaults, imageGeometry, imagePrompt, isImageJob } from '../shared/image-replacement';
import { imageModelFiles, modelBytes, pinnedModels } from '../shared/models';
import { compileWorkflow, validateGraph } from '../server/workflow';
import { applyProgress } from '../server/comfy';
import { publicJob } from '../server/store';

const repo = path.resolve(import.meta.dirname, '../..');
const load = (file: string) => JSON.parse(readFileSync(path.join(repo, file), 'utf8'));
const catalog: Catalog = { ...load('integration-snapshot/object-info.json'), ...load('integration-snapshot/viggle-node-schemas.json') };
for (const node of Object.values(catalog)) for (const [name, rule] of Object.entries({ ...node.input.required, ...node.input.optional })) {
  if (name === 'image') rule[0] = ['target.png', 'identity.png', 'face.png', 'original.png', 'mask.png'];
  if (['unet_name', 'vae_name', 'clip_name'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(f => f.destination.split('/').at(-1))];
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
    expect(imagePrompt({ ...imageDefaults, prompt: '' }, false)).toContain(defaultImagePrompt);
    expect(imagePrompt(imageDefaults, true)).toContain('IMAGE 3');
    expect(imagePrompt(imageDefaults, false)).not.toContain('IMAGE 3');
  });
  it('reports true four-step image progress and keeps input upload paths private', () => {
    const job = fixture(); job.workflow = compileWorkflow({}, job); job.pendingPrompt = 'paid-image';
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'other', node: '118', value: 2, max: 4 } })).toBe(false);
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'paid-image', node: '118', value: 2, max: 4 } })).toBe(true);
    expect(job.progress).toMatchObject({ value: 2, max: 4, unit: 'steps', stage: 'Replace the character in four image steps' });
    expect(publicJob(job).uploads).toBeNull(); expect(publicJob(job).image?.settings).toEqual(job.image!.settings);
  });
});
