import type { Graph, Job } from '../shared/types';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { QWEN_BODY, QWEN_HEAD, QWEN_CONSISTENCY } from '../shared/models';

/** Body anatomy first; the accepted head sampler remains an independent branch. */
export function compileQwenBodyWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.noiseMask || !u.mask || !u.original || !run.settings.protectBackground) throw new Error('Whole-character editing requires a target-aligned painted edit area.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  if (s.qwenNormalizeReference && !u.bodyReference) throw new Error('The body reference preparation canvas is missing. Nothing was submitted.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const extra = s.prompt.trim(), custom = extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' Additional requirements: ' + extra : '';
  add('1', 'LoadImage', { image: u.source }, 'Source pose, camera and illumination · locally anchored face');
  add('4', 'LoadImage', { image: u.reference }, 'Original identity and physique reference');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared native Qwen Image 2.1');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching Qwen vision encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching RGBA VAE');
  add('142', 'LoadImage', { image: u.noiseMask }, 'Person edit allowance');
  add('143', 'ImageToMask', { image: ['142', 0], channel: 'red' }, 'Protect the original scene outside the person');
  let reference: [string, number] = ['4', 0];
  if (s.qwenNormalizeReference) {
    add('500', 'LoadImage', { image: u.bodyReference }, 'Original reference on an undistorted square canvas');
    add('501', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Create a full-body studio reference photograph of the exact person in <image1>. Standing upright, front view, camera level at chest height, arms relaxed at the sides, neutral expression. Plain seamless light-gray background and soft even neutral studio lighting. The person fills almost the full height of the square frame, from head to shoes, with a small even margin. Strictly preserve the visible physical build: shoulder breadth, upper-arm thickness, ribcage width, chest size, torso taper and body proportions from <image1>. Preserve their facial identity, hair, skin tone, outfit fabric, neckline and garment details. Do not exaggerate curves, enlarge the chest, add muscle or idealize the body. Remove photographic watermarks and background objects without changing physical markings. Where the input is cropped, extend the outfit simply and plausibly; do not alter the visible upper-body anatomy. Natural photographic detail.', negative_prompt: '', resolution: 0, 'images.image_1': ['500', 0], vae: ['104', 0] }, 'Canonical body reference · independent of facial authority');
    add('502', 'KSampler', { model: ['102', 0], positive: ['501', 0], negative: ['501', 1], latent_image: ['501', 2], seed: s.seed + 1000, steps: 30, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Prepare body proportions · 30 steps');
    add('503', 'VAEDecode', { samples: ['502', 0], vae: ['104', 0] }, 'Decode the body reference');
    add('504', 'SplitImageWithAlpha', { image: ['503', 0] }, 'RGB body reference');
    add('505', 'SaveImage', { images: ['504', 0], filename_prefix: `recast/${job.id}/reference_normalized` }, 'Retain the prepared reference for anatomy review');
    add('506', 'ImageScaleToTotalPixels', { image: ['504', 0], upscale_method: 'lanczos', megapixels: .59, resolution_steps: 32 }, 'Keep the body reference below the scene token budget');
    reference = ['506', 0];
  }
  add('106', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_BODY, strength_model: 1 }, 'Stage one · reference body proportions and clothing');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'body_swap: start with <image1> as the base photograph, keeping its lighting, environment and background. Replace the whole person with the person from <image2>, strictly preserving the clothing, body shape and proportions from <image2>. Use the reference shoulder breadth, upper-arm thickness, chest size, torso taper and physical build. The source supplies pose and camera placement only; replace its anatomy and outfit completely. Copy the pose, direction of the eyes, head rotation and expression from <image1>. Keep its apparent head size, head-center position, camera distance, lens perspective, shoulder height, arm directions, framing and crop. The reference supplies physique, not its standing pose or photographic lighting. Fit the reference anatomy and outfit to the captured perspective. Do not enlarge, exaggerate or idealize body proportions. Preserve all visible garment details and physical markings.' + custom, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': reference, vae: ['104', 0] }, 'Source pose first · reference anatomy second');
  add('118', 'KSampler', { model: ['106', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Transfer body proportions and outfit · 20 steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the body transfer');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'RGB transferred body');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Retain anatomy before head refinement');
  add('153', 'ImageCompositeMasked', { destination: ['1', 0], source: ['120', 0], x: 0, y: 0, resize_source: false, mask: ['143', 0] }, 'Condition the head pass on the transferred body in the scene');
  add('154', 'SaveImage', { images: ['153', 0], filename_prefix: `recast/${job.id}/body_stage` }, 'Retain body placement before the head stage');
  add('206', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_HEAD, strength_model: 1 }, 'Stage two · accepted full head and hair adapter');
  add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'head_swap: edit <image1>. Replace the entire head, face and hairstyle with the head from <image2>, preserving the reference facial identity, facial proportions, hairline, hair color, parting, hair length and texture. Remove the original hairstyle completely. Copy head rotation, gaze, expression, head size and position from <image1>. Keep its camera distance, shoulders, body pose, arm positions, hands, clothing and scene unchanged. Preserve the body shape, chest size, torso proportions and physical build already established in <image1>. Place the reference hair naturally over the shoulders and torso. Use the scene illumination, exposure and white balance of <image1>. Preserve natural skin and hair detail.', negative_prompt: '', resolution: 0, 'images.image_1': ['153', 0], 'images.image_2': ['4', 0], vae: ['104', 0] }, 'Original reference remains the facial authority');
  add('218', 'KSampler', { model: ['206', 0], positive: ['208', 0], negative: ['208', 1], latent_image: ['208', 2], seed: s.seed, steps: 20, cfg: 1, sampler_name: 'res_multistep', scheduler: 'beta', denoise: 1 }, 'Refine facial identity and hair · 20 steps');
  add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode the accepted head branch');
  add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'RGB head and transferred body');
  add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Retain head output for anatomy comparison');
  let result: [string, number] = ['220', 0];
  if (s.qwenRelight) {
    add('306', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_CONSISTENCY, strength_model: 1 }, 'Stage three · scene illumination');
    add('308', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Relight <image1> to match the scene illumination in <image2>. Change only light direction, shadow softness, exposure, white balance and reflected room light. Preserve the exact person, facial geometry, hairstyle, body anatomy, chest size, shoulder breadth, waist, pose and clothing already in <image1>. <image2> supplies lighting only. Keep the camera framing and ordinary photographic texture.', negative_prompt: '', resolution: 0, 'images.image_1': result, 'images.image_2': ['1', 0], vae: ['104', 0] }, 'Match illumination while retaining reference anatomy');
    add('318', 'KSampler', { model: ['306', 0], positive: ['308', 0], negative: ['308', 1], latent_image: ['308', 2], seed: s.seed + 2, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Match scene illumination · 25 steps');
    add('319', 'VAEDecode', { samples: ['318', 0], vae: ['104', 0] }, 'Decode scene lighting');
    add('320', 'SplitImageWithAlpha', { image: ['319', 0] }, 'RGB relit body');
    add('322', 'SaveImage', { images: ['320', 0], filename_prefix: `recast/${job.id}/lighting_raw` }, 'Retain lighting stage for shape comparison');
    result = ['320', 0];
  }
  add('324', 'SaveImage', { images: result, filename_prefix: `recast/${job.id}/composition_raw` }, 'Retain the assembled replacement before local integration');
  add('126', 'ImageCrop', { image: result, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding only');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore source dimensions without reframing');
  add('128', 'LoadImage', { image: u.original }, 'Immutable original source pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Effective person edit allowance');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Protect the scene beyond the edit area');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Blend only the complete final replacement');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one whole-character photograph');
  return graph;
}
