import type { Graph, Job } from '../shared/types';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { QWEN_HEAD, QWEN_STRUCTURE, QWEN_CONSISTENCY } from '../shared/models';

/** Versioned source-anchored inpainting. Separate adapters for body and head. */
export function compileQwenSceneWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.structure || !u.noiseMask || !u.mask || !u.original || !run.settings.protectBackground) throw new Error('Source-anchored replacement requires a painted area and prepared source structure.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const head = s.qwenHeadRefine;
  const revised = ['scene-anchor-v3', 'scene-anchor-v4', 'scene-anchor-v5', 'scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '');
  const nativeLatent = run.version === 'scene-anchor-v2' || revised;
  const controlled = !revised || s.structureStrength > 0;
  if (head && (!u.face || !u.faceMask || !u.bodyMask)) throw new Error('The separate head pass requires one clear target face and reference face.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const steps = s.qwenQuality === 'quality' ? 20 : 8, cfg = !revised && s.qwenQuality === 'quality' ? 4 : 1;
  add('1', 'LoadImage', { image: u.source }, 'Original source frame · composition and illumination');
  add('4', 'LoadImage', { image: u.reference }, 'Replacement person · appearance and outfit');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared Qwen Image 2.1 INT8');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching visual instruction encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching Qwen RGBA VAE');
  let base: [string, number] = ['102', 0];
  if (s.qwenQuality !== 'quality') {
    add('105', 'LoraLoaderModelOnly', { model: base, lora_name: 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors', strength_model: 1 }, 'Official eight-step acceleration');
    base = ['105', 0];
  }
  let reference: [string, number] = ['4', 0];
  if (['scene-anchor-v4', 'scene-anchor-v5', 'scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '') && s.qwenNormalizeReference) {
    add('501', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Make a neutral studio reference photograph of the exact same person in <image1>. Keep their recognizable facial identity, facial proportions, eyes, nose, lips, jaw, skin tone, hairstyle, complete outfit, clothing details, body shape and accessories. Keep the same upper-body crop; do not invent unseen legs or shoes. Face the camera with a relaxed neutral expression. Lower both arms naturally beside the torso so the hands are below the frame. Use soft diffuse neutral indoor lighting, gentle shadows and a plain light gray background. Preserve natural photographic skin detail. Keep the person recognizable; change only pose, lighting and background.', negative_prompt: '', resolution: 0, 'images.image_1': ['4', 0], vae: ['104', 0] }, 'Normalize reference lighting and arm pose without another identity');
    add('502', 'KSampler', { model: ['102', 0], positive: ['501', 0], negative: ['501', 1], latent_image: ['501', 2], seed: s.seed + 1000, steps: 30, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Neutral character reference · 30 steps');
    add('503', 'VAEDecode', { samples: ['502', 0], vae: ['104', 0] }, 'Decode the normalized reference');
    add('504', 'SplitImageWithAlpha', { image: ['503', 0] }, 'RGB normalized appearance');
    add('505', 'SaveImage', { images: ['504', 0], filename_prefix: `recast/${job.id}/reference_normalized` }, 'Save reference for identity review');
    reference = ['504', 0];
  }
  add('106', 'LoraLoaderModelOnly', { model: base, lora_name: 'bfs_body_swap_v1.0_qwen_2.1.safetensors', strength_model: 1 }, 'Body and outfit transfer');
  const extra = s.prompt.trim();
  const prompt = (['scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '')
    ? 'body_swap: start with <image1> as the base photograph, keeping its camera, lighting, environment and background. Replace its entire person with the person from <image2>, preserving the reference facial identity, hair, skin tone, complete clothing, body shape and proportions. Copy the pose, eye direction, head rotation, expression, shoulder positions, arm positions and camera distance from <image1>. Keep its apparent head size and screen placement. Fit the replacement outfit to that pose. Preserve reference garment details and visible tattoo lettering without adding accessories absent from the reference. Keep the surroundings unchanged.'
    : 'body_swap: edit <image1>. Replace its person with the person and complete outfit from <image2>. Keep <image1> pose, head size, screen position, camera distance and lighting. Keep the rest of the photograph unchanged.')
    + (extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' ' + extra : '');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': reference, vae: ['104', 0] }, 'Scene and identity in separate reference slots');
  if (controlled) {
    add('140', 'ModelPatchLoader', { name: QWEN_STRUCTURE.slice('model_patches/'.length) }, 'Trained Qwen geometry and inpainting branch');
    add('141', 'LoadImage', { image: u.structure }, 'Source edges with internal facial detail removed');
  }
  add('142', 'LoadImage', { image: head ? u.bodyMask : u.noiseMask }, 'Source-aligned body edit mask');
  add('143', 'ImageToMask', { image: ['142', 0], channel: 'red' }, 'White regenerates; black preserves');
  if (!nativeLatent) add('144', 'VAEEncode', { pixels: ['1', 0], vae: ['104', 0] }, 'Start from the original source latent');
  if (controlled) add('146', 'ZImageFunControlnet', { model: ['106', 0], model_patch: ['140', 0], vae: ['104', 0], image: ['141', 0], ...(['scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '') ? {} : { inpaint_image: ['1', 0], mask: ['143', 0] }), strength: s.structureStrength, start_percent: 0, end_percent: ['scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '') ? 0.6 : 1 }, 'Constrain source geometry and unpainted context during denoising');
  if (!nativeLatent) add('149', 'SetLatentNoiseMask', { samples: ['144', 0], mask: ['143', 0] }, 'Denoise only the intended body region');
  add('118', 'KSampler', { model: [controlled ? '146' : '106', 0], positive: ['108', 0], negative: ['108', 1], latent_image: nativeLatent ? ['108', 2] : ['149', 0], seed: s.seed, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, `Character and outfit · ${steps} steps`);
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the body edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Explicit RGB body image');
  if (revised) add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Save the model output before masking for quality diagnosis');
  let result: [string, number] = ['120', 0];
  if (head) {
    add('153', 'ImageCompositeMasked', { destination: ['1', 0], source: result, x: 0, y: 0, resize_source: false, mask: ['143', 0] }, revised ? 'Keep the generated identity inside the painted area' : 'Keep the original face core as the head-pose anchor');
    add('154', 'SaveImage', { images: ['153', 0], filename_prefix: `recast/${job.id}/body_stage` }, 'Save the intermediate body edit for review');
    add('203', 'LoadImage', { image: u.face }, 'Clear reference head · same replacement person');
    add('206', 'LoraLoaderModelOnly', { model: base, lora_name: QWEN_HEAD, strength_model: 1 }, 'Head v1.1 · separate from the body adapter');
    add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'head_swap: edit <image1>. Replace its head with the head from <image2>, preserving the reference identity and hair. Copy head rotation, eye direction and expression from <image1>. Keep the head size, body, clothing, lighting and background of <image1> unchanged. Preserve natural skin texture.', negative_prompt: '', resolution: 0, 'images.image_1': ['153', 0], 'images.image_2': ['203', 0], vae: ['104', 0] }, 'Separate two-image identity conditioning');
    add('209', 'LoadImage', { image: u.faceMask }, 'Source-aligned head edit area');
    add('211', 'ImageToMask', { image: ['209', 0], channel: 'red' }, 'Preserve the completed body outside the head');
    if (!nativeLatent) {
      add('212', 'VAEEncode', { pixels: ['153', 0], vae: ['104', 0] }, 'Encode the completed body with source face geometry');
      add('214', 'SetLatentNoiseMask', { samples: ['212', 0], mask: ['211', 0] }, 'Localize the separate identity pass');
    }
    if (controlled) add('215', 'ZImageFunControlnet', { model: ['206', 0], model_patch: ['140', 0], vae: ['104', 0], image: ['141', 0], inpaint_image: ['153', 0], mask: ['211', 0], strength: s.structureStrength, start_percent: 0, end_percent: 1 }, 'Retain source head geometry and scene context');
    add('218', 'KSampler', { model: [controlled ? '215' : '206', 0], positive: ['208', 0], negative: ['208', 1], latent_image: nativeLatent ? ['208', 2] : ['214', 0], seed: s.seed + 1, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, `Separate facial identity · ${steps} steps`);
    add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode the localized head edit');
    add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'Explicit RGB head image');
    if (revised) add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Save the head output before masking for quality diagnosis');
    add('221', 'ImageCompositeMasked', { destination: ['153', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Keep the finished body outside the head area');
    result = ['221', 0];
  }
  if (['scene-anchor-v5', 'scene-anchor-v6', 'scene-anchor-v7'].includes(run.version || '') && s.qwenRelight) {
    add('306', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_CONSISTENCY, strength_model: 1 }, 'Separate lighting consistency adapter');
    add('308', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Relight <image1> to match the illumination in <image2>. Change only lighting: light direction, softness, shadow strength, exposure, white balance and reflected room light. Preserve the exact person already in <image1>, including facial geometry, eyes, nose, lips, skin identity, expression, body shape, pose, hair and clothing. Preserve its camera and scene composition. <image2> supplies illumination only; the person and clothing remain those of <image1>. Keep ordinary photographic skin texture, focus and grain.', negative_prompt: '', resolution: 0, 'images.image_1': result, 'images.image_2': ['1', 0], vae: ['104', 0] }, 'Preserve the replacement identity while matching scene light');
    add('318', 'KSampler', { model: ['306', 0], positive: ['308', 0], negative: ['308', 1], latent_image: ['308', 2], seed: s.seed + 2, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Match scene illumination · 25 steps');
    add('319', 'VAEDecode', { samples: ['318', 0], vae: ['104', 0] }, 'Decode the lighting stage');
    add('320', 'SplitImageWithAlpha', { image: ['319', 0] }, 'RGB integrated character');
    add('322', 'SaveImage', { images: ['320', 0], filename_prefix: `recast/${job.id}/lighting_raw` }, 'Retain the relit character before blending');
    result = ['320', 0];
  }
  if (run.version === 'scene-anchor-v7') add('324', 'SaveImage', { images: result, filename_prefix: `recast/${job.id}/composition_raw` }, 'Save the complete unblended character before local integration');
  add('126', 'ImageCrop', { image: result, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding only');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore the source photograph dimensions');
  add('128', 'LoadImage', { image: u.original }, 'Original source pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Actual prepared edit area');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Protect the unedited source');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Preserve the source outside the edit area');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one source-anchored replacement');
  return graph;
}
