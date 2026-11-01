import { compileQwenBodyWorkflow } from './qwen-body-workflow';
import type { Graph, Job } from '../shared/types';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { compileQwenSceneWorkflow } from './qwen-scene-workflow';
import { compileQwenNativeWorkflow } from './qwen-native-workflow';
import { compileQwenIdentityWorkflow } from './qwen-identity-workflow';
import { compileQwenBodyOnlyWorkflow } from './qwen-body-only-workflow';
import { compileQwenClothingWorkflow } from './qwen-clothing-workflow';

/** Trained whole-person adapter, using its scene-first/person-second contract. */
export function compileQwenImageWorkflow(job: Job): Graph {
  if (!job.image || !job.uploads) throw new Error('Qwen image inputs have not been prepared.');
  if (job.image.version === 'clothing-only-v1') return compileQwenClothingWorkflow(job);
  if (job.image.version?.startsWith('body-only-')) return compileQwenBodyOnlyWorkflow(job);
  if (['body-identity-v1', 'body-identity-v2'].includes(job.image.version || '')) return compileQwenBodyWorkflow(job);
  if (['identity-first-v1', 'identity-first-v2'].includes(job.image.version || '')) return compileQwenIdentityWorkflow(job);
  if (['native-mask-v1', 'native-scene-v1'].includes(job.image.version || '')) return compileQwenNativeWorkflow(job);
  if (job.image.version?.startsWith('scene-anchor-')) return compileQwenSceneWorkflow(job);
  const { settings: s, geometry: g } = job.image, graph: Graph = {};
  if (s.protectBackground && (!job.uploads.mask || !job.uploads.original)) throw new Error('Paint the replacement area first.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const extra = s.prompt.trim();
  const prompt = 'body_swap: start with <image1> as the base image, keeping its lighting, environment and background. Replace its entire person with the person from <image2>, preserving <image2> facial identity, hair, complete clothing, accessories, body shape and proportions. Match <image1> exact pose, head rotation, gaze, expression, apparent head size, camera distance, framing and screen position. Fit the replacement outfit to that pose and illuminate the person with <image1> light direction, exposure, color temperature and contact shadows.'
    + (extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' Additional edit requirements: ' + extra : '');
  add('1', 'LoadImage', { image: job.uploads.source }, 'Image one · base scene, camera and pose');
  add('4', 'LoadImage', { image: job.uploads.reference }, 'Image two · entire replacement person and outfit');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Qwen Image 2.1 INT8');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching Qwen 2.1 visual text encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching Qwen image VAE');
  add('105', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors', strength_model: 1 }, 'Matching official eight-step acceleration');
  add('106', 'LoraLoaderModelOnly', { model: ['105', 0], lora_name: 'bfs_body_swap_v1.0_qwen_2.1.safetensors', strength_model: 1 }, 'Trained whole-person swap, not a general style adapter');
  add('107', 'QwenImage21Cache', { model: ['106', 0], device: 'auto', dtype: 'default' }, 'Reuse reference prefix without lossy cache quantization');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], vae: ['104', 0] }, 'Scene first, replacement person second; keep the scene-sized native latent');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Replace the complete person · eight steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the Qwen replacement');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Use RGB explicitly from the RGBA decoder');
  add('126', 'ImageCrop', { image: ['120', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove only grid padding');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore the exact base photograph dimensions');
  let result: [string, number] = ['127', 0];
  if (s.protectBackground) {
    add('128', 'LoadImage', { image: job.uploads.original }, 'Keep original scene pixels');
    add('129', 'LoadImage', { image: job.uploads.mask }, 'Target-bound replacement area');
    add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'White edits, black preserves');
    add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: result, x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Protect the original outside the edit area');
    result = ['131', 0];
  }
  add('46', 'SaveImage', { images: result, filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one lossless whole-person replacement');
  return graph;
}
