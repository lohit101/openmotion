import base from '../../config/models.lock.json';
import relight from '../../config/optional-models.lock.json';
import natural from '../../config/natural-models.lock.json';
import extras from '../../config/extra-models.lock.json';
import setup from '../../config/setup-models.json';
import viggle from '../../config/viggle-models.lock.json';
import repaint from '../../config/repaint-models.lock.json';
import imageAdapters from '../../config/image-adapters.lock.json';
import qwenImage from '../../config/qwen-image-models.lock.json';
import imageEditModels from '../../config/image-edit-models.lock.json';
import openjutsuModels from '../../config/openjutsu-models.lock.json';
import imageControls from '../../config/image-controls.lock.json';
import upscaleModels from '../../config/upscale-models.lock.json';
import facialModels from '../../config/facial-consistency-models.lock.json';
import facialCleanupModels from '../../config/facial-consistency-cleanup-models.lock.json';
import facialEyeFinishModels from '../../config/facial-consistency-eye-finish-models.lock.json';
import facialOcclusionModels from '../../config/facial-consistency-occlusion-models.lock.json';
import { facialVersionForSettings, usesFacialConsistency, isCleanupFacialVersion, isEyeFinishedFacialVersion, isOcclusionTrackedFacialVersion } from './facial-consistency';
import { videoDirectionFrames } from './anchored-video';
import { isViggle } from './engines';
import type { Catalog, Settings } from './types';
import type { ImageSettings } from './image-replacement';
import { usesSpeedAdapter } from './sampling';

export const RELIGHT = 'wan2.1_SCAIL_2_relight_lora_bf16.safetensors';
export const NATURAL_SPEED = 'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors';
export const I2V_SPEED = 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors';
export const DPO = 'wan2.1_SCAIL_2_DPO_lora_bf16.safetensors';
export const SOCIAL_STYLE = 'Instagoon-v1-step00001400.safetensors';
const scailModels = [...base.files, ...relight.files, ...natural.files, ...extras.files];
const contentFilterWeight = (destination: string) => /(?:^|\/)nsfw_\d+\./.test(destination);
export const pinnedModels = [...scailModels, ...viggle.files, ...repaint.files, ...imageAdapters.files, ...qwenImage.files, ...imageControls.files, ...imageEditModels.files, ...openjutsuModels.files, ...facialModels.files, ...facialCleanupModels.files, ...facialEyeFinishModels.files, ...facialOcclusionModels.files, ...upscaleModels.files].filter(file => !contentFilterWeight(file.destination));
export const upscaleModelFiles = upscaleModels.files.map(file => file.destination);
export const facialModelFiles = facialModels.files.map(file => file.destination).filter(id => !contentFilterWeight(id));
export const facialCleanupModelFiles = facialCleanupModels.files.map(file => file.destination);
export const facialEyeFinishModelFiles = facialEyeFinishModels.files.map(file => file.destination);
export const facialOcclusionModelFiles = facialOcclusionModels.files.map(file => file.destination);
export const viggleToolNodes = ['RecastViggleSource124', 'RecastViggleSaveSharedAnchor', 'RecastViggleSharedAnchor'] as const;
export const hasViggleTools = (catalog?: Catalog | null) => !!catalog && viggleToolNodes.every(name => !!catalog[name]);
export const facialFilesForSettings = (settings: { facialSceneMatch?: boolean; facialFeatureCleanup?: boolean; facialConsistency?: Settings['facialConsistency']; facialEyeCalibration?: boolean; facialEyeFinish?: boolean; facialBoundaryBlend?: boolean; facialOcclusionTracking?: boolean }) =>
  [...facialModelFiles, ...(isCleanupFacialVersion(facialVersionForSettings(settings)) ? facialCleanupModelFiles : []),
    ...(isEyeFinishedFacialVersion(facialVersionForSettings(settings)) ? facialEyeFinishModelFiles : []),
    ...(isOcclusionTrackedFacialVersion(facialVersionForSettings(settings)) ? facialOcclusionModelFiles : [])];
export const modelWorkingReserve = (files: string[]) => (files.some(file => file.startsWith('upscale/')) ? 15 : 5) * 1024 ** 3 + (files.some(file => file.startsWith('face_consistency/')) ? 512 * 1024 ** 2 : 0);
export const setupModelFiles: string[] = setup.files;
export const imageModelFiles = repaint.files.map(file => file.destination);
export const IMAGE_IDENTITY = 'bfs_head_v1_flux-klein_4b.safetensors';
export const qwenImageModelFiles = qwenImage.files.map(file => file.destination);
export const QWEN_STRUCTURE = 'model_patches/qwen_image_2.1_fun_controlnet_union.safetensors';
export const QWEN_BODY = 'bfs_body_swap_v1.0_qwen_2.1.safetensors';
export const QWEN_HEAD = 'bfs_head_v1.1_qwen_2.1.safetensors';
export const QWEN_OUTFIT = 'qwen-image-2.1-outfit-swap.safetensors';
export const QWEN_CONSISTENCY = 'qwen-image-2.1-consistency.safetensors';
export const imageFilesForSettings = (settings: ImageSettings): string[] => settings.workflow
  ? qwenImageModelFiles.filter(file => !file.startsWith('loras/') || settings.qwenQuality === 'fast' && file.includes('turbo_lora'))
  : settings.model === 'qwen21'
  ? settings.qwenRecipe === 'clothing-only'
    ? qwenImageModelFiles.filter(file => !file.startsWith('loras/') || settings.qwenQuality === 'fast' && file.includes('turbo_lora'))
    : settings.qwenRecipe === 'body-only'
    ? settings.bodyOnlyStrategy === 'staged'
      ? [...qwenImageModelFiles.filter(file => !file.startsWith('loras/')), 'loras/' + QWEN_BODY, 'loras/' + QWEN_OUTFIT, 'loras/' + QWEN_HEAD, ...(settings.bodyOnlyPose ? [QWEN_STRUCTURE] : [])]
      : [...qwenImageModelFiles.filter(file => !file.startsWith('loras/') || !settings.bodyOnlyReuseId && settings.qwenQuality === 'fast' && file.includes('turbo_lora')), ...(settings.bodyOnlyStrategy === 'detail' ? ['loras/' + QWEN_HEAD] : [])]
    : settings.qwenRecipe === 'body-identity'
    ? [...qwenImageModelFiles.filter(file => !file.startsWith('loras/')), 'loras/' + QWEN_BODY, 'loras/' + QWEN_HEAD, ...(settings.qwenBodyPose ? [QWEN_STRUCTURE] : []), ...(settings.qwenRelight ? ['loras/' + QWEN_CONSISTENCY] : [])]
    : settings.qwenRecipe === 'identity-first'
    ? [...qwenImageModelFiles.filter(file => !file.startsWith('loras/')), 'loras/' + QWEN_HEAD, 'loras/' + QWEN_OUTFIT, ...(settings.qwenRelight ? ['loras/' + QWEN_CONSISTENCY] : [])]
    : ['native-masked', 'native-scene'].includes(settings.qwenRecipe)
    ? [...qwenImageModelFiles.filter(file => !file.startsWith('loras/')), ...(settings.qwenHeadRefine ? ['loras/' + QWEN_HEAD] : [])]
    : settings.qwenRecipe === 'source-anchored'
    ? [...qwenImageModelFiles.filter(file => settings.qwenQuality === 'fast' || !file.includes('turbo_lora')), ...(settings.structureStrength > 0 ? [QWEN_STRUCTURE] : []), ...(settings.qwenHeadRefine ? ['loras/' + QWEN_HEAD] : []), ...(settings.qwenRelight ? ['loras/' + QWEN_CONSISTENCY] : [])]
    : qwenImageModelFiles
  : [...imageModelFiles, ...(settings.identityRefine ? ['loras/' + IMAGE_IDENTITY] : [])];
const filename = (destination: string) => destination.split('/').at(-1)!;

// Describe requirements only. Selection never initiates a download.
export function modelFilesForSettings(s: Settings): string[] {
  if (isViggle(s)) return [...new Set([...viggle.files.map(file => file.destination), ...(usesFacialConsistency(s) ? facialFilesForSettings(s) : []), ...(s.referencePreparation === 'prepared' ? [] : repaint.files.map(file => file.destination)), ...(s.imagenRepaintEnabled && s.imagenRepaint && videoDirectionFrames(s, true).some(frames => frames > 124) ? qwenImageModelFiles.filter(file => !file.startsWith('loras/') || file.includes('turbo_lora')) : [])])];
  const adapters = new Set<string>();
  if (s.dpoStrength > 0) adapters.add(DPO);
  if (usesSpeedAdapter(s.preset)) adapters.add(s.preset === 'natural' && s.mode === 'swap' ? NATURAL_SPEED : I2V_SPEED);
  if (s.relight && s.mode === 'swap' && s.relightStrength > 0) adapters.add(RELIGHT);
  for (const name of [s.loraA, s.loraB]) if (name !== 'None') adapters.add(name);
  return scailModels.filter(file => !file.destination.startsWith('loras/') || adapters.has(filename(file.destination)))
    .map(file => file.destination);
}

export function presetModelFiles(preset: Settings['preset'], mode: Settings['mode']): string[] {
  return usesSpeedAdapter(preset) ? ['loras/' + (preset === 'natural' && mode === 'swap' ? NATURAL_SPEED : I2V_SPEED)] : [];
}

const descriptions: Record<string, [string, string, 'core' | 'adapter' | 'feature']> = {
  'codeformer.onnx': ['Eye detail restoration · beta', 'Optional 35% eye-interior restoration after calibrated facial finishing. Does not repaint hair, body or scene.', 'feature'],
  'face_landmarker.task': ['Source eye-position observer · beta', 'Optional bounded source-driven eye placement using the replacement character’s own pixels. Runs on the managed host CPU.', 'feature'],
  'bisenet_resnet_34.onnx': ['Facial feature cleanup masks', 'Identifies complete eyes, eyebrows and mouth while protecting target hair, glasses and scene. Used only by facial feature cleanup.', 'feature'],
  'landmark203.onnx': ['Partial-face tracker · beta', 'Tracks a visible eye through a partial face occlusion. Used only by foreground tracking; downloaded explicitly.', 'feature'],
  'palm_detection_mediapipe_2023feb.onnx': ['Hand detector · beta', 'Finds foreground hands for the optional facial tracking pass. Downloaded only when selected.', 'feature'],
  'handpose_estimation_mediapipe_2023feb.onnx': ['Hand landmarks · beta', 'Helps identify foreground hand geometry before facial finishing. Downloaded only when selected.', 'feature'],
  'sam2.1_hiera_tiny.pt': ['Foreground hand masks · SAM 2.1 Tiny', 'Tracks hand masks so the facial pass can retain covered video pixels. Optional beta tracking files and runtime are prepared explicitly.', 'feature'],
  'minimax_h3_ref2va_viggle_pruned_int8_convrot.safetensors': ['Viggle Animate INT8', 'Propagates a source-aligned character edit through the video', 'core'],
  'viggle_animate_dmd_lora.safetensors': ['Viggle distillation adapter', 'Required matching accelerator for the three-pass video recipe', 'adapter'],
  'fixed_embed_fwd_anyframe.safetensors': ['Viggle fixed conditioning', 'Tiny precomputed video conditioning; no video text encoder download', 'core'],
  'minimax_h3_video_vae_int8_convrot.safetensors': ['H3 video encoder / decoder', 'Encodes the source video and decodes the replacement', 'core'],
  'flux-2-klein-4b-fp8.safetensors': ['FLUX.2 Klein 4B', 'Four-step source-frame character replacement before animation', 'core'],
  'qwen_3_4b.safetensors': ['Klein text encoder', 'Reads the instruction used to prepare the replacement frame', 'core'],
  [IMAGE_IDENTITY]: ['Klein identity refinement · BFS', 'Trained head-swap adapter for a separate four-step facial identity pass. Klein 4B only.', 'adapter'],
  'qwen_image_2.1_int8_convrot.safetensors': ['Qwen Image 2.1 INT8', 'Image editor shared by whole-person editing and source-anchored inpainting', 'core'],
  'qwen3vl_8b_int8_convrot.safetensors': ['Qwen 2.1 vision-language encoder', 'Reads both the scene and replacement person for the Qwen image recipe', 'core'],
  'qwen_image_2.1_vae_bf16.safetensors': ['Qwen 2.1 image encoder / decoder', 'Matching Qwen image latent and RGB/alpha decoder', 'core'],
  'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors': ['Qwen 2.1 eight-step adapter', 'Matching official accelerator for the Qwen image recipe', 'adapter'],
  'bfs_body_swap_v1.0_qwen_2.1.safetensors': ['Qwen whole-person swap · BFS', 'Trained body and outfit transfer. The unconstrained recipe failed exact framing in our comparison.', 'adapter'],
  'qwen_image_2.1_fun_controlnet_union.safetensors': ['Qwen source geometry & inpainting', 'Constrains source structure and the selected edit area during generation', 'core'],
  [QWEN_HEAD]: ['Qwen head identity · BFS v1.1', 'Separate masked head pass; matching Qwen 2.1 adapter with reduced skin softening', 'adapter'],
  [QWEN_OUTFIT]: ['Qwen outfit consistency', 'Separate clothing pass that aims to preserve the established face and scene', 'adapter'],
  [QWEN_CONSISTENCY]: ['Qwen edit consistency', 'Optional lighting pass on the established character; does not guarantee identity or alignment', 'adapter'],
  'flux2-vae.safetensors': ['Klein image encoder / decoder', 'Image encoding for the source frame and character reference', 'core'],
  'wan2.1_14B_SCAIL_2_int8_convrot.safetensors': ['SCAIL-2 INT8', 'Character replacement and motion generation', 'core'],
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors': ['Text encoder', 'Reads the positive and negative prompts', 'core'],
  'clip_vision_h.safetensors': ['Reference encoder', 'Reads your character reference image', 'core'],
  'Wan2_1_VAE_bf16.safetensors': ['Video encoder / decoder', 'Converts frames to and from model latents', 'core'],
  'sam3.1_multiplex_fp16.safetensors': ['Person tracker', 'Tracks the character and builds replacement masks', 'core'],
  [DPO]: ['Detail adapter', 'SCAIL-2 DPO: character detail, eyes and hands', 'adapter'],
  [I2V_SPEED]: ['Fast / motion acceleration', 'Fast 6-step generation; also used by Natural in Motion transfer', 'adapter'],
  [NATURAL_SPEED]: ['Natural / swap acceleration', 'Natural 8-step Character swap', 'adapter'],
  [RELIGHT]: ['Character relighting', 'Matches the replacement to source lighting and shadows', 'adapter'],
  [SOCIAL_STYLE]: ['Social media style · Instagooner', 'Casual influencer / phone-camera aesthetics. Video quality on SCAIL-2 is untested.', 'adapter'],
};
const facialLabels: Record<string, string> = { 'appearance_feature_extractor.onnx': 'PerformRecast appearance', 'motion_extractor.onnx': 'PerformRecast facial motion', 'warping_module.onnx': 'PerformRecast motion warping', 'spade_generator.onnx': 'PerformRecast face decoder', 'hyperswap_1a_256.onnx': 'ONNX identity swap · Hyperswap', 'arcface_w600k_r50.onnx': 'Face reference encoder', '2dfan4.onnx': 'Facial landmarks', 'yunet_2023_mar.onnx': 'Face detector', 'xseg_1.onnx': 'Face occlusion masks' };
export const modelDefinitions = pinnedModels.map(file => {
  const facial = [...facialModels.files, ...facialCleanupModels.files, ...facialEyeFinishModels.files, ...facialOcclusionModels.files].some(item => item.destination === file.destination);
  const [label, description, group] = (openjutsuModels.files.some(item => item.destination === file.destination) ? [filename(file.destination), 'Remotion OpenJutsu model component. Uses the copied native Simple motion-transfer workflow.', file.destination.startsWith('loras/') ? 'adapter' as const : 'core' as const] as const : undefined) || (imageEditModels.files.some(item => item.destination === file.destination) ? [filename(file.destination).includes('2511_int8') ? 'Qwen Image Edit 2511 · compact INT8' : filename(file.destination).includes('2511_bf16') ? 'Qwen Image Edit 2511 · BF16' : filename(file.destination).includes('Lightning') ? '2511 four-step Lightning adapter' : filename(file.destination).includes('vl_7b') ? '2511 vision-language encoder' : '2511 image encoder / decoder', 'Dedicated Image Edit 2511 dependency. Downloaded only when selected.', file.destination.startsWith('loras/') ? 'adapter' as const : 'core' as const] as const : undefined) || (file.destination.startsWith('upscale/') ? [filename(file.destination) === 'dit.safetensors' ? 'FlashVSR+ Turbo transformer' : filename(file.destination) === 'TCDecoder.ckpt' ? 'FlashVSR+ video decoder' : 'FlashVSR+ input conditioning', 'Clarity video upscaling. Optional; never downloaded by selection or inference.', 'feature' as const] as const : undefined) || descriptions[filename(file.destination)] || [facialLabels[filename(file.destination)] || filename(file.destination), 'Source-driven facial consistency dependency. Shared by Standard and Regional, with a 60% identity blend.', 'feature' as const];
  const engine = openjutsuModels.files.some(item => item.destination === file.destination) ? 'openjutsu' : imageEditModels.files.some(item => item.destination === file.destination) ? 'image-edit' : file.destination.startsWith('upscale/') ? 'upscale' : facial ? 'facial' : viggle.files.some(item => item.destination === file.destination) ? 'viggle' : [...repaint.files, ...imageAdapters.files, ...qwenImage.files, ...imageControls.files].some(item => item.destination === file.destination) ? 'repaint' : 'scail2';
  return { id: file.destination, filename: filename(file.destination), size: file.size, label, description, group,
    engine, included: group === 'core', experimental: filename(file.destination) === SOCIAL_STYLE || facialOcclusionModelFiles.includes(file.destination),
    trigger: filename(file.destination) === SOCIAL_STYLE ? 'instag00n' : '',
    source: filename(file.destination) === SOCIAL_STYLE ? extras.files[0].source : '' };
});
// Retain catalog metadata for inventories and immutable historical workflows.
// Retirement only removes new provisioning and creation affordances.
const currentModelIds = new Set([...openjutsuModels.shared.map(destination=>({destination})),...viggle.files, ...repaint.files, ...imageAdapters.files, ...qwenImage.files, ...imageControls.files, ...imageEditModels.files, ...openjutsuModels.files, ...facialModels.files, ...facialCleanupModels.files, ...facialEyeFinishModels.files, ...facialOcclusionModels.files, ...upscaleModels.files].map(file => file.destination));
const retiredModelIds = new Set(scailModels.map(file => file.destination).filter(id => !currentModelIds.has(id)));
export const isRetiredModel = (id: string) => retiredModelIds.has(id);
export const downloadableModelDefinitions = modelDefinitions.filter(file => !isRetiredModel(file.id));
export function assertDownloadableModelFiles(files: string[]) {
  if (files.some(isRetiredModel)) throw new Error('SCAIL-2 / Wan is retired. Its existing files and saved runs are kept; new downloads are disabled.');
}
export type ModelStatus = 'unknown' | 'missing' | 'queued' | 'downloading' | 'reconnecting' | 'installed' | 'failed';
export interface ModelTransfer { downloaded: number; total: number; bytesPerSecond?: number; phase?: string; remoteActive?: boolean; }
export interface ModelFileState { id: string; status: ModelStatus; percent: number | null; message: string; error: string | null; downloaded?: number; total?: number; bytesPerSecond?: number; remoteActive?: boolean; }
export type DownloadModule = 'remotion' | 'openjutsu' | 'imagen' | 'image-edit' | 'clarity';
export interface ModuleDownloadPlan { module:DownloadModule; key:string; files:string[]; runtimes:string[]; }
export interface ModuleDownloadState extends ModuleDownloadPlan { instanceId:number; endpoint:string; transferFiles:string[]; status:'downloading'|'preparing'|'reconnecting'|'complete'|'failed'|'cancelled'; message:string; error:string|null; updatedAt:number; runtimePercent?:number; activeRuntime?:string; }
export interface InstalledLora { name: string; size: number; partialSize?: number; included: boolean; }
export interface ModelInventoryFile { id: string; size: number; partialSize: number; measured: boolean; }
export interface ModelInventory { key: string; instanceId: number | null; endpoint: string; gpu: string | null; checkedAt: string; files: ModelInventoryFile[]; freeBytes?: number; }
export interface ModelsState { files: ModelFileState[]; busy: boolean; refreshing: boolean; error: string | null; checkedAt: string | null; installedLoras: InstalledLora[]; deleting: string | null; diskFreeBytes?: number; inventories?: ModelInventory[]; openjutsuToolsReady?: boolean; viggleToolsReady?: boolean; facialRuntimeReady?: boolean; facialCleanupRuntimeReady?: boolean; facialCalibratedRuntimeReady?: boolean; facialEyeFinishRuntimeReady?: boolean; facialGeometryRuntimeReady?: boolean; facialBoundaryRuntimeReady?: boolean; facialOcclusionRuntimeReady?: boolean; facialPreparing?:boolean; moduleSetup?:ModuleDownloadState; transferInstanceId?:number; transferEndpoint?:string; transferStartedAt?:number; transferFiles?:string[]; localIdentityReady?:boolean; localPoseReady?:boolean; }
export const emptyModels = (): ModelsState => ({ files: modelDefinitions.map(file => ({ id: file.id, status: 'unknown', percent: null, message: '', error: null })), busy: false, refreshing: false, error: null, checkedAt: null, installedLoras: [], deleting: null });

export function modelBytes(files: string[]): number {
  const selected = new Set(files);
  if (files.some(name => !pinnedModels.some(file => file.destination === name))) throw new Error('Unknown setup model.');
  return pinnedModels.filter(file => selected.has(file.destination)).reduce((total, file) => total + file.size, 0);
}
