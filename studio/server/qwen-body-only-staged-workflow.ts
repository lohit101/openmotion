import type { Graph, Job } from '../shared/types';
import { bodyOnlyPrompt, bodyOnlyPromptV1, defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { QWEN_BODY, QWEN_HEAD, QWEN_OUTFIT, QWEN_STRUCTURE } from '../shared/models';

export function bodyOnlyStagedPrompts(custom: string) {
  const extra = custom.trim();
  const additional = extra && ![bodyOnlyPrompt, bodyOnlyPromptV1, defaultImagePrompt, legacyImagePrompt].includes(extra) ? '\nAdditional requirements: ' + extra : '';
  return {
    body: 'body_swap: start with <image1> as the base photograph. Replace its whole person with the person from <image2>, preserving the reference person\'s facial identity, hair, skin tone and physical build. Transfer the actual reference chest, bust, shoulder breadth, ribcage, waist, hips, upper arms and anatomical proportions without slimming, idealizing or exaggerating them. Copy the pose, head rotation, expression, gaze and hand positions from <image1>. Keep its apparent head size, face-center position, camera distance, framing and crop. Do not pull back to show more of the reference body; unseen legs remain outside the source frame. Keep <image1> lighting and environment. The following pass will restore the source garments and accessories.' + additional,
    outfit: 'Dress the person in <image1> in the exact garments and accessories worn in <image2>. Replace every reference garment with the source outfit: preserve the garment types, coverage, neckline, sleeves, colors, fabric, printed artwork, jewellery, wrist bands, glasses and other visible accessories from <image2>. Fit those garments naturally to the person ALREADY in <image1>, preserving their actual chest/bust volume, ribcage, shoulder breadth, waist width, hips and limb thickness. Never copy the physique, face, skin or hairstyle of the person in <image2>. Keep <image1> facial identity, hair, head size and position, body proportions, hand positions, pose, camera, lighting and background. Do not narrow the waist or chest to recover the original garment silhouette.' + additional,
    face: 'head_swap: edit <image1>. Replace only the facial identity with the exact person from <image2>. Preserve the reference facial geometry, eye shape and spacing, nose, lips, cheeks, jaw, chin and distinguishing features. Do not blend with the original identity or beautify the face. Copy <image1> head rotation, gaze, expression, apparent head size and face-center position. Keep the already established hair, physique, chest/bust, waist, clothing, accessories, glasses, hands and camera unchanged. Preserve the finger or hand near the mouth and all foreground occlusions. Match <image1> scene illumination and natural skin texture.' + additional,
  };
}

/** Evaluation route: body identity, source garments, then a face-limited correction. */
export function compileQwenBodyOnlyStagedWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads, p = run?.stagedPrompts;
  if (!run || !p?.body || !p.outfit || !p.face || !u?.source || !u.reference || !u.bodyReference || !u.face || !u.faceMask || !u.noiseMask || !u.original || !u.mask) throw new Error('Staged body-only replacement needs its frozen stage prompts, body canvas, facial reference and target-aligned masks.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const pose = run.version === 'body-only-v4' && s.bodyOnlyPose;
  if (pose && !u.structure) throw new Error('The staged source-joint guide is missing. No pose-controlled photo was submitted.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  add('1', 'LoadImage', { image: u.source }, 'Original source camera, pose, garments and accessories');
  add('4', 'LoadImage', { image: u.reference }, 'Original cropped body view');
  add('5', 'LoadImage', { image: u.face }, 'Authoritative facial reference');
  add('500', 'LoadImage', { image: u.bodyReference }, 'Original reference on an undistorted square canvas');
  add('506', 'ImageScaleToTotalPixels', { image: ['500', 0], upscale_method: 'lanczos', megapixels: .59, resolution_steps: 32 }, 'Reference body inside the trained token budget');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared native Qwen Image 2.1');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching Qwen image encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching RGBA VAE');
  add('142', 'LoadImage', { image: u.noiseMask }, 'Approved person edit area');
  add('143', 'ImageToMask', { image: ['142', 0], channel: 'red' }, 'Keep the source scene outside the edit area');
  add('106', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_BODY, strength_model: 1 }, 'Stage one · trained whole-body identity transfer');
  if (pose) {
    add('140', 'ModelPatchLoader', { name: QWEN_STRUCTURE.slice('model_patches/'.length) }, 'Source pose control · no source silhouette or facial texture');
    add('141', 'LoadImage', { image: u.structure }, 'Actual source joint positions');
    add('146', 'ZImageFunControlnet', { model: ['106', 0], model_patch: ['140', 0], vae: ['104', 0], image: ['141', 0], strength: s.bodyPoseStrength, start_percent: 0, end_percent: .8 }, 'Keep the original arm and hand placement while replacing physique');
  }
  add('107', 'QwenImage21Cache', { model: [pose ? '146' : '106', 0], device: 'auto', dtype: 'default' }, 'Body reference prefix');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: p.body, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['506', 0], vae: ['104', 0] }, 'Source scene first · actual reference physique second');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Transfer reference physique · 20 steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode body identity');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'RGB transferred body');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Retain the physique before source outfit restoration');
  add('153', 'ImageCompositeMasked', { destination: ['1', 0], source: ['120', 0], x: 0, y: 0, resize_source: false, mask: ['143', 0] }, 'Keep the room as context for garment fitting');
  add('154', 'SaveImage', { images: ['153', 0], filename_prefix: `recast/${job.id}/body_stage` }, 'Inspect body pose and camera before clothing');
  add('306', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_OUTFIT, strength_model: 1 }, 'Stage two · source outfit on the transferred physique');
  add('307', 'QwenImage21Cache', { model: ['306', 0], device: 'auto', dtype: 'default' }, 'Independent garment prefix');
  add('308', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: p.outfit, negative_prompt: '', resolution: 0, 'images.image_1': ['153', 0], 'images.image_2': ['1', 0], vae: ['104', 0] }, 'Transferred physique first · source outfit second');
  add('318', 'KSampler', { model: ['307', 0], positive: ['308', 0], negative: ['308', 1], latent_image: ['308', 2], seed: s.seed + 1, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Restore source clothing and accessories · 25 steps');
  add('319', 'VAEDecode', { samples: ['318', 0], vae: ['104', 0] }, 'Decode source-clothed reference body');
  add('320', 'SplitImageWithAlpha', { image: ['319', 0] }, 'RGB restored source outfit');
  add('325', 'SaveImage', { images: ['320', 0], filename_prefix: `recast/${job.id}/outfit_raw` }, 'Inspect whether garment fitting retained physique');
  add('206', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_HEAD, strength_model: 1 }, 'Stage three · independent facial identity adapter');
  add('207', 'QwenImage21Cache', { model: ['206', 0], device: 'auto', dtype: 'default' }, 'Independent face prefix');
  add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: p.face, negative_prompt: '', resolution: 0, 'images.image_1': ['320', 0], 'images.image_2': ['5', 0], vae: ['104', 0] }, 'Correct the face from the explicit original facial reference');
  add('218', 'KSampler', { model: ['207', 0], positive: ['208', 0], negative: ['208', 1], latent_image: ['208', 2], seed: s.seed, steps: 20, cfg: 1, sampler_name: run.version === 'body-only-v4' ? 'euler' : 'res_multistep', scheduler: run.version === 'body-only-v4' ? 'simple' : 'beta', denoise: 1 }, 'Refine facial identity · 20 steps');
  add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode facial identity');
  add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'RGB corrected facial identity');
  add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Retain raw facial correction for comparison');
  add('209', 'LoadImage', { image: u.faceMask }, 'Face-only edit permission');
  add('211', 'ImageToMask', { image: ['209', 0], channel: 'red' }, 'Keep established body and garments outside facial correction');
  add('221', 'ImageCompositeMasked', { destination: ['320', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Apply face correction without repainting the transferred physique');
  add('224', 'SaveImage', { images: ['221', 0], filename_prefix: `recast/${job.id}/head_stage` }, 'Inspect the combined source-clothing identity edit');
  add('324', 'SaveImage', { images: ['221', 0], filename_prefix: `recast/${job.id}/composition_raw` }, 'Preserve full final composition before source integration');
  add('126', 'ImageCrop', { image: ['221', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove canvas padding only');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore source dimensions without reframing');
  add('128', 'LoadImage', { image: u.original }, 'Original source pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Original-size edit permission');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Protect unrelated source scenery');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Integrate inside the approved edit area');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save staged body-only evaluation');
  return graph;
}
