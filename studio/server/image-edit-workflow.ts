import type { Graph, Job } from '../shared/types';
import { imageEditBfs, imageEditConsistency, imageEditEncoder, imageEditModel, imageEditSampling, imageEditSettingsSchema, imageEditTurbo, imageEditVae, imageEditVersion } from '../shared/image-edit';
import { legacyImageEditVersion } from '../shared/image-edit-legacy';
import { compileLegacyImageEditWorkflow } from './image-edit-2511-workflow';

/** Ordered, full-image editing. No automatic Imagen templates or face passes. */
export function compileImageEditWorkflow(job: Job): Graph {
  if (job.image?.version === legacyImageEditVersion) return compileLegacyImageEditWorkflow(job);
  const run = job.image, edit = run?.edit, uploads = job.uploads;
  if (run?.version !== imageEditVersion || !edit || !uploads || run.settings.model !== 'qwen21') throw new Error('The frozen Image Edit recipe is missing.');
  const s = imageEditSettingsSchema.parse(edit.settings), sampling = imageEditSampling(s);
  if (!s.prompt.trim() || edit.references.length < 1 || edit.references.length > 3) throw new Error('Image Edit needs a prompt and one to three ordered references.');
  const graph: Graph = {}, refs: Record<string, unknown> = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  edit.references.forEach((_, i) => {
    const input = uploads[(['source', 'reference', 'face'] as const)[i]];
    if (!input) throw new Error(`Image ${i + 1} has not been uploaded.`);
    add(String(i + 1), 'LoadImage', { image: input }, `Image ${i + 1} · frozen reference order`);
    refs[`images.image_${i + 1}`] = [String(i + 1), 0];
  });
  add('102', 'UNETLoader', { unet_name: imageEditModel, weight_dtype: 'default' }, 'Qwen Image 2.1 · INT8');
  add('103', 'CLIPLoader', { clip_name: imageEditEncoder, type: 'qwen_image', device: 'default' }, 'Matching Qwen3 VL instruction encoder');
  add('104', 'VAELoader', { vae_name: imageEditVae }, 'Matching Qwen Image 2.1 VAE');
  let model: [string, number] = ['102', 0];
  if (s.consistency) {
    add('105', 'LoraLoaderModelOnly', { model, lora_name: imageEditConsistency, strength_model: 1 }, 'Consistency step 1500 · preserve source framing'); model = ['105', 0];
  }
  if (s.quality === 'turbo') {
    add('106', 'LoraLoaderModelOnly', { model, lora_name: imageEditTurbo, strength_model: 1 }, 'Matching official eight-step Turbo adapter'); model = ['106', 0];
  }
  if (s.bfs) {
    add('111', 'LoraLoaderModelOnly', { model, lora_name: imageEditBfs, strength_model: 1 }, 'BFS V1.1 alternative · photorealistic head swap with stronger expression transfer'); model = ['111', 0];
  }
  add('107', 'QwenImage21Cache', { model, device: s.resolution === '2k' ? 'cpu' : 'auto', dtype: 'default' }, 'Lossless reference-prefix cache');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], vae: ['104', 0], prompt: s.prompt, negative_prompt: '', resolution: 0, ...refs }, 'Your exact prompt · sample on Image 1’s prepared native canvas');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: sampling.steps, cfg: sampling.cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Frozen Qwen Image 2.1 sampling');
  add('119', 'VAEDecodeTiled', { samples: ['118', 0], vae: ['104', 0], tile_size: 1024, overlap: 128, temporal_size: 64, temporal_overlap: 8 }, 'Bounded-memory native decode');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Explicit photographic RGB from the RGBA VAE');
  add('46', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Immutable native PNG result');
  return graph;
}
