import { z } from 'zod';

export const upscaleSettingsSchema = z.object({
  height: z.union([z.literal(720), z.literal(1080)]).default(720),
  motion: z.enum(['fast', 'detail']).default('fast'),
  matchColors: z.boolean().default(true),
  processing: z.enum(['native', 'fast1080']).optional(),
}).strict();
export type UpscaleSettings = z.infer<typeof upscaleSettingsSchema>;
export const upscaleSourceSchema = z.object({ jobId: z.string().uuid().optional(), assetId: z.string().uuid().optional() }).strict()
  .refine(v => !!v.jobId !== !!v.assetId, 'Choose exactly one uploaded or library video.');
export type UpscaleSource = z.infer<typeof upscaleSourceSchema>;
export const upscaleRequestSchema = z.object({ source: upscaleSourceSchema, settings: upscaleSettingsSchema, requestKey: z.string().uuid() }).strict();
export interface UpscaleRun {
  version: 'clarity-flashvsr-turbo-v1' | 'clarity-flashvsr-turbo-v2' | 'clarity-flashvsr-turbo-v3'; model: 'FlashVSR+ Turbo'; settings: UpscaleSettings;
  source: UpscaleSource; sourceTitle: string; sourceSHA256: string; sourceWidth: number; sourceHeight: number;
  instanceId: number; profileSHA256: string; fps: string; frames: number;
  outputWidth: number; outputHeight: number; workWidth: number; workHeight: number; padX: number; padY: number;
  processingGeometry?: ReturnType<typeof upscaleGeometry>;
  remoteActive: boolean; cancellationConfirmed?: boolean; progress: number; stage: string;
  outputSHA256?: string; workerSeconds?: number; attention?: string;
  workerTotalSeconds?: number; phaseSeconds?: Record<string,number>;
  execution?: {input:string;inputTransport?:string;cpuThreads:number;modelWidth?:number;modelHeight?:number;colorCUDAFrames?:number;colorCPUFrames?:number;colorOOMFallbacks?:number};
}
export interface UpscaleTools { ready: boolean; available: boolean; preparing: boolean; processing?: boolean; missing: string[]; modelBytes: number; runtimeReserveBytes: number; instanceId?: number; profileSHA256?: string; error?: string; }
export function upscaleGeometry(width: number, height: number, target: number) {
  if (![width, height, target].every(Number.isSafeInteger) || width < 2 || height < 2 || ![720,1080].includes(target)) throw new Error('Invalid video dimensions.');
  if (Math.min(width, height) >= target) throw new Error('Choose an output resolution larger than the input.');
  const ratio = target / Math.min(width, height);
  const outputWidth = Math.round(width * ratio / 2) * 2, outputHeight = Math.round(height * ratio / 2) * 2;
  const workWidth = Math.ceil(outputWidth / 128) * 128, workHeight = Math.ceil(outputHeight / 128) * 128;
  if (workWidth * workHeight > 2560 * 1536) throw new Error('This aspect ratio exceeds Clarity’s current processing limit.');
  // The lossless preparation uses 4:2:0. Keep padding origins on its chroma grid.
  return { outputWidth, outputHeight, workWidth, workHeight, padX: Math.floor((workWidth-outputWidth)/4)*2, padY: Math.floor((workHeight-outputHeight)/4)*2 };
}
export function upscaleProcessingGeometry(width:number,height:number,settings:UpscaleSettings){
  const output=upscaleGeometry(width,height,settings.height);
  // Fast 1080p is deliberately explicit: AI detail at 720p, then one final
  // Lanczos resize. Never reduce the chosen/source resolution silently.
  if(settings.processing==='fast1080'){
    if(settings.height!==1080)throw new Error('Fast 1080p needs 1080p output.');
    if(Math.min(width,height)>=720)throw new Error('Fast 1080p requires an input below 720p. Use native processing for this video.');
    return upscaleGeometry(width,height,720);
  }
  return output;
}
