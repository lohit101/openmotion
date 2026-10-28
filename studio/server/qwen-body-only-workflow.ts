import type { Graph, Job } from '../shared/types';
import { bodyOnlyConditioningPrompt } from '../shared/image-replacement';

/** Native three-reference editor. The body/outfit-transfer BFS LoRA is excluded. */
export function compileQwenBodyOnlyWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.source || !u.reference || !u.face || !u.original || !u.mask || !run.settings.protectBackground) throw new Error('Body-only replacement needs the target, body reference, face reference and painted edit area.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const prompt = run.version === 'body-only-v2' ? run.conditioningPrompt : bodyOnlyConditioningPrompt(s.prompt, true);
  if (!prompt?.trim()) throw new Error('The saved body-only conditioning prompt is missing. Reuse settings for a new image; this run will not change its instructions.');
  add('1', 'LoadImage', { image: u.source }, 'Target scene · original outfit, pose and camera');
  add('4', 'LoadImage', { image: u.reference }, 'Body reference · physique only, ignore its outfit');
  add('5', 'LoadImage', { image: u.face }, 'Facial identity reference · single view or sheet');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Qwen Image 2.1 INT8');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching image instruction encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching RGBA image VAE');
  if (s.qwenQuality === 'fast') add('105', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors', strength_model: 1 }, 'Official eight-step acceleration · evaluation');
  add('107', 'QwenImage21Cache', { model: s.qwenQuality === 'fast' ? ['105', 0] : ['102', 0], device: 'auto', dtype: 'default' }, 'Reuse the three-reference prefix');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], 'images.image_3': ['5', 0], vae: ['104', 0] }, 'Scene / body anatomy / facial identity · native multi-reference contract');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: s.qwenQuality === 'fast' ? 8 : 40, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Transfer identity and physique while retaining source garments');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the body-only edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Opaque photographic RGB');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Preserve raw edit for comparison');
  add('126', 'ImageCrop', { image: ['120', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove only canvas padding');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Return to original scene dimensions');
  add('128', 'LoadImage', { image: u.original }, 'Original scene pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Explicit edit permission');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Preserve unselected scenery and occluders');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Composite once inside the approved area');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save body-only replacement');
  return graph;
}
