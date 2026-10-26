import type { Graph, Job } from '../shared/types';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { QWEN_HEAD, QWEN_STRUCTURE } from '../shared/models';

/** Versioned source-anchored inpainting. Separate adapters for body and head. */
export function compileQwenSceneWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.structure || !u.noiseMask || !u.mask || !u.original || !run.settings.protectBackground) throw new Error('Source-anchored replacement requires a painted area and prepared source structure.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const head = s.qwenHeadRefine;
  const nativeLatent = run.version === 'scene-anchor-v2';
  if (head && (!u.face || !u.faceMask || !u.bodyMask)) throw new Error('The separate head pass requires one clear target face and reference face.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const steps = s.qwenQuality === 'quality' ? 20 : 8, cfg = s.qwenQuality === 'quality' ? 4 : 1;
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
  add('106', 'LoraLoaderModelOnly', { model: base, lora_name: 'bfs_body_swap_v1.0_qwen_2.1.safetensors', strength_model: 1 }, 'Body and outfit transfer');
  const extra = s.prompt.trim();
  const prompt = 'body_swap: edit <image1>. Replace its person with the person and complete outfit from <image2>. Keep <image1> pose, head size, screen position, camera distance and lighting. Keep the rest of the photograph unchanged.'
    + (extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' ' + extra : '');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], vae: ['104', 0] }, 'Scene and identity in separate reference slots');
  add('140', 'ModelPatchLoader', { name: QWEN_STRUCTURE.slice('model_patches/'.length) }, 'Trained Qwen geometry and inpainting branch');
  add('141', 'LoadImage', { image: u.structure }, 'Source edges with internal facial detail removed');
  add('142', 'LoadImage', { image: head ? u.bodyMask : u.noiseMask }, 'Source-aligned body edit mask');
  add('143', 'ImageToMask', { image: ['142', 0], channel: 'red' }, 'White regenerates; black preserves');
  if (!nativeLatent) add('144', 'VAEEncode', { pixels: ['1', 0], vae: ['104', 0] }, 'Start from the original source latent');
  add('146', 'ZImageFunControlnet', { model: ['106', 0], model_patch: ['140', 0], vae: ['104', 0], image: ['141', 0], inpaint_image: ['1', 0], mask: ['143', 0], strength: s.structureStrength, start_percent: 0, end_percent: 1 }, 'Constrain source geometry and unpainted context during denoising');
  if (!nativeLatent) add('149', 'SetLatentNoiseMask', { samples: ['144', 0], mask: ['143', 0] }, 'Denoise only the intended body region');
  add('118', 'KSampler', { model: ['146', 0], positive: ['108', 0], negative: ['108', 1], latent_image: nativeLatent ? ['108', 2] : ['149', 0], seed: s.seed, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, `Source-anchored body and outfit · ${steps} steps`);
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the body edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Explicit RGB body image');
  let result: [string, number] = ['120', 0];
  if (head) {
    add('153', 'ImageCompositeMasked', { destination: ['1', 0], source: result, x: 0, y: 0, resize_source: false, mask: ['143', 0] }, 'Keep the original face core as the head-pose anchor');
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
    add('215', 'ZImageFunControlnet', { model: ['206', 0], model_patch: ['140', 0], vae: ['104', 0], image: ['141', 0], inpaint_image: ['153', 0], mask: ['211', 0], strength: s.structureStrength, start_percent: 0, end_percent: 1 }, 'Retain source head geometry and scene context');
    add('218', 'KSampler', { model: ['215', 0], positive: ['208', 0], negative: ['208', 1], latent_image: nativeLatent ? ['208', 2] : ['214', 0], seed: s.seed + 1, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, `Separate facial identity · ${steps} steps`);
    add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode the localized head edit');
    add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'Explicit RGB head image');
    add('221', 'ImageCompositeMasked', { destination: ['153', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Keep the finished body outside the head area');
    result = ['221', 0];
  }
  add('126', 'ImageCrop', { image: result, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding only');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore the source photograph dimensions');
  add('128', 'LoadImage', { image: u.original }, 'Original source pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Actual prepared edit area');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Protect the unedited source');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Preserve the source outside the edit area');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one source-anchored replacement');
  return graph;
}
