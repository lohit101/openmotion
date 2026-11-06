import type { Graph, Job } from '../shared/types';
import { imageEditEncoder, imageEditLightning, imageEditModel, imageEditSampling, imageEditSettingsSchema, imageEditVae, imageEditVersion } from '../shared/image-edit';

/** Qwen's native multi-image conditioning. No Imagen templates or face passes. */
export function compileImageEditWorkflow(job: Job): Graph {
  const run = job.image, edit = run?.edit, uploads = job.uploads;
  if (run?.version !== imageEditVersion || !edit || !uploads || run.settings.model !== 'qwen2511') throw new Error('The frozen Image Edit recipe is missing.');
  const s = imageEditSettingsSchema.parse(edit.settings), g = run.geometry, sampling = imageEditSampling(s);
  if (!s.prompt.trim() || edit.references.length < 1 || edit.references.length > 3) throw new Error('Image Edit needs a prompt and one to three ordered references.');
  const graph: Graph = {}, refs: Record<string, unknown> = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  edit.references.forEach((_, i) => {
    const input = uploads[(['source', 'reference', 'face'] as const)[i]];
    if (!input) throw new Error(`Image ${i + 1} has not been uploaded.`);
    add(String(i + 1), 'LoadImage', { image: input }, `Image ${i + 1} · frozen reference order`);
    refs[`image${i + 1}`] = [String(i + 1), 0];
  });
  add('102', 'UNETLoader', { unet_name: imageEditModel(s), weight_dtype: 'default' }, 'Qwen Image Edit 2511 · ' + s.precision.toUpperCase());
  add('103', 'CLIPLoader', { clip_name: imageEditEncoder, type: 'qwen_image', device: 'default' }, 'Matching Qwen 2.5 VL image instruction encoder');
  add('104', 'VAELoader', { vae_name: imageEditVae }, 'Matching Qwen Image VAE');
  if (s.quality === 'lightning') add('105', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: imageEditLightning, strength_model: 1 }, 'Optional matching four-step Lightning adapter');
  add('106', 'ModelSamplingAuraFlow', { model: s.quality === 'lightning' ? ['105', 0] : ['102', 0], shift: sampling.shift }, 'Official Qwen editing flow shift');
  add('108', 'TextEncodeQwenImageEditPlus', { clip: ['103', 0], vae: ['104', 0], prompt: s.prompt, ...refs }, 'Your exact prompt · ordered multi-image conditioning');
  add('110', 'TextEncodeQwenImageEditPlus', { clip: ['103', 0], vae: ['104', 0], prompt: '', ...refs }, 'Unconditional branch · same reference images');
  add('109', 'EmptySD3LatentImage', { width: g.width, height: g.height, batch_size: 1 }, 'Native output canvas · no reference crop or image enlargement');
  add('118', 'KSampler', { model: ['106', 0], positive: ['108', 0], negative: ['110', 0], latent_image: ['109', 0], seed: s.seed, steps: sampling.steps, cfg: sampling.cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Frozen Qwen Image Edit sampling');
  add('119', 'VAEDecodeTiled', { samples: ['118', 0], vae: ['104', 0], tile_size: 1024, overlap: 128, temporal_size: 64, temporal_overlap: 8 }, 'Bounded-memory native decode');
  add('46', 'SaveImage', { images: ['119', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Immutable native PNG result');
  return graph;
}
