import type { Graph, Job } from '../shared/types';
import { defaultImagePrompt, legacyImagePrompt } from '../shared/image-replacement';
import { QWEN_HEAD } from '../shared/models';

/** Native Qwen mask-reference experiment; independent of BFS's two-image training. */
export function compileQwenNativeWorkflow(job: Job): Graph {
  const run = job.image, u = job.uploads;
  if (!run || !u?.noiseMask || !u.mask || !u.original || !run.settings.protectBackground) throw new Error('Native masked replacement requires a target-aligned painted edit area.');
  const s = run.settings, g = run.geometry, graph: Graph = {};
  const maskReference = run.version === 'native-mask-v1';
  if (s.qwenHeadRefine && (!u.face || !u.faceMask)) throw new Error('Native identity refinement needs a clear reference face and a source-aligned face region.');
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const instruction = 'Edit <image1>, the target photograph. Replace its person with the recognizable person from <image2>, including their face, hair, physical appearance, complete clothing and accessories. '
    + (maskReference ? '<image3> is a black-and-white edit permission mask aligned to <image1>: white permits replacement and black marks protected scenery. The mask is a guide, not an object to draw. ' : 'Preserve the complete original photograph: the background, room and objects stay in the same locations and retain their original appearance. Keep the original camera and subject framing. ')
    + 'Keep the exact pose, head and shoulder positions, apparent head size, body orientation, arm and hand positions, expression, gaze, camera distance, perspective and framing from <image1>. '
    + 'Use <image2> only for the replacement identity and outfit; fit those clothes to the target pose. Use the illumination of <image1>: match its light direction, exposure, color temperature, shadows and ambient reflected light. '
    + 'Preserve the target background, objects and foreground occlusions. Match its focus, grain and natural skin texture. Return one ordinary photograph with only the requested person replaced.'
    + (maskReference ? '' : ' Keep an opaque photographic background. Match the target lighting instead of reproducing the reference photograph\'s lighting. Keep the original head silhouette and apparent head size, adapting the replacement hair naturally to that space.');
  const extra = s.prompt.trim();
  const prompt = instruction + (extra && ![defaultImagePrompt, legacyImagePrompt].includes(extra) ? ' Additional requirements: ' + extra : '');
  add('1', 'LoadImage', { image: u.source }, 'Target photograph · scene, pose and illumination');
  add('4', 'LoadImage', { image: u.reference }, 'Replacement identity and complete outfit');
  if (maskReference) add('142', 'LoadImage', { image: u.noiseMask }, 'Aligned edit permission · expanded and feathered');
  add('102', 'UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }, 'Native Qwen Image 2.1 INT8');
  add('103', 'CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }, 'Matching visual instruction encoder');
  add('104', 'VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, 'Matching RGBA image VAE');
  add('107', 'QwenImage21Cache', { model: ['102', 0], device: 'auto', dtype: 'default' }, 'Reuse native reference prefix');
  add('108', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt, negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['4', 0], ...(maskReference ? { 'images.image_3': ['142', 0] } : {}), vae: ['104', 0] }, maskReference ? 'Native scene / person / mask references' : 'Native target scene first · identity second');
  add('118', 'KSampler', { model: ['107', 0], positive: ['108', 0], negative: ['108', 1], latent_image: ['108', 2], seed: s.seed, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Native masked character edit · 25 steps');
  add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the generated edit');
  add('120', 'SplitImageWithAlpha', { image: ['119', 0] }, 'Explicit RGB photograph');
  add('155', 'SaveImage', { images: ['120', 0], filename_prefix: `recast/${job.id}/body_raw` }, 'Retain raw output before blending');
  let result: [string, number] = ['120', 0];
  if (s.qwenHeadRefine) {
    add('203', 'LoadImage', { image: u.face }, 'Tight original-reference face · no generated identity');
    add('206', 'LoraLoaderModelOnly', { model: ['102', 0], lora_name: QWEN_HEAD, strength_model: 1 }, 'Separate facial identity adapter · Qwen 2.1 BFS v1.1');
    add('208', 'TextEncodeQwenImage21', { clip: ['103', 0], prompt: 'head_swap: edit <image1>. Transfer only the recognizable facial identity from <image2>. Preserve the head position, apparent head size, head outline, viewing angle, gaze and expression of <image1>. Keep its existing hair arrangement, body, complete outfit, hands and background. Illuminate the face with the scene light of <image1>, retaining its exposure, color temperature, shadow direction and natural skin texture. Use <image2> for facial geometry and identity only.', negative_prompt: '', resolution: 0, 'images.image_1': ['120', 0], 'images.image_2': ['203', 0], vae: ['104', 0] }, 'Two-reference face pass · generated scene first');
    add('209', 'LoadImage', { image: u.faceMask }, 'Target-aligned facial refinement region');
    add('211', 'ImageToMask', { image: ['209', 0], channel: 'red' }, 'Local facial blend');
    add('218', 'KSampler', { model: ['206', 0], positive: ['208', 0], negative: ['208', 1], latent_image: ['208', 2], seed: s.seed + 1, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'Separate facial identity · 20 steps');
    add('219', 'VAEDecode', { samples: ['218', 0], vae: ['104', 0] }, 'Decode the facial refinement');
    add('220', 'SplitImageWithAlpha', { image: ['219', 0] }, 'Explicit RGB identity result');
    add('222', 'SaveImage', { images: ['220', 0], filename_prefix: `recast/${job.id}/head_raw` }, 'Retain identity output before local blending');
    add('221', 'ImageCompositeMasked', { destination: ['120', 0], source: ['220', 0], x: 0, y: 0, resize_source: false, mask: ['211', 0] }, 'Refine only the face on the generated person');
    result = ['221', 0];
  }
  add('126', 'ImageCrop', { image: result, width: g.contentWidth, height: g.contentHeight, x: g.x, y: g.y }, 'Remove only grid padding');
  add('127', 'ImageScale', { image: ['126', 0], upscale_method: 'lanczos', width: g.outputWidth, height: g.outputHeight, crop: 'disabled' }, 'Restore target dimensions without reframing');
  add('128', 'LoadImage', { image: u.original }, 'Original decoded scene pixels');
  add('129', 'LoadImage', { image: u.mask }, 'Final blend permission on the original canvas');
  add('130', 'ImageToMask', { image: ['129', 0], channel: 'red' }, 'White edits; black preserves original pixels');
  add('131', 'ImageCompositeMasked', { destination: ['128', 0], source: ['127', 0], x: 0, y: 0, resize_source: false, mask: ['130', 0] }, 'Blend the completed edit once');
  add('46', 'SaveImage', { images: ['131', 0], filename_prefix: `recast/${job.id}/segment_0000` }, 'Save one source-aligned photograph');
  return graph;
}
