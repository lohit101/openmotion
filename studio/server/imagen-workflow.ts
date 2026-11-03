import type { Graph, Job } from '../shared/types';

/** Four explicit input contracts. Legacy paid graphs never enter this compiler. */
export function compileImagenWorkflow(job: Job): Graph {
  const run = job.image, uploads = job.uploads;
  if (run?.version !== 'imagen-v1' || !uploads || !run.conditioningPrompt?.trim() || !run.settings.workflow || run.settings.model !== 'qwen21') throw new Error('The frozen Imagen recipe is missing.');
  const s = run.settings, g = run.geometry, textOnly = s.workflow === 'text-to-image', graph: Graph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const references: Record<string, unknown> = {};
  if (!textOnly) {
    if (!uploads.source || !uploads.reference) throw new Error('Imagen needs the target and its role-bound reference.');
    add('1', 'LoadImage', { image: uploads.source }, 'Target · pose, scale, expression, lighting and scene');
    add('4', 'LoadImage', { image: uploads.reference }, s.workflow === 'clothing-only' ? 'Clothing reference only' : 'Character · identity and physique');
    references['images.image_1'] = ['1', 0]; references['images.image_2'] = ['4', 0];
    let slot = 3;
    if (run.faceId && s.workflow !== 'clothing-only') {
      if (!uploads.face) throw new Error('The frozen facial reference has not been uploaded.');
      add('5', 'LoadImage', { image: uploads.face }, 'Facial identity · never source pose or lighting');
      references[`images.image_${slot++}`] = ['5', 0];
    }
    if (s.workflow === 'character-outfit' && run.clothingId) {
      if (!uploads.clothing) throw new Error('The frozen clothing reference has not been uploaded.');
      add('6', 'LoadImage', { image: uploads.clothing }, 'Outfit only · ignore wearer identity and physique');
      references[`images.image_${slot}`] = ['6', 0];
    }
  }
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Shared Qwen Image 2.1 base');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Role-aware image instruction encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching photographic decoder');
  if (s.qwenQuality === 'fast') add('105', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors', strength_model: 1 }, 'Optional eight-step preview acceleration');
  add('107', 'QwenImage21Cache', { model: s.qwenQuality === 'fast' ? ['105', 0] : ['102', 0], device: s.megapixels === 2 ? 'cpu' : 'auto', dtype: 'default' }, 'Lossless prefix cache · high-resolution VRAM reserve');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: run.conditioningPrompt, negative_prompt: '', resolution: textOnly ? 1024 : 0, ...references, vae: ['104', 0] }, 'Frozen English or Chinese photographic instructions');
  if (textOnly) add('109', 'EmptyLatentImage', { width: g.width, height: g.height, batch_size: 1 }, 'Native output canvas · official text-to-image template');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: textOnly ? ['109', 0] : ['108', 2], seed: s.seed,
    steps: s.qwenQuality === 'fast' ? 8 : 40, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'One coherent photographic generation · no beauty or face-restoration pass');
  if (s.megapixels === 2) add('119', 'VAEDecodeTiled', { samples: ['118', 0], vae: ['104', 0], tile_size: 1024, overlap: 128, temporal_size: 64, temporal_overlap: 8 }, 'Native high-resolution decode with bounded working memory');
  else add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Native image decode');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Opaque photographic RGB');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/imagen_raw` }, 'Immutable native model result');
  add('126', 'ImageCrop', { image: ['120', 0], width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove grid padding only · preserve the complete composition');
  add('46', 'SaveImage', { images: ['126', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Whole-image result · no painted seam or scene composite');
  return graph;
}
