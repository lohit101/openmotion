import type { Asset, Catalog, Graph, Job } from '../shared/types';
import { nextSegment } from '../shared/types';
import { samplingSteps, usesSpeedAdapter } from '../shared/sampling';
import { renderPrompt } from '../shared/prompts';
import { RELIGHT, NATURAL_SPEED, I2V_SPEED } from '../shared/models';
import { isViggle } from '../shared/engines';
import { compileViggleWorkflow } from './viggle-workflow';
import { compileImageWorkflow } from './image-workflow';
import { isImageJob } from '../shared/image-replacement';
export { RELIGHT, NATURAL_SPEED, I2V_SPEED };

export function compileWorkflow(template: Graph, job: Job): Graph {
  if (isImageJob(job)) return compileImageWorkflow(job);
  if (isViggle(job.settings)) return compileViggleWorkflow(job);
  if (!job.uploads) throw new Error('Inputs have not been transferred.');
  const graph = structuredClone(template), s = job.settings;
  const plan = nextSegment(job.progress.completedFrames, job.progress.targetFrames, s.framesPerPass);
  Object.assign(graph['1'].inputs, { width: job.width, height: job.height, fps: s.fps, frame_cap: plan.cap, skip_frames: plan.skip,
    seed: s.seed, dpo_strength: s.dpoStrength, preset: usesSpeedAdapter(s.preset) ? 'fast_6_steps' : 'undistilled_40_steps' });
  graph['2'].inputs.video = job.uploads.source; graph['4'].inputs.image = job.uploads.reference;
  graph['7'].inputs.text = s.sourcePerson; graph['8'].inputs.text = s.referencePerson;
  graph['11'].inputs.object_indices = s.objectIndices; graph['11'].inputs.replacement_mode = s.mode === 'swap';
  graph['40'].inputs.replacement_mode = s.mode === 'swap'; graph['31'].inputs.text = renderPrompt(s, job.promptVersion); graph['32'].inputs.text = s.negativePrompt;
  graph['36'].inputs.context_path = job.context;
  const detailModel = s.dpoStrength > 0 ? ['21', 0] : ['20', 0];
  if (s.dpoStrength === 0) delete graph['21'];
  graph['50'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['21', 0], lora_name: RELIGHT, strength_model: s.relight && s.mode === 'swap' ? s.relightStrength : 0 }, _meta: { title: 'SCAIL-2 relighting' } };
  graph['50'].inputs.model = detailModel;
  // Omit the loader entirely when disabled so a base-only installation does not require this optional file.
  const relighting = s.relight && s.mode === 'swap' && s.relightStrength > 0;
  graph['22'].inputs.model = relighting ? ['50', 0] : detailModel;
  if (!relighting) delete graph['50'];
  Object.assign(graph['22'].inputs, { lora_name: s.loraA, strength_model: s.loraAStrength });
  Object.assign(graph['23'].inputs, { lora_name: s.loraB, strength_model: s.loraBStrength });
  if (!usesSpeedAdapter(s.preset)) { graph['42'].inputs.steps = samplingSteps(s.preset); graph['43'].inputs.cfg = 5; graph['25'].inputs.shift = 3; graph['41'].inputs.sampler_name = 'uni_pc'; }
  if (s.preset === 'natural') {
    graph['42'].inputs.steps = 8; graph['43'].inputs.cfg = 1;
    graph['24'].inputs.lora_name = s.mode === 'swap' ? NATURAL_SPEED : I2V_SPEED;
    graph['24'].inputs.strength_model = 0.8;
    graph['25'].inputs.shift = 5; graph['41'].inputs.sampler_name = 'euler';
  }
  // Even a zero-strength native loader validates its filename. Remove the
  // inactive speed node so Quality needs neither acceleration download.
  if (!usesSpeedAdapter(s.preset)) { graph['25'].inputs.model = ['23', 0]; delete graph['24']; }
  if (job.renderVersion === 'continuous-v1') {
    // Native decode shares temporal/spatial context for the whole shot. The VAE
    // owns its memory handling and automatic fallback rather than this graph
    // forcing independent 32-frame / 512-pixel decoding windows.
    graph['44'] = { class_type: 'VAEDecode', inputs: { samples: graph['44'].inputs.samples, vae: graph['44'].inputs.vae }, _meta: { title: 'Decode the complete shot with shared context' } };
  } else {
    // Keep old continuation jobs on their original decoder even when the
    // current standalone template has moved to native whole-shot decoding.
    graph['44'] = { class_type: 'VAEDecodeTiled', inputs: { samples: graph['44'].inputs.samples, vae: graph['44'].inputs.vae, tile_size: 512, overlap: 128, temporal_size: 32, temporal_overlap: 8 }, _meta: { title: 'Decode with bounded video tiles' } };
  }
  const prefix = `recast/${job.id}/segment_${String(job.segments.length).padStart(4, '0')}`;
  graph['46'].inputs.filename_prefix = prefix;
  if (job.outputSize) {
    graph['52'] = { class_type: 'ImageScale', inputs: { image: ['45', 0], upscale_method: 'lanczos', width: job.outputSize.width, height: job.outputSize.height, crop: 'disabled' }, _meta: { title: 'Export HD dimensions without cropping the shot' } };
    graph['46'].inputs.images = ['52', 0];
  } else delete graph['52'];
  if (job.saveDiagnosticLatent) graph['51'] = { class_type: 'SaveLatent', inputs: { samples: ['43', 0], filename_prefix: prefix + '_samples' }, _meta: { title: 'Retain sampled latent for decoder comparisons' } };
  else delete graph['51'];
  return graph;
}
export function validateGraph(graph: Graph, catalog: Catalog) {
  const issues: string[] = [];
  for (const [id, node] of Object.entries(graph)) {
    const schema = catalog[node.class_type]; if (!schema) { issues.push(`Missing ComfyUI node: ${node.class_type}. Run the pinned setup.`); continue; }
    const fields = { ...schema.input.required, ...schema.input.optional };
    for (const [name, value] of Object.entries(node.inputs)) {
      const rule = fields[name]; if (!rule) { if (node.class_type !== 'VHS_VideoCombine') issues.push(`Unsupported input ${id}.${name}.`); continue; }
      const linked = Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
      if (linked) { const parent = graph[value[0] as string]; if (!parent || !catalog[parent.class_type]?.output[value[1] as number]) issues.push(`Broken workflow connection at ${id}.${name}.`); }
      else if (Array.isArray(rule[0]) && !(rule[0] as unknown[]).includes(value)) issues.push(`Unavailable ${name}: ${String(value)}.`);
    }
  }
  return issues;
}
export function validateSelection(source: Asset, reference: Asset, start: number, seconds: number, fps: number) {
  if (source.kind !== 'video' || reference.kind !== 'image') throw new Error('Choose one source video and one character image.');
  if (seconds * fps < 5) throw new Error('Choose a clip of at least five frames.');
  if (start >= source.duration || start + seconds > source.duration + 1 / fps) throw new Error(`The selected range exceeds the ${source.duration.toFixed(2)} second source video.`);
}
