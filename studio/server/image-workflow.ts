import type { Graph, Job } from '../shared/types';
import { imagePrompt, isImageJob } from '../shared/image-replacement';
import { IMAGE_IDENTITY } from '../shared/models';
import { compileQwenImageWorkflow } from './qwen-image-workflow';

export function compileImageWorkflow(job: Job): Graph {
  if (!isImageJob(job) || !job.image || !job.uploads) throw new Error('Image inputs have not been prepared.');
  if (job.image.settings.model === 'qwen21') return compileQwenImageWorkflow(job);
  const { settings: s, geometry: g } = job.image, graph: Graph = {};
  const refine = ['masked-latent-v3', 'masked-latent-v4'].includes(job.image.version || '') && s.identityRefine;
  if (refine && (!job.uploads.face || !job.uploads.faceMask)) throw new Error('Identity refinement needs a clear reference face and a source-aligned face area.');
  if (s.protectBackground && (!job.uploads.mask || !job.uploads.original)) throw new Error('Paint the replacement area before using background protection.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  add('1', 'LoadImage', { image: job.uploads.source }, 'Target photo controls pose and framing');
  add('4', 'LoadImage', { image: job.uploads.reference }, 'Identity reference controls face, hair and outfit');
  add('102', 'UNETLoader', { unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' }, 'Load the shared Klein 4B editor');
  add('103', 'CLIPLoader', { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' }, 'Read the photographic replacement instructions');
  add('104', 'VAELoader', { vae_name: 'flux2-vae.safetensors' }, 'Load the shared image encoder');
  add('105', 'CLIPTextEncode', { clip: ['103', 0], text: imagePrompt(s, !!job.uploads.face && !refine, job.image.version) }, 'Separate target composition from replacement identity');
  add('106', 'ConditioningZeroOut', { conditioning: ['105', 0] }, 'Distilled zero conditioning');
  add('107', 'VAEEncode', { pixels: ['1', 0], vae: ['104', 0] }, 'Encode target composition as image one');
  add('108', 'VAEEncode', { pixels: ['4', 0], vae: ['104', 0] }, 'Encode replacement identity as image two');
  add('109', 'ReferenceLatent', { conditioning: ['105', 0], latent: ['107', 0] }, 'Target is the first reference');
  add('110', 'ReferenceLatent', { conditioning: ['106', 0], latent: ['107', 0] }, 'Target is the first zero reference');
  add('111', 'ReferenceLatent', { conditioning: ['109', 0], latent: ['108', 0] }, 'Identity is the second reference');
  add('112', 'ReferenceLatent', { conditioning: ['110', 0], latent: ['108', 0] }, 'Identity is the second zero reference');
  let positive: [string, number] = ['111', 0], negative: [string, number] = ['112', 0];
  if (job.uploads.face) {
    add('122', 'LoadImage', { image: job.uploads.face }, 'Close-up of the same replacement identity');
    let facePixels: [string, number] = ['122', 0];
    if (refine && job.image.version === 'masked-latent-v4') {
      add('221', 'ImageScaleToTotalPixels', { image: facePixels, upscale_method: 'lanczos', megapixels: 1, resolution_steps: 16 }, 'Give the identity reference a full reference-token budget');
      facePixels = ['221', 0];
    }
    add('123', 'VAEEncode', { pixels: facePixels, vae: ['104', 0] }, 'Encode facial detail without borrowing its framing');
    if (!refine) {
      add('124', 'ReferenceLatent', { conditioning: positive, latent: ['123', 0] }, 'Add face detail as image three');
      add('125', 'ReferenceLatent', { conditioning: negative, latent: ['123', 0] }, 'Add face detail as zero image three');
      positive = ['124', 0]; negative = ['125', 0];
    }
  }
  add('113', 'CFGGuider', { model: ['102', 0], positive, negative, cfg: 1 }, 'Native distilled guidance');
  add('114', 'EmptyFlux2LatentImage', { width: g.width, height: g.height, batch_size: 1 }, 'Keep the target canvas without cropping');
  add('115', 'Flux2Scheduler', { steps: 4, width: g.width, height: g.height }, 'Four-step Klein schedule');
  add('116', 'RandomNoise', { noise_seed: s.seed }, 'Save a reproducible image seed');
  add('117', 'KSamplerSelect', { sampler_name: 'euler' }, 'Euler image sampler');
  let latent: [string, number] = ['114', 0];
  if (s.protectBackground && job.image.version) {
    if (!job.uploads.noiseMask) throw new Error('The source-aligned sampling mask has not been prepared.');
    add('132', 'LoadImage', { image: job.uploads.noiseMask }, 'Keep the sampling mask aligned with the target canvas');
    add('133', 'ImageToMask', { image: ['132', 0], channel: 'red' }, 'Denoise only the selected area');
    add('134', 'SetLatentNoiseMask', { samples: ['107', 0], mask: ['133', 0] }, 'Retain target scene context during masked sampling');
    latent = ['134', 0]; delete graph['114'];
  }
  add('118', 'SamplerCustomAdvanced', { noise: ['116', 0], guider: ['113', 0], sampler: ['117', 0], sigmas: ['115', 0], latent_image: latent }, 'Replace the character in four image steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the replacement photograph');
  let edited: [string, number] = ['119', 0];
  if (refine) {
    add('201', 'VAEEncode', { pixels: edited, vae: ['104', 0] }, 'Keep the completed outfit and scene as the facial-edit base');
    add('202', 'CLIPTextEncode', { clip: ['103', 0], text: 'head_swap: start with Picture 1 as the base image, keeping its lighting, environment, and background. Replace its head with the head from Picture 2, preserving Picture 2 facial identity, hair, eyes, nose, lips and jaw. Match Picture 1 head rotation, gaze and expression. Keep Picture 1 body, clothing, pose, framing, exposure, light direction and skin illumination.' }, 'Use the trained adapter body-first face-second contract');
    add('203', 'ConditioningZeroOut', { conditioning: ['202', 0] }, 'Distilled facial-edit zero conditioning');
    add('204', 'ReferenceLatent', { conditioning: ['202', 0], latent: ['201', 0] }, 'Completed outfit and scene are facial-pass image one');
    add('205', 'ReferenceLatent', { conditioning: ['203', 0], latent: ['201', 0] }, 'Facial-pass zero image one');
    add('206', 'ReferenceLatent', { conditioning: ['204', 0], latent: ['123', 0] }, 'Clear identity face is facial-pass image two');
    add('207', 'ReferenceLatent', { conditioning: ['205', 0], latent: ['123', 0] }, 'Facial-pass zero image two');
    add('208', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: IMAGE_IDENTITY, strength_model: 1 }, 'Load the matching trained Klein 4B BFS identity adapter');
    add('209', 'CFGGuider', { model: ['208', 0], positive: ['206', 0], negative: ['207', 0], cfg: 1 }, 'Native distilled identity guidance');
    add('210', 'LoadImage', { image: job.uploads.faceMask }, 'Read the source-aligned facial edit area');
    add('211', 'ImageToMask', { image: ['210', 0], channel: 'red' }, 'Restrict identity refinement to the facial area');
    add('212', 'SetLatentNoiseMask', { samples: ['201', 0], mask: ['211', 0] }, 'Keep the outfit and scene during facial sampling');
    let faceLatent: [string, number] = ['212', 0];
    if (job.image.version === 'masked-latent-v4') {
      add('214', 'EmptyFlux2LatentImage', { width: g.width, height: g.height, batch_size: 1 }, 'Use the published head-swap fresh-latent recipe');
      faceLatent = ['214', 0]; delete graph['212'];
    }
    add('216', 'RandomNoise', { noise_seed: (s.seed + 1) % Number.MAX_SAFE_INTEGER }, 'Independent reproducible facial-pass seed');
    add('218', 'SamplerCustomAdvanced', { noise: ['216', 0], guider: ['209', 0], sampler: ['117', 0], sigmas: ['115', 0], latent_image: faceLatent }, 'Refine facial identity · four steps');
    add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode the identity refinement');
    add('220', 'ImageCompositeMasked', { destination: edited, source: ['219', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Keep the completed outfit and scene outside the facial edit');
    edited = ['220', 0];
  }
  add('126', 'ImageCrop', { image: edited, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding without changing camera framing');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore the exact original image dimensions');
  let result: [string, number] = ['127', 0];
  if (s.protectBackground) {
    add('128', 'LoadImage', { image: job.uploads.original }, 'Keep original scene pixels');
    add('129', 'LoadImage', { image: job.uploads.mask }, 'Read the selected replacement area');
    add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'White replaces; black preserves');
    add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: result, x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Replace only the painted area');
    result = ['131', 0];
  }
  add('46', 'SaveImage', { images: result, filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one lossless replacement image');
  return graph;
}
