import type { Graph, Job } from '../shared/types';
import { imagePrompt, isImageJob } from '../shared/image-replacement';

export function compileImageWorkflow(job: Job): Graph {
  if (!isImageJob(job) || !job.image || !job.uploads) throw new Error('Image inputs have not been prepared.');
  const { settings: s, geometry: g } = job.image, graph: Graph = {};
  if (s.protectBackground && (!job.uploads.mask || !job.uploads.original)) throw new Error('Paint the replacement area before using background protection.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  add('1', 'LoadImage', { image: job.uploads.source }, 'Target photo controls pose and framing');
  add('4', 'LoadImage', { image: job.uploads.reference }, 'Identity reference controls face, hair and outfit');
  add('102', 'UNETLoader', { unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' }, 'Load the shared Klein 4B editor');
  add('103', 'CLIPLoader', { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' }, 'Read the photographic replacement instructions');
  add('104', 'VAELoader', { vae_name: 'flux2-vae.safetensors' }, 'Load the shared image encoder');
  add('105', 'CLIPTextEncode', { clip: ['103', 0], text: imagePrompt(s, !!job.uploads.face, job.image.version) }, 'Separate target composition from replacement identity');
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
    add('123', 'VAEEncode', { pixels: ['122', 0], vae: ['104', 0] }, 'Encode facial detail without borrowing its framing');
    add('124', 'ReferenceLatent', { conditioning: positive, latent: ['123', 0] }, 'Add face detail as image three');
    add('125', 'ReferenceLatent', { conditioning: negative, latent: ['123', 0] }, 'Add face detail as zero image three');
    positive = ['124', 0]; negative = ['125', 0];
  }
  add('113', 'CFGGuider', { model: ['102', 0], positive, negative, cfg: 1 }, 'Native distilled guidance');
  add('114', 'EmptyFlux2LatentImage', { width: g.width, height: g.height, batch_size: 1 }, 'Keep the target canvas without cropping');
  add('115', 'Flux2Scheduler', { steps: 4, width: g.width, height: g.height }, 'Four-step Klein schedule');
  add('116', 'RandomNoise', { noise_seed: s.seed }, 'Save a reproducible image seed');
  add('117', 'KSamplerSelect', { sampler_name: 'euler' }, 'Euler image sampler');
  let latent: [string, number] = ['114', 0];
  if (s.protectBackground && job.image.version === 'masked-latent-v2') {
    if (!job.uploads.noiseMask) throw new Error('The source-aligned sampling mask has not been prepared.');
    add('132', 'LoadImage', { image: job.uploads.noiseMask }, 'Keep the sampling mask aligned with the target canvas');
    add('133', 'ImageToMask', { image: ['132', 0], channel: 'red' }, 'Denoise only the selected area');
    add('134', 'SetLatentNoiseMask', { samples: ['107', 0], mask: ['133', 0] }, 'Retain target scene context during masked sampling');
    latent = ['134', 0]; delete graph['114'];
  }
  add('118', 'SamplerCustomAdvanced', { noise: ['116', 0], guider: ['113', 0], sampler: ['117', 0], sigmas: ['115', 0], latent_image: latent }, 'Replace the character in four image steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the replacement photograph');
  add('126', 'ImageCrop', { image: ['119', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding without changing camera framing');
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
