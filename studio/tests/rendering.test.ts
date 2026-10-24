import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWorkflow, I2V_SPEED, NATURAL_SPEED, validateGraph } from '../server/workflow';
import { defaults } from '../shared/types';
import type { Catalog, Graph, Job } from '../shared/types';

const repo = path.resolve(import.meta.dirname, '../..');
const template: Graph = JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
const catalog: Catalog = JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));

function fixture(): Job {
  return { id: 'rendering-test', title: 'Rendering regression', status: 'queued', settings: { ...defaults, preset: 'fast' }, sourceId: 'source', referenceId: 'reference',
    createdAt: new Date().toISOString(), favorite: false, deleted: false, width: 704, height: 1248,
    progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 36, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: { source: 'source.mp4', reference: 'reference.png' }, error: null, output: null, poster: null,
    cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}

describe('versioned temporal rendering', () => {
  it('uses native whole-shot decoding only for new rendering-version jobs', () => {
    const old = fixture(), legacy = compileWorkflow(template, old);
    expect(legacy['44'].class_type).toBe('VAEDecodeTiled');
    expect(legacy['44'].inputs).toMatchObject({ temporal_size: 32, temporal_overlap: 8, tile_size: 512, overlap: 128 });
    const originalTemplate = structuredClone(template);
    const current = compileWorkflow(template, { ...old, renderVersion: 'continuous-v1' });
    expect(current['44'].class_type).toBe('VAEDecode');
    expect(current['44'].inputs).toEqual({ samples: ['43', 0], vae: ['35', 0] });
    expect(template).toEqual(originalTemplate);
    const nativeTemplate = structuredClone(template); nativeTemplate['44'] = current['44'];
    expect(compileWorkflow(nativeTemplate, old)['44']).toEqual(legacy['44']);
    expect(current['45'].inputs.images).toEqual(['44', 0]);
    expect(current['42'].inputs.model).toEqual(current['43'].inputs.model);
    expect(current['43'].inputs.model).toEqual(['25', 0]);
  });

  it('retains the existing fast and quality sampler contracts', () => {
    const job = fixture(), fast = compileWorkflow(template, job);
    expect(fast['1'].inputs.preset).toBe('fast_6_steps');
    expect(fast['42'].inputs.steps).toEqual(['1', 5]);
    expect(fast['43'].inputs.cfg).toEqual(['1', 6]);
    expect(fast['24'].inputs.strength_model).toEqual(['1', 7]);
    expect(fast['24'].inputs.lora_name).toBe(I2V_SPEED);
    expect(fast['25'].inputs.shift).toBe(5); expect(fast['41'].inputs.sampler_name).toBe('euler');
    job.settings.preset = 'quality'; const quality = compileWorkflow(template, job);
    expect(quality['1'].inputs.preset).toBe('undistilled_40_steps');
    expect(quality['42'].inputs.steps).toBe(20); expect(quality['43'].inputs.cfg).toBe(5);
    expect(quality['24'].inputs.strength_model).toBe(0);
    expect(quality['25'].inputs.shift).toBe(3); expect(quality['41'].inputs.sampler_name).toBe('uni_pc');
  });

  it('uses the dedicated eight-step natural swap adapter without changing shared conditioning or identity controls', () => {
    const job = fixture(); job.settings.preset = 'natural'; job.renderVersion = 'continuous-v1';
    const graph = compileWorkflow(template, job);
    expect(graph['1'].inputs.preset).toBe('fast_6_steps');
    expect(graph['42'].inputs.steps).toBe(8); expect(graph['43'].inputs.cfg).toBe(1);
    expect(graph['24'].inputs).toMatchObject({ model: ['23', 0], lora_name: NATURAL_SPEED, strength_model: 0.8 });
    expect(graph['25'].inputs.shift).toBe(5); expect(graph['41'].inputs.sampler_name).toBe('euler');
    expect(graph['42'].inputs.model).toEqual(['25', 0]); expect(graph['43'].inputs.model).toEqual(['25', 0]);
    expect(graph['40'].inputs).toEqual(template['40'].inputs);
    expect(graph['11'].inputs.replacement_mode).toBe(true);
    expect(graph['21'].inputs).toEqual(template['21'].inputs);
    expect(graph['22'].inputs.model).toEqual(['50', 0]);
    expect(graph['50'].inputs.strength_model).toBe(1);
  });

  it('keeps motion mode on its existing I2V adapter and disables replacement-only relighting', () => {
    const job = fixture(); job.settings = { ...job.settings, mode: 'motion', preset: 'natural' };
    const graph = compileWorkflow(template, job);
    expect(graph['24'].inputs.lora_name).toBe(I2V_SPEED); expect(graph['24'].inputs.strength_model).toBe(0.8);
    expect(graph['42'].inputs.steps).toBe(8); expect(graph['43'].inputs.cfg).toBe(1);
    expect(graph['11'].inputs.replacement_mode).toBe(false); expect(graph['40'].inputs.replacement_mode).toBe(false);
    expect(graph['50']).toBeUndefined(); expect(graph['22'].inputs.model).toEqual(['21', 0]);
  });

  it('captures the already-sampled latent only on explicit diagnostic requests', () => {
    const job = fixture();
    expect(compileWorkflow(template, job)['51']).toBeUndefined();
    job.saveDiagnosticLatent = true;
    const graph = compileWorkflow(template, job);
    expect(graph['51']).toEqual({ class_type: 'SaveLatent', inputs: { samples: ['43', 0], filename_prefix: 'recast/rendering-test/segment_0000_samples' }, _meta: { title: 'Retain sampled latent for decoder comparisons' } });
    expect(Object.values(graph).filter(node => node.class_type === 'SamplerCustom')).toHaveLength(1);
    expect(graph['44'].inputs.samples).toEqual(graph['51'].inputs.samples);
    const templateWithCapture = structuredClone(template); templateWithCapture['51'] = graph['51'];
    job.saveDiagnosticLatent = false;
    expect(compileWorkflow(templateWithCapture, job)['51']).toBeUndefined();
  });

  it('validates native decoder, adapter selection and latent output against the captured ComfyUI schemas', () => {
    const local = structuredClone(catalog);
    for (const [kind, field, filename] of [['LoadImage', 'image', 'reference.png'], ['VHS_LoadVideo', 'video', 'source.mp4'], ['LoraLoaderModelOnly', 'lora_name', NATURAL_SPEED]]) {
      const choices = local[kind].input.required![field][0];
      if (Array.isArray(choices) && !choices.includes(filename)) choices.push(filename);
    }
    const job = fixture(); job.settings.preset = 'natural'; job.renderVersion = 'continuous-v1'; job.saveDiagnosticLatent = true;
    expect(validateGraph(compileWorkflow(template, job), local)).toEqual([]);
  });
});
