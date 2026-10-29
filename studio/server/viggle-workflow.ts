import type { Graph, Job } from '../shared/types';
import { engineIssue, repaintPrompt, viggleSigmas } from '../shared/engines';
import { viggleWindow, viggleWindows } from '../shared/viggle-segments';

export const VIGGLE_MODEL = 'minimax_h3_ref2va_viggle_pruned_int8_convrot.safetensors';
export const VIGGLE_DMD = 'viggle_animate_dmd_lora.safetensors';
export const VIGGLE_VAE = 'minimax_h3_video_vae_int8_convrot.safetensors';

// Self-contained native Comfy graph: no API services, pose tracker, SAM model,
// generic style adapter, hidden second sample, or separately shifted sigmas.
export function compileViggleWorkflow(job: Job): Graph {
  const issue = engineIssue(job.settings); if (issue) throw new Error(issue);
  if (!job.uploads) throw new Error('Inputs have not been transferred.');
  const encodedOverlap = job.viggleSegmentation === 'encoded-overlap-v3';
  const segmented = !!job.viggleSegmentation, previousReference = job.viggleSegmentation === 'last-frame-v2' || encodedOverlap;
  if (!segmented && (job.progress.completedFrames || job.progress.targetFrames > 124)) throw new Error('Viggle requires a fresh single shot of at most 124 frames.');
  const plan = segmented ? viggleWindow(job.progress.completedFrames, job.progress.targetFrames) : { skip: 0, cap: job.progress.targetFrames, overlap: 0 };
  const continuing = plan.overlap > 0;
  if (continuing && !job.context) throw new Error('The saved Viggle continuation anchor is missing. No new segment was submitted.');
  if (continuing && !previousReference && job.settings.referencePreparation !== 'prepared' && !job.uploads.preparedFrame) throw new Error('The original repainted frame must be restored before continuing.');
  if (job.saveDiagnosticLatent) throw new Error('Viggle exports its conditioning frame and video. SCAIL latent diagnostics are not supported by this engine.');
  if (job.width % 32 || job.height % 32) throw new Error('Viggle render dimensions must be multiples of 32.');
  const s = job.settings, graph: Graph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>, title: string) => { graph[id] = { class_type, inputs, _meta: { title } }; };
  const prefix = `recast/${job.id}/segment_${String(job.segments.length).padStart(4, '0')}`;
  add('2', 'VHS_LoadVideo', { video: job.uploads.source, force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: plan.cap, skip_first_frames: plan.skip, select_every_nth: 1, format: 'None' }, 'Read the selected source window at 24 fps');
  add('3', 'RecastViggleSource', { images: ['2', 0], width: job.width, height: job.height }, 'Fit the source without cropping and pad the H3 frame grid');
  if (continuing && job.viggleRepaint) {
    if (!job.uploads.preparedFrame || job.uploads.repaintSegment !== job.segments.length || !job.viggleRepaint.records.some(record => record.segment === job.segments.length + 1 && ['completed', 'skipped'].includes(record.status) && record.referenceSHA256)) throw new Error('The matching Imagen segment reference is not ready. No video segment was submitted.');
    add('4', 'LoadImage', { image: job.uploads.preparedFrame }, 'Use this segment’s saved Imagen facial identity refresh');
  }
  else if (continuing && previousReference) add('4', encodedOverlap ? 'RecastViggleEncodedReference' : 'RecastViggleContextReference', { context_path: job.context, width: job.width, height: job.height, fps: 24, skip_frames: plan.skip, overlap: plan.overlap, job_id: job.id }, 'Use the previous segment’s last generated frame as appearance reference');
  else add('4', 'LoadImage', { image: continuing ? job.uploads.preparedFrame || job.uploads.reference : job.uploads.reference }, 'Read character appearance');
  let reference: [string, number] = ['4', 0];
  if (s.referencePreparation !== 'prepared' && !continuing) {
    // Prepare at roughly one megapixel, retaining the source aspect ratio.
    const scale = Math.max(1, Math.sqrt(1_000_000 / (job.width * job.height)));
    const width = Math.round(job.width * scale / 32) * 32, height = Math.round(job.height * scale / 32) * 32;
    add('100', 'ImageScale', { image: ['3', 2], upscale_method: 'lanczos', width, height, crop: 'disabled' }, 'Source frame controls composition');
    add('101', 'ImageScaleToTotalPixels', { image: ['4', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 32 }, 'Keep the appearance reference within one megapixel');
    add('102', 'UNETLoader', { unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' }, 'Load FLUX.2 Klein 4B distilled');
    add('103', 'CLIPLoader', { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' }, 'Load the image-edit instruction encoder');
    add('104', 'VAELoader', { vae_name: 'flux2-vae.safetensors' }, 'Load the image VAE');
    add('105', 'CLIPTextEncode', { clip: ['103', 0], text: repaintPrompt(s) }, 'Preserve source pose, geometry and lighting');
    add('106', 'ConditioningZeroOut', { conditioning: ['105', 0] }, 'Klein zero conditioning');
    add('107', 'VAEEncode', { pixels: ['100', 0], vae: ['104', 0] }, 'Encode source frame as reference one');
    add('108', 'VAEEncode', { pixels: ['101', 0], vae: ['104', 0] }, 'Encode character as reference two');
    add('109', 'ReferenceLatent', { conditioning: ['105', 0], latent: ['107', 0] }, 'Source frame first');
    add('110', 'ReferenceLatent', { conditioning: ['106', 0], latent: ['107', 0] }, 'Source frame first, zero condition');
    add('111', 'ReferenceLatent', { conditioning: ['109', 0], latent: ['108', 0] }, 'Character appearance second');
    add('112', 'ReferenceLatent', { conditioning: ['110', 0], latent: ['108', 0] }, 'Character appearance second, zero condition');
    add('113', 'CFGGuider', { model: ['102', 0], positive: ['111', 0], negative: ['112', 0], cfg: 1 }, 'Distilled image guidance, CFG 1');
    add('114', 'EmptyFlux2LatentImage', { width, height, batch_size: 1 }, 'Replacement frame at source aspect ratio');
    add('115', 'Flux2Scheduler', { steps: 4, width, height }, 'Four-step Klein schedule');
    add('116', 'RandomNoise', { noise_seed: s.seed }, 'Reproducible replacement frame');
    add('117', 'KSamplerSelect', { sampler_name: 'euler' }, 'Euler image sampler');
    add('118', 'SamplerCustomAdvanced', { noise: ['116', 0], guider: ['113', 0], sampler: ['117', 0], sigmas: ['115', 0], latent_image: ['114', 0] }, 'Repaint the source frame in four steps');
    add('119', 'VAEDecode', { samples: ['118', 0], vae: ['104', 0] }, 'Decode the replacement frame');
    add('120', 'ImageScale', { image: ['119', 0], upscale_method: 'lanczos', width: job.width, height: job.height, crop: 'disabled' }, 'Return the reference to the exact source canvas');
    reference = ['120', 0];
  }
  add('121', 'SaveImage', { images: reference, filename_prefix: prefix + '_keyframe' }, 'Save the actual conditioning frame for review');
  add('20', 'UNETLoader', { unet_name: VIGGLE_MODEL, weight_dtype: 'default' }, 'Load Viggle pruned INT8');
  add('24', 'LoraLoaderModelOnly', { model: ['20', 0], lora_name: VIGGLE_DMD, strength_model: 1 }, 'Apply Viggle’s matching full-rank distillation adapter');
  add('25', 'MiniMaxH3SigmaShift', { model: ['24', 0], shift_video: 3, shift_audio: 3 }, 'H3 video/audio shift 3');
  add('30', 'ViggleTextCondLoader', { text_cond: 'fixed_embed_fwd_anyframe.safetensors' }, 'Load frozen video conditioning, without a text encoder');
  add('35', 'VAELoader', { vae_name: VIGGLE_VAE }, 'Load H3 video VAE');
  // The pinned SaveImage returns IMAGE. Passing through it guarantees that
  // this intermediate is saved before any paid temporal sampling begins.
  add('40', 'ViggleAnimateConditioning', { cond_video: ['3', 0], ref_image: ['121', 0], text_cond: ['30', 0], vae: ['35', 0], width: job.width, height: job.height, length: 124 }, 'Video-first source-aligned conditioning');
  if (continuing) {
    if (encodedOverlap) add('36', 'RecastViggleEncodedAnchor', { latent: ['40', 1], context_path: job.context, width: job.width, height: job.height, fps: 24, skip_frames: plan.skip, overlap: plan.overlap, job_id: job.id }, 'Preserve every accepted overlap latent');
    else add('36', 'RecastViggleAnchor', { latent: ['40', 1], vae: ['35', 0], context_path: job.context, width: job.width, height: job.height, fps: 24, skip_frames: plan.skip, overlap: plan.overlap, job_id: job.id, ...(previousReference ? { context_version: 'last-frame-v2' } : {}) }, 'Restore the saved five-frame continuation anchor');
  }
  add('31', 'BasicGuider', { model: ['25', 0], conditioning: ['40', 0] }, 'One model evaluation per sigma interval');
  add('38', 'RandomNoise', { noise_seed: segmented ? (s.seed + job.segments.length) % Number.MAX_SAFE_INTEGER : s.seed }, 'Reproducible video noise');
  add('41', 'KSamplerSelect', { sampler_name: 'euler' }, 'Euler distilled video sampler');
  add('42', 'ManualSigmas', { sigmas: viggleSigmas(s) }, 'Exact shifted sigma boundaries; do not shift again');
  add('43', 'SamplerCustomAdvanced', { noise: ['38', 0], guider: ['31', 0], sampler: ['41', 0], sigmas: ['42', 0], latent_image: continuing ? ['36', 0] : ['40', 1] }, 'Propagate replacement through the source motion');
  add('44', 'VAEDecode', { samples: ['43', 0], vae: ['35', 0] }, 'Decode the complete replacement shot');
  add('45', 'SwapFinalizeShot', { images: ['44', 0], source_count: ['3', 1], overlap: plan.overlap, fps: 24, audio: ['2', 2] }, 'Trim grid padding and accepted overlap; preserve source timing');
  add('46', 'VHS_VideoCombine', { images: ['45', 0], audio: ['45', 1], frame_rate: 24, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true }, 'Export the replacement at native 24 fps');
  if (segmented) {
    const windows = viggleWindows(job.progress.targetFrames), next = windows[job.segments.length + 1];
    if (encodedOverlap) add('47', 'RecastViggleSaveEncodedContext', { images: ['45', 2], vae: ['35', 0], fps: 24, skip_frames: plan.skip, next_skip_frames: next?.skip ?? plan.skip + plan.cap - 5, job_id: job.id, ...(!next ? { terminal: true } : {}) }, next ? 'Encode the complete next overlap and save its raw appearance' : 'Record final video completion without an unused continuation');
    else add('47', 'RecastViggleSaveContext', { images: ['45', 2], fps: 24, skip_frames: plan.skip, next_skip_frames: next?.skip ?? plan.skip + plan.cap - 5, job_id: job.id, ...(!next ? { terminal: true } : {}), ...(previousReference ? { version: 'last-frame-v2' } : {}) }, next ? 'Save the next exact anchor and segment receipt' : 'Record final video completion without an unused continuation');
  } else add('47', 'SwapSaveContext', { images: ['45', 2], fps: 24, skip_frames: 0 }, 'Save completion receipt and source count');
  if (job.outputSize) {
    add('52', 'ImageScale', { image: ['45', 0], upscale_method: 'lanczos', width: job.outputSize.width, height: job.outputSize.height, crop: 'disabled' }, 'Export exact HD dimensions');
    graph['46'].inputs.images = ['52', 0];
  }
  return graph;
}
