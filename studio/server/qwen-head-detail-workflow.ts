import type { Graph, Job } from '../shared/types';
import { QWEN_HEAD } from '../shared/models';
import { bodyOnlyConditioningPrompt } from '../shared/image-replacement';

export function bodyOnlyDetailBodyPrompt(custom: string) {
  return bodyOnlyConditioningPrompt(custom) + '\n\nKeep the source garments\' boundaries, openings, coverage and layers. Areas of bare skin in <image1> stay bare, fitted to the reference physique. Do not import any sportswear, shorts, underwear, elastic waistbands, straps, necklaces or accessories from <image2> or <image3>, including under the source clothes. Preserve only the garments and accessories actually present in <image1>. A separate head pass will recover the source head pose and expression; keep the body, hands and clothing in the original photographic placement.';
}

export const bodyOnlyHeadPrompt = 'head_swap: start with <image1> as the base photograph. Remove its old facial identity completely and replace it with the head and facial identity from <image2>. Transfer the reference facial bone structure, natural face width relative to height, temples, cheekbones, cheeks, jaw taper, chin, eyes, nose, lips, hairline and hair. A narrower reference face must keep its narrower cheeks and jaw; do not inherit or blend the base person\'s broad face shape. Copy only the head rotation, gaze, mouth opening and expression from <image1>. Keep the head center, vertical head extent, neck attachment and camera viewpoint of <image1>; allow the face outline and hair boundary to change naturally for the reference identity. Match the base scene lighting, exposure, skin texture, focus and grain. Preserve the existing clothes, jewelry, glasses, hands, body proportions, background and all foreground occlusions. Return one natural photograph, without beauty retouching or a pasted-on face.';

/** The whole head gets useful pixel resolution; the already fitted body is never rediffused here. */
export function addBodyOnlyHeadDetail(job: Job, graph: Graph = {}): Graph {
  const run = job.image!, u = job.uploads!, crop = run.prepared?.headEdit;
  if (!run.headPrompt || !crop || !u.faceMask || !u.headReference) throw new Error('The frozen head detail inputs are missing. No corrected photo was submitted.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  let base = '131';
  if (run.reusedBody) {
    if (!u.bodyBase) throw new Error('The saved body image is missing. It will not be regenerated automatically.');
    add('501', 'LoadImage', { image: u.bodyBase }, 'Reuse the exact paid body image · no new body inference');
    base = '501';
    add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared Qwen 2.1');
    add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching Qwen image encoder');
    add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching Qwen RGBA VAE');
  }
  add('154', 'SaveImage', { images: [base, 0], filename_prefix: `recast/${job.id}/body_stage` }, run.reusedBody ? 'Record the unchanged reused body' : 'Record source-clothed body before head correction');
  let poseBase = base;
  if (run.version === 'body-only-v6') {
    if (!u.original) throw new Error('The original photographic head guide is missing. No photo was submitted.');
    add('601', 'LoadImage', { image: u.original }, 'Original source expression and head pose · identity is replaced');
    poseBase = '601';
  }
  add('201', 'ImageCrop', { image: [poseBase, 0], x: crop.x, y: crop.y, width: crop.size, height: crop.size }, 'Head with surrounding photographic context · no camera change');
  add('202', 'ImageScale', { image: ['201', 0], upscale_method: 'lanczos', width: crop.resolution, height: crop.resolution, crop: 'disabled' }, 'Give the facial outline its own native pixel budget');
  add('203', 'LoadImage', { image: u.headReference }, 'Selected original facial identity · remove sheet labels');
  add('204', 'ImageScaleToTotalPixels', { image: ['203', 0], upscale_method: 'lanczos', megapixels: .59, resolution_steps: 32 }, 'Reference inside the two-image head adapter budget');
  add('206', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_HEAD, strength_model: 1 }, 'Independent head adapter · no body or turbo LoRA stacking');
  add('207', 'QwenImage21Cache', { model: ['206', 0], device: 'auto', dtype: 'default' }, 'Head-only reference prefix');
  add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: run.headPrompt, negative_prompt: '', resolution: 0, 'images.image_1': ['202', 0], 'images.image_2': ['204', 0], vae: ['104', 0] }, 'Base head placement first · reference identity second');
  add('218', 'KSampler', { model: ['207', 0], positive: ['208', 0], negative: ['208', 1], latent_image: ['208', 2], seed: run.settings.seed, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Replace facial geometry at useful resolution · 20 steps');
  add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode corrected head');
  add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'Photographic RGB head');
  add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Inspect head geometry before compositing');
  add('225', 'ImageScale', { image: ['220', 0], upscale_method: 'lanczos', width: crop.size, height: crop.size, crop: 'disabled' }, 'Return the edit to its exact original crop dimensions');
  add('209', 'LoadImage', { image: u.faceMask }, 'Expanded head edit area · respects protected occluder holes');
  add('210', 'ImageCrop', { image: ['209', 0], x: crop.x, y: crop.y, width: crop.size, height: crop.size }, 'Exact crop-aligned head permission');
  add('211', 'ImageToMask', { image: ['210', 0], channel: 'red' }, 'Allow cheeks and jaw outline to change without touching the body');
  add('221', 'ImageCompositeMasked', { destination: [base, 0], source: ['225', 0], x: crop.x, y: crop.y, resize_source: false, mask: ['211', 0] }, 'Preserve every body pixel outside the head edit');
  add('224', 'SaveImage', { images: ['221', 0], filename_prefix: `recast/${job.id}/head_stage` }, 'Record integrated head and unchanged body');
  add('46', 'SaveImage', { images: ['221', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save body and high-resolution facial correction');
  return graph;
}
