import { z } from 'zod';
import type { UpscaleRun } from './upscale';
import type { CloudState } from './cloud';
import { defaultNegativePrompt, defaultPrompt } from './prompts';
import type { ModelsState } from './models';
import type { ImageDraft, ImageRun } from './image-replacement';
import type { ClipEditReceipt } from './clip-editor';
import type { Character } from './characters';
import { imagenRepaintProfileSchema } from './characters';
import type { ViggleRepaintRun } from './segment-repaint';
import { facialProfileSchema, type FacialConsistencyRun } from './facial-consistency';
import type { AnchoredVideoRun, AnchorChild } from './anchored-video';
import type { KieBootstrap, KieVideoRun } from './kie';

export const settingsSchema = z.object({
  engine: z.enum(['scail2', 'viggle']).default('scail2'),
  referencePreparation: z.enum(['auto', 'prepared']).default('auto'),
  referenceTime: z.number().finite().nonnegative().nullable().default(null),
  viggleQuality: z.enum(['fast', 'balanced']).default('fast'),
  viggleReferenceMode: z.enum(['previous', 'original']).default('previous'),
  facialConsistency: facialProfileSchema.default('off'),
  facialSceneMatch: z.boolean().default(true),
  facialFeatureCleanup: z.boolean().default(true),
  facialEyeCalibration: z.boolean().default(true),
  facialEyeFinish: z.boolean().default(false),
  facialBoundaryBlend: z.boolean().default(false),
  facialOcclusionTracking: z.boolean().default(false),
  imagenRepaint: imagenRepaintProfileSchema.nullable().default(null),
  imagenRepaintEnabled: z.boolean().default(false),
  mode: z.enum(['swap', 'motion']).default('swap'),
  prompt: z.string().trim().max(8000).default(''),
  negativePrompt: z.string().max(4000).default(defaultNegativePrompt),
  preset: z.enum(['fast', 'natural', 'quality12', 'quality16', 'quality']).default('natural'),
  resolution: z.enum(['480', '704', '720']).default('480'),
  orientation: z.enum(['source', 'portrait', 'landscape', 'square']).default('source'),
  fps: z.union([z.literal(16), z.literal(24), z.literal(30)]).default(24),
  seconds: z.number().min(0.2).max(30).default(3),
  start: z.number().min(0).default(0),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(20261024),
  randomSeed: z.boolean().default(false),
  relight: z.boolean().default(true),
  relightStrength: z.number().min(0).max(2).default(1),
  dpoStrength: z.number().min(0).max(2).default(1),
  sourcePerson: z.string().trim().min(1).max(500).default('person'),
  referencePerson: z.string().trim().min(1).max(500).default('person'),
  objectIndices: z.string().regex(/^\d+(\s*,\s*\d+)*$/, 'Use a person index such as 0.').default('0'),
  framesPerPass: z.union([z.literal(49), z.literal(81)]).default(81),
  loraA: z.string().max(300).default('None'),
  loraAStrength: z.number().min(-2).max(2).default(0.8),
  loraB: z.string().max(300).default('None'),
  loraBStrength: z.number().min(-2).max(2).default(0.8),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = settingsSchema.parse({ prompt: defaultPrompt(), facialOcclusionTracking: true });
export interface Asset { id: string; kind: 'video' | 'image'; name: string; path: string; width: number; height: number; duration: number; fps: number; size: number; hasAudio: boolean; poster: string; createdAt: string; sourceFrame?: { videoId: string; time: number }; maskFor?: string; }
export type JobStatus = 'queued' | 'running' | 'reconnecting' | 'interrupted' | 'completed' | 'failed' | 'cancelled';
export type FaceSwapMethod = 'direct' | 'source-performance';
export interface Progress { stage: string; node: string | null; value: number | null; max: number | null; unit: string; segment: number; segments: number; completedFrames: number; targetFrames: number; updatedAt: number; }
export interface Segment { promptId: string; frames: number; file: string; seconds: number; reference?: string; }
export interface ReferenceFraming {
  version: 'face-v1'; status: 'aligned'; width: number; height: number; anchorFrame: number;
  scale: number; translateX: number; translateY: number; preparedSha256: string; warnings: string[];
}
export interface FramingCheck {
  status: 'matched' | 'warning' | 'unverified'; warnings: string[]; samples: Record<string, unknown>[];
}
export interface Job {
  anchoredVideo?: AnchoredVideoRun;
  anchorChild?: AnchorChild;
  facialConsistency?: FacialConsistencyRun;
  kie?: KieVideoRun;
  id: string; title: string; status: JobStatus; settings: Settings; sourceId: string; referenceId: string;
  createdAt: string; startedAt?: string; finishedAt?: string; favorite: boolean; deleted: boolean;
  width: number; height: number; outputSize?: { width: number; height: number }; progress: Progress; segments: Segment[]; context: string;
  pendingPrompt: string | null; uploads: { source: string; reference: string; preparedFrame?: string; face?: string; clothing?: string; original?: string; mask?: string; noiseMask?: string; faceMask?: string; structure?: string; bodyMask?: string; bodyReference?: string; bodyAppearance?: string; bodyBase?: string; headReference?: string; repaintSegment?: number; sharedAnchor?: string } | null;
  error: string | null; output: string | null; poster: string | null; cancelRequested: boolean;
  cancellationConfirmed?: boolean; submitting?: boolean; retryRequired?: boolean;
  elapsedSeconds: number | null; origin: 'render' | 'import' | 'edit' | 'upscale' | 'api'; upscale?: UpscaleRun; workflow: Record<string, GraphNode> | null;
  edit?: ClipEditReceipt;
  hasWorkflow?: boolean;
  promptVersion?: 'scene-v1';
  framingVersion?: 'face-v1'; referenceFraming?: ReferenceFraming; framingCheck?: FramingCheck;
  renderVersion?: 'continuous-v1' | 'viggle-context124-v2'; saveDiagnosticLatent?: boolean;
  viggleSegmentation?: 'five-frame-v1' | 'last-frame-v2' | 'encoded-overlap-v3';
  viggleRepaint?: ViggleRepaintRun;
  continuationSource?: { jobId: string; frames: number };
  videoRecovery?: { generatedFrames: number; leadingHoldFrames: number; reason: 'trim-timestamp'; originalFailedNode: string; recoveredAt: string };
  faceRefinement?: { version: 'face-finish-v1' | 'face-source-v1'; parentJobId: string; referenceAssetId: string; execution: 'local CPU' | 'remote CUDA'; instanceId?: number; gpu?: string;
    method?: FaceSwapMethod; performanceSHA256?: string; performanceProfile?: string; performanceFrames?: number; fallbackFrames?: number;
    refinedFrames?: number; skippedFrames?: number; parentSHA256?: string; outputSHA256?: string };
  keyframe?: string; timings?: { node: string; stage: string; seconds: number }[];
  mediaType?: 'image'; image?: ImageRun;
}
export interface GraphNode { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string }; }
export type Graph = Record<string, GraphNode>;
export type Catalog = Record<string, { input: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }; output: string[] }>;
export interface Connection { state: 'offline' | 'connecting' | 'online'; endpoint: string; gpu: string | null; message: string; loras: string[]; checkedAt: string | null; }
export interface Draft { sourceId: string | null; referenceId: string | null; settings: Settings; }
export interface Bootstrap { kie?: KieBootstrap; assets: Asset[]; jobs: Job[]; draft: Draft; connection: Connection; cloud: CloudState; models: ModelsState; imageDraft?: ImageDraft; characters?: Character[]; capabilities?: { imagenSegmentRepaint: boolean }; }

function dimensionsAt(settings: Settings, source: Pick<Asset, 'width' | 'height'>, short: number, grid: number): [number, number] {
  let ratio = source.width / source.height;
  if (settings.orientation === 'portrait') ratio = 9 / 16;
  if (settings.orientation === 'landscape') ratio = 16 / 9;
  if (settings.orientation === 'square') ratio = 1;
  ratio = Math.max(0.5, Math.min(2, ratio));
  return ratio >= 1 ? [Math.round(short * ratio / grid) * grid, short] : [short, Math.round(short / ratio / grid) * grid];
}
export function geometry(settings: Settings, source: Pick<Asset, 'width' | 'height'>): [number, number] {
  return dimensionsAt(settings, source, Number(settings.resolution), settings.resolution === '720' ? 2 : 32);
}
export function renderGeometry(settings: Settings, source: Pick<Asset, 'width' | 'height'>): [number, number] {
  // SCAIL's half-resolution motion conditioning also needs patch alignment.
  // Render 720p exports above the target and downsample the whole frame once.
  return settings.resolution === '720' ? dimensionsAt(settings, source, 736, 32) : geometry(settings, source);
}
export function outputDimensions(job: Pick<Job, 'width' | 'height' | 'outputSize'>): [number, number] {
  return job.outputSize ? [job.outputSize.width, job.outputSize.height] : [job.width, job.height];
}
export function nextSegment(completed: number, target: number, cap = 81) {
  const overlap = completed ? 5 : 0;
  return { overlap, skip: Math.max(0, completed - overlap), cap: Math.min(cap, target - completed + overlap) };
}
export function segmentCount(target: number, cap: number) { return target <= cap ? 1 : 1 + Math.ceil((target - cap) / (cap - 5)); }
export const stageNames: Record<string, string> = {
  '1': 'Preparing shot', '2': 'Reading source video', '3': 'Preparing frames', '4': 'Reading character', '5': 'Preparing reference',
  '6': 'Loading tracker', '7': 'Describing source person', '8': 'Describing character', '9': 'Tracking source person', '10': 'Tracking character',
  '11': 'Building identity masks', '12': 'Saving mask preview', '13': 'Checking character mask', '20': 'Loading video model',
  '21': 'Applying detail adapter', '22': 'Applying LoRA A', '23': 'Applying LoRA B', '24': 'Preparing acceleration', '25': 'Preparing sampler',
  '30': 'Loading text encoder', '31': 'Encoding prompt', '32': 'Encoding negative prompt', '33': 'Loading vision encoder', '34': 'Encoding character',
  '35': 'Loading video decoder', '36': 'Loading continuity', '40': 'Encoding motion', '41': 'Preparing sampler', '42': 'Preparing schedule',
  '43': 'Generating video', '44': 'Decoding video', '45': 'Aligning frames and audio', '46': 'Exporting segment', '47': 'Saving continuity', '48': 'Finishing segment', '50': 'Applying relighting', '51': 'Saving diagnostic sample',
  '52': 'Preparing 720p export',
};
