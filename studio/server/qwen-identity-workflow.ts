import type { Graph, Job } from '../shared/types';
import { QWEN_HEAD, QWEN_OUTFIT, QWEN_CONSISTENCY } from '../shared/models';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';

/** Isolated identity, clothing and optional illumination branches; no adapter stacking. */
export function compileQwenIdentityWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.face || !u.faceMask || !u.mask || !u.original || !run.settings.protectBackground) throw new Error('Identity-first editing needs a clear reference face and target-aligned edit masks.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const extra = s.prompt.trim();
  const custom = extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' Additional requirements: ' + extra : '';
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  add('1', 'LoadImage', { image: u.source }, 'Original target · camera, pose and lighting');
  add('4', 'LoadImage', { image: u.reference }, 'Original replacement appearance and outfit');
  add('203', 'LoadImage', { image: u.face }, 'Tight face from original identity reference');
  add('209', 'LoadImage', { image: u.faceMask }, 'Target-aligned facial region');
  add('211', 'ImageToMask', { image: ['209', 0], channel: 'red' }, 'Facial integration region');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared native Qwen Image 2.1');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching Qwen vision-language encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching RGBA VAE');
  add('206', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_HEAD, strength_model: 1 }, 'Stage one · facial identity');
  add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'head_swap: edit <image1>. Replace the facial identity with the person from <image2>, preserving that person\'s recognizable facial proportions, eyes, nose, lips, cheeks, jaw and distinguishing features. Keep <image1> head size, position, head rotation, gaze, expression, camera distance, body pose, hands, outfit and background. Illuminate the replacement face with <image1> scene lighting. Preserve natural skin detail.', negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['203', 0], vae: ['104', 0] }, 'Source pose and original identity in separate slots');
  add('218', 'KSampler', { model: ['206', 0], positive: ['208', 0], negative: ['208', 1], latent_image: ['208', 2], seed: s.seed, steps: 20, cfg: 1, sampler_name: 'res_multistep', scheduler: 'beta', denoise: 1 }, 'Establish facial identity · 20 steps');
  add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode facial identity');
  add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'RGB identity image');
  add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Save identity before clothing changes');
  add('221', 'ImageCompositeMasked', { destination: ['1', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Place identity in the original target before clothing');
  add('106', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_OUTFIT, strength_model: 1 }, 'Stage two · clothing consistency');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Dress the person in <image1> entirely in the outfit from <image2>, matching its fabric, color, neckline, straps, sleeves and accessories. Keep the already established facial identity, facial geometry, expression, head size, body position, pose, hands, camera and background of <image1>. Match the replacement person\'s hair color and hairstyle from <image2> while retaining the established face. Fit the garments naturally to the source pose. Preserve <image1> lighting and photographic texture.' + custom, negative_prompt: '', resolution: 0, 'images.image_1': ['221', 0], 'images.image_2': ['4', 0], vae: ['104', 0] }, 'Established identity first · outfit reference second');
  add('118', 'KSampler', { model: ['106', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed + 1, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Adapt outfit while retaining identity · 25 steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode clothing edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'RGB clothed character');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Save clothing output for identity comparison');
  add('223', 'ImageCompositeMasked', { destination: ['120', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Restore the established facial pixels after clothing');
  add('154', 'SaveImage', { images: ['223', 0], filename_prefix: `recast/${job.id}/body_stage` }, 'Save established identity and outfit before relighting');
  let result: [string, number] = ['223', 0];
  if (s.qwenRelight) {
    add('306', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_CONSISTENCY, strength_model: 1 }, 'Stage three · lighting consistency');
    add('308', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'Relight <image1> to match the illumination in <image2>. Change only lighting: light direction, softness, shadow strength, exposure, white balance and reflected room light. Preserve the exact person already in <image1>, including facial geometry, eyes, nose, lips, skin identity, expression, body shape, pose, hair and clothing. Preserve its camera and scene composition. <image2> supplies illumination only; the person and clothing remain those of <image1>. Keep ordinary photographic skin texture, focus and grain.', negative_prompt: '', resolution: 0, 'images.image_1': result, 'images.image_2': ['1', 0], vae: ['104', 0] }, 'Relight the established character using the target scene');
    add('318', 'KSampler', { model: ['306', 0], positive: ['308', 0], negative: ['308', 1], latent_image: ['308', 2], seed: s.seed + 2, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Match scene illumination · 25 steps');
    add('319', 'VAEDecode', { samples: ['318', 0], vae: ['104', 0] }, 'Decode the lighting edit');
    add('320', 'SplitImageWithAlpha', { image: ['319', 0] }, 'RGB integrated character');
    add('322', 'SaveImage', { images: ['320', 0], filename_prefix: `recast/${job.id}/lighting_raw` }, 'Retain the lighting stage');
    result = ['320', 0];
  }
  add('126', 'ImageCrop', { image: result, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove model grid padding only');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore original photo dimensions');
  add('128', 'LoadImage', { image: u.original }, 'Original decoded background');
  add('129', 'LoadImage', { image: u.mask }, 'Effective replacement allowance');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'Final scene blend mask');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Integrate the finished character once');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save final identity-first photograph');
  return graph;
}
