import type { Graph, Job } from '../shared/types';

/** Image one retains identity/anatomy; image two supplies garments only. */
export function compileQwenClothingWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (run?.version !== 'clothing-only-v1' || run.settings.model !== 'qwen21' || !run.settings.protectBackground || !u?.source || !u.reference || !u.original || !u.mask) throw new Error('Clothing replacement needs a target, outfit reference and painted garment area.');
  if (!run.conditioningPrompt?.trim()) throw new Error('The frozen clothing instructions are missing. Create a new image instead of changing this run.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  add('1', 'LoadImage', { image: u.source }, 'Target person · identity, physique, pose and scene');
  add('4', 'LoadImage', { image: u.reference }, 'Outfit reference · clothing only');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Qwen Image 2.1 INT8');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching image instruction encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching image VAE');
  if (s.qwenQuality === 'fast') add('105', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors', strength_model: 1 }, 'Official eight-step acceleration');
  add('107', 'QwenImage21Cache', { model: s.qwenQuality === 'fast' ? ['105', 0] : ['102', 0], device: 'auto', dtype: 'default' }, 'Reuse target and garment reference conditioning');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: run.conditioningPrompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], vae: ['104', 0] }, 'Keep the target person; transfer only the reference costume');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: s.qwenQuality === 'fast' ? 8 : 40, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Edit clothing without an identity or body-swap adapter');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the clothing edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Opaque photographic RGB');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/clothing_raw` }, 'Preserve the raw clothing edit for review');
  add('126', 'ImageCrop', { image: ['120', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove model-grid padding');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Retain target framing and dimensions');
  add('128', 'LoadImage', { image: u.original }, 'Original target pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Target-bound garment permission');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Painted areas may change; other pixels stay original');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Preserve unpainted face, hair, skin and scene');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one clothing replacement for Imagen or Remotion');
  return graph;
}
