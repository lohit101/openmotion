import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaults, nextSegment, settingsSchema, type Catalog, type Graph, type Job } from '../shared/types';
import { engineIssue, isViggle, planForJob, repaintPrompt, vigglePasses } from '../shared/engines';
import { modelBytes, modelFilesForSettings, pinnedModels } from '../shared/models';
import { compileWorkflow, validateGraph } from '../server/workflow';
import { compileViggleWorkflow, VIGGLE_DMD, VIGGLE_MODEL, VIGGLE_VAE } from '../server/viggle-workflow';
import { applyProgress } from '../server/comfy';
import { publicJob } from '../server/store';

const repo = path.resolve(import.meta.dirname, '../..');
const load = (name: string) => JSON.parse(readFileSync(path.join(repo, name), 'utf8'));
const scail: Graph = load('workflows/api/scail2_int8_swap.json');
const catalog: Catalog = { ...load('integration-snapshot/object-info.json'), ...load('integration-snapshot/viggle-node-schemas.json') };
// These enums stand for installed files. The supplemental node schemas come
// from pinned source, not from an executed GPU; this test makes no speed claim.
for (const schema of Object.values(catalog)) for (const [name, rule] of Object.entries({ ...schema.input.required, ...schema.input.optional })) {
  if (['image', 'video'].includes(name) && Array.isArray(rule[0])) rule[0] = ['source.mp4', 'character.png'];
  if (['unet_name', 'vae_name', 'clip_name', 'lora_name', 'text_cond'].includes(name) && Array.isArray(rule[0])) rule[0] = [...rule[0], ...pinnedModels.map(f => f.destination.split('/').at(-1))];
}
function fixture(): Job {
  return { id: 'viggle-test', title: 'Viggle regression', status: 'queued', settings: { ...defaults, engine: 'viggle', seconds: 5 }, sourceId: 'source', referenceId: 'reference', createdAt: '', favorite: false, deleted: false, width: 480, height: 864,
    progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 120, updatedAt: 0 }, segments: [], context: '', pendingPrompt: null, uploads: { source: 'source.mp4', reference: 'character.png' }, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}

describe('Viggle source-aligned two-stage replacement', () => {
  it('keeps legacy jobs and missing engine fields on SCAIL without mutating settings', () => {
    expect(settingsSchema.parse({}).engine).toBe('scail2');
    expect(isViggle({ engine: undefined } as any)).toBe(false);
    const job = fixture(); delete (job.settings as any).engine;
    expect(compileWorkflow(scail, job)['40'].class_type).toBe('WanSCAILToVideo');
  });
  it('downloads only the exact selected engine and skips the image stack for a prepared reference', () => {
    const job = fixture(), files = modelFilesForSettings(job.settings);
    expect(files).toHaveLength(7); expect(modelBytes(files)).toBe(40_428_343_196);
    expect(files.some(name => /scail|umt5|sam3|clip_vision|lightx2v|Instagoon/i.test(name))).toBe(false);
    const prepared = modelFilesForSettings({ ...job.settings, referencePreparation: 'prepared' });
    expect(prepared).toHaveLength(4); expect(modelBytes(prepared)).toBe(27_976_525_336);
    expect(prepared).toContain('loras/' + VIGGLE_DMD);
    expect(modelFilesForSettings(defaults).some(name => /viggle|flux|qwen_3/.test(name))).toBe(false);
  });
  it('uses source-first and appearance-second image references, then the edited source frame in video conditioning', () => {
    const job = fixture(), graph = compileWorkflow(scail, job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['100'].inputs.image).toEqual(['3', 2]);
    expect(graph['109'].inputs.latent).toEqual(['107', 0]);
    expect(graph['111'].inputs).toEqual({ conditioning: ['109', 0], latent: ['108', 0] });
    expect(graph['40'].inputs.ref_image).toEqual(['121', 0]);
    expect(graph['121'].inputs.images).toEqual(['120', 0]);
    expect(graph['40'].inputs.cond_video).toEqual(['3', 0]);
    expect(graph['45'].inputs.source_count).toEqual(['3', 1]);
    expect(graph['46'].inputs.frame_rate).toBe(24);
    expect(graph['115'].inputs.steps).toBe(4); expect(graph['113'].inputs.cfg).toBe(1);
  });
  it('uses the correct three-forward-pass DMD recipe without classifier-free guidance or an extra sigma shift', () => {
    const graph = compileViggleWorkflow(fixture());
    expect(graph['20'].inputs.unet_name).toBe(VIGGLE_MODEL);
    expect(graph['35'].inputs.vae_name).toBe(VIGGLE_VAE);
    expect(graph['24'].inputs).toMatchObject({ lora_name: VIGGLE_DMD, strength_model: 1 });
    expect(graph['25'].inputs).toMatchObject({ shift_video: 3, shift_audio: 3 });
    expect(graph['31'].class_type).toBe('BasicGuider'); expect(graph['41'].inputs.sampler_name).toBe('euler');
    const sigmas = String(graph['42'].inputs.sigmas).split(',').map(Number);
    expect(sigmas).toEqual([1, 0.8571428571428571, 0.6, 0]); expect(sigmas.length - 1).toBe(3);
    expect(sigmas.every(Number.isFinite)).toBe(true);
    expect(Object.values(graph).filter(n => /SigmaShift/.test(n.class_type))).toHaveLength(1);
    expect(Object.values(graph).some(n => /SAM3|SCAIL|CLIPVision|SwapOptionalLoRA/.test(n.class_type))).toBe(false);
  });
  it('retains native 24 fps and one full shot instead of silently reverting to two SCAIL chunks', () => {
    const job = fixture(); expect(planForJob(job.settings, 0, 120, nextSegment)).toEqual({ skip: 0, cap: 120, overlap: 0 });
    expect(() => planForJob(job.settings, 81, 120, nextSegment)).toThrow('cannot continue');
    expect(planForJob(defaults, 81, 120, nextSegment)).toEqual(nextSegment(81, 120, 81));
    for (const changes of [{ fps: 16 as const }, { seconds: 31 }, { mode: 'motion' as const }, { orientation: 'portrait' as const }, { loraA: 'wan-adapter.safetensors' }]) expect(engineIssue({ ...job.settings, ...changes })).toBeTruthy();
    expect(engineIssue({ ...job.settings, seconds: 5.16 })).toBeNull();
    job.progress.completedFrames = 81; expect(() => compileViggleWorkflow(job)).toThrow('fresh single shot');
  });
  it('prepared-frame mode has no unused image models, image sampler or prompt encoder', () => {
    const job = fixture(); job.settings.referencePreparation = 'prepared';
    const graph = compileViggleWorkflow(job);
    expect(validateGraph(graph, catalog)).toEqual([]);
    expect(graph['40'].inputs.ref_image).toEqual(['121', 0]); expect(graph['121'].inputs.images).toEqual(['4', 0]);
    expect(graph['102']).toBeUndefined(); expect(graph['118']).toBeUndefined(); expect(graph['103']).toBeUndefined();
    expect(graph['46'].inputs.filename_prefix).toBe('recast/viggle-test/segment_0000');
  });
  it('keeps the true image and video progress counters and derives stage names from the submitted graph', () => {
    const job = fixture(); job.workflow = compileViggleWorkflow(job); job.pendingPrompt = 'paid-prompt';
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'other', node: '118', value: 2, max: 4 } })).toBe(false);
    expect(applyProgress(job, { type: 'progress', data: { prompt_id: 'paid-prompt', node: '118', value: 2, max: 4 } })).toBe(true);
    expect(job.progress).toMatchObject({ stage: 'Repaint the source frame in four steps', value: 2, max: 4, unit: 'steps' });
    applyProgress(job, { type: 'progress', data: { prompt_id: 'paid-prompt', node: '43', value: 1, max: 3 } });
    expect(job.progress).toMatchObject({ value: 1, max: 3, unit: 'steps' });
  });
  it('keeps balanced sampling explicit and does not claim that additional passes are guaranteed better', () => {
    const job = fixture(); job.settings.viggleQuality = 'balanced';
    expect(vigglePasses(job.settings)).toBe(5);
    const sigmas = String(compileViggleWorkflow(job)['42'].inputs.sigmas).split(',').map(Number);
    expect(sigmas).toHaveLength(6); expect(sigmas.at(-1)).toBe(0); expect(sigmas.filter(v => v === 0)).toHaveLength(1);
  });
  it('saves a reproducible preparation prompt and hides local keyframe paths from browser JSON', () => {
    const job = fixture(); job.settings.prompt = '';
    expect(repaintPrompt(job.settings)).toContain('Edit image 1'); expect(repaintPrompt(job.settings)).toContain('camera distance');
    expect(repaintPrompt(job.settings)).toContain('image 2');
    job.keyframe = '/private/job/keyframe.png'; expect(publicJob(job).keyframe).toBe('ready');
    job.saveDiagnosticLatent = true; expect(() => compileViggleWorkflow(job)).toThrow('diagnostics');
  });
});
