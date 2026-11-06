import { z } from 'zod';
import manifest from '../../config/image-edit-models.lock.json';
import type { Asset, Job } from './types';
import type { ImageGeometry } from './image-replacement';

export const imageEditVersion = 'image-edit-2511-v1' as const;
export const imageEditSettingsSchema = z.object({
  prompt: z.string().max(5000).default(''),
  aspect: z.enum(['source', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']).default('source'),
  resolution: z.enum(['1k', '2k']).default('1k'),
  quality: z.enum(['native', 'lightning']).default('native'),
  precision: z.enum(['int8', 'bf16']).default('int8'),
  format: z.enum(['png', 'jpeg']).default('png'),
  seed: z.number().int().min(0).max(4294967295).default(42),
  randomSeed: z.boolean().default(true),
}).strict();
export type ImageEditSettings = z.infer<typeof imageEditSettingsSchema>;
export const imageEditDraftSchema = z.object({
  referenceIds: z.array(z.string().min(1)).max(3).default([]),
  settings: imageEditSettingsSchema.default(imageEditSettingsSchema.parse({})),
}).strict();
export type ImageEditDraft = z.infer<typeof imageEditDraftSchema>;
export const emptyImageEditDraft = (): ImageEditDraft => imageEditDraftSchema.parse({});
export const imageEditModel = (s: ImageEditSettings) => `qwen_image_edit_2511_${s.precision === 'int8' ? 'int8_convrot' : 'bf16'}.safetensors`;
export const imageEditEncoder = 'qwen_2.5_vl_7b_fp8_scaled.safetensors';
export const imageEditVae = 'qwen_image_vae.safetensors';
export const imageEditLightning = 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors';
export function imageEditFiles(s: ImageEditSettings): string[] {
  const wanted = new Set([imageEditModel(s), imageEditEncoder, imageEditVae, ...(s.quality === 'lightning' ? [imageEditLightning] : [])]);
  return manifest.files.filter(f => wanted.has(f.destination.split('/').at(-1)!)).map(f => f.destination);
}
export const imageEditSampling = (s: ImageEditSettings) => ({ steps: s.quality === 'lightning' ? 4 : 40, cfg: s.quality === 'lightning' ? 1 : 4, shift: 3.1 });
export function imageEditGeometry(s: ImageEditSettings, first: Pick<Asset, 'width' | 'height'>): ImageGeometry {
  if (![first.width, first.height].every(v => Number.isSafeInteger(v) && v >= 32 && v <= 16384) || first.width * first.height > 32_000_000) throw new Error('Use references between 32 pixels and 32 megapixels.');
  const ratio = s.aspect === 'source' ? first.width / first.height : (() => { const [w, h] = s.aspect.split(':').map(Number); return w / h; })();
  if (ratio < .25 || ratio > 4) throw new Error('Use an aspect ratio between 1:4 and 4:1.');
  // A native diffusion canvas, never a post-generation enlargement. Round to the
  // Qwen latent grid; report the actual dimensions rather than promising 2K parity.
  const pixels = s.resolution === '2k' ? 2048 ** 2 : 1024 ** 2;
  const width = Math.max(64, Math.round(Math.sqrt(pixels * ratio) / 32) * 32);
  const height = Math.max(64, Math.round(Math.sqrt(pixels / ratio) / 32) * 32);
  return { width, height, contentWidth: width, contentHeight: height, x: 0, y: 0, outputWidth: width, outputHeight: height };
}
export interface ImageEditReference {
  id: string; name: string; sha256: string; size: number; width: number; height: number;
  sourceFrame?: Asset['sourceFrame'];
}
export interface ImageEditRun { settings: ImageEditSettings; references: ImageEditReference[]; }
export const isImageEditJob = (job: Pick<Job, 'image'>) => job.image?.version === imageEditVersion;
export function imageEditDraftForJob(job: Job): ImageEditDraft {
  if (!isImageEditJob(job) || !job.image?.edit) throw new Error('This is not an Image Edit run.');
  return { referenceIds: job.image.edit.references.map(r => r.id), settings: { ...job.image.edit.settings, randomSeed: false } };
}
