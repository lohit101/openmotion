import type { Asset, Catalog, Graph, Job } from '../shared/types';
import { nextSegment } from '../shared/types';
export const RELIGHT = 'wan2.1_SCAIL_2_relight_lora_bf16.safetensors';

export function compileWorkflow(template: Graph, job: Job): Graph {
  if (!job.uploads) throw new Error('Inputs have not been transferred.');
  const graph = structuredClone(template), s = job.settings;
  const plan = nextSegment(job.progress.completedFrames, job.progress.targetFrames, s.framesPerPass);
  Object.assign(graph['1'].inputs, { width: job.width, height: job.height, fps: s.fps, frame_cap: plan.cap, skip_frames: plan.skip,
    seed: s.seed, dpo_strength: s.dpoStrength, preset: s.preset === 'fast' ? 'fast_6_steps' : 'undistilled_40_steps' });
  graph['2'].inputs.video = job.uploads.source; graph['4'].inputs.image = job.uploads.reference;
  graph['7'].inputs.text = s.sourcePerson; graph['8'].inputs.text = s.referencePerson;
  graph['11'].inputs.object_indices = s.objectIndices; graph['11'].inputs.replacement_mode = s.mode === 'swap';
  graph['40'].inputs.replacement_mode = s.mode === 'swap'; graph['31'].inputs.text = s.prompt; graph['32'].inputs.text = s.negativePrompt;
  graph['36'].inputs.context_path = job.context;
  graph['50'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['21', 0], lora_name: RELIGHT, strength_model: s.relight && s.mode === 'swap' ? s.relightStrength : 0 }, _meta: { title: 'SCAIL-2 relighting' } };
  // Omit the loader entirely when disabled so a base-only installation does not require this optional file.
  graph['22'].inputs.model = s.relight && s.mode === 'swap' ? ['50', 0] : ['21', 0];
  if (!(s.relight && s.mode === 'swap')) delete graph['50'];
  Object.assign(graph['22'].inputs, { lora_name: s.loraA, strength_model: s.loraAStrength });
  Object.assign(graph['23'].inputs, { lora_name: s.loraB, strength_model: s.loraBStrength });
  if (s.preset === 'quality') { graph['42'].inputs.steps = 20; graph['43'].inputs.cfg = 5; graph['24'].inputs.strength_model = 0; graph['25'].inputs.shift = 3; graph['41'].inputs.sampler_name = 'uni_pc'; }
  graph['46'].inputs.filename_prefix = `recast/${job.id}/segment_${String(job.segments.length).padStart(4, '0')}`;
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
