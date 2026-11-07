import { z } from 'zod';
import qwen from '../../config/qwen-image-models.lock.json';
import controls from '../../config/image-controls.lock.json';
import adapters from '../../config/image-edit-qwen21.lock.json';
import { legacyImageEditVersion, legacyImageEditSampling, type LegacyImageEditSettings } from './image-edit-legacy';
import type { Asset, Job } from './types';
import type { ImageGeometry } from './image-replacement';

export const imageEditVersion = 'image-edit-qwen21-v1' as const;
export const imageEditSettingsSchema = z.object({
  prompt: z.string().max(5000).default(''),
  aspect: z.enum(['source', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']).default('source'),
  resolution: z.enum(['1k', '2k']).default('1k'),
  quality: z.enum(['native', 'turbo']).default('native'),
  precision: z.literal('int8').default('int8'),
  consistency: z.boolean().default(true),
  bfs: z.boolean().default(true),
  format: z.enum(['png', 'jpeg']).default('png'),
  seed: z.number().int().min(0).max(4294967295).default(42),
  randomSeed: z.boolean().default(true),
}).strict();
export type ImageEditSettings = z.infer<typeof imageEditSettingsSchema>;
const currentDraftSchema = z.object({
  referenceIds: z.array(z.string().min(1)).max(3).default([]),
  settings: imageEditSettingsSchema.default(imageEditSettingsSchema.parse({})),
}).strict();
// Migrate only editable drafts. Frozen historical settings use the legacy schema.
export const imageEditDraftSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const draft = value as Record<string, unknown>, settings = draft.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return value;
  const s = settings as Record<string, unknown>;
  return { ...draft, settings: { ...s, ...(s.quality === 'lightning' ? { quality: 'turbo' } : {}), ...(s.precision === 'bf16' ? { precision: 'int8' } : {}) } };
}, currentDraftSchema);
export type ImageEditDraft = z.infer<typeof imageEditDraftSchema>;
export const emptyImageEditDraft = (): ImageEditDraft => imageEditDraftSchema.parse({});
export const imageEditModel = 'qwen_image_2.1_int8_convrot.safetensors';
export const imageEditEncoder = 'qwen3vl_8b_int8_convrot.safetensors';
export const imageEditVae = 'qwen_image_2.1_vae_bf16.safetensors';
export const imageEditTurbo = 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors';
export const imageEditConsistency = 'qwen-image-2.1-consistency.safetensors';
export const imageEditBfs = 'bfs_head_v1.1_alternative_qwen_2.1.safetensors';
export function imageEditFiles(s: ImageEditSettings): string[] {
  const wanted = new Set([imageEditModel, imageEditEncoder, imageEditVae, ...(s.quality === 'turbo' ? [imageEditTurbo] : []), ...(s.consistency ? [imageEditConsistency] : []), ...(s.bfs ? [imageEditBfs] : [])]);
  return [...qwen.files, ...controls.files, ...adapters.files].filter(f => wanted.has(f.destination.split('/').at(-1)!)).map(f => f.destination);
}
export const imageEditSampling = (s: ImageEditSettings | LegacyImageEditSettings, version: string = imageEditVersion) => version === legacyImageEditVersion ? legacyImageEditSampling(s as LegacyImageEditSettings) : { steps: s.quality === 'turbo' ? 8 : 40, cfg: 1 };
export const imageEditModelLabel = (version: string | undefined) => version === legacyImageEditVersion ? 'Qwen Image Edit 2511' : 'Qwen Image 2.1';
export const imageEditSamplingLabel = (s: ImageEditSettings | LegacyImageEditSettings) => s.quality === 'lightning' ? 'Lightning' : s.quality === 'turbo' ? 'Turbo' : 'Native';
export const imageEditHeadSwapPrompt = (count: number) => `head_swap: use <image1> as the base. Replace its head and hair with ${count >= 3 ? 'the person from <image2>, using <image3> for facial identity' : 'the head and hair from <image2>'}. Keep <image1> head size, rotation, gaze, expression, body, clothes, accessories, background and lighting. Photorealistic skin and natural hair edges.`;
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
export interface ImageEditRun { settings: ImageEditSettings | LegacyImageEditSettings; references: ImageEditReference[]; }
export const isImageEditJob = (job: Pick<Job, 'image'>) => job.image?.version === imageEditVersion || job.image?.version === legacyImageEditVersion;
export function imageEditDraftForJob(job: Job): ImageEditDraft {
  if (!isImageEditJob(job) || !job.image?.edit) throw new Error('This is not an Image Edit run.');
  return imageEditDraftSchema.parse({ referenceIds: job.image.edit.references.map(r => r.id), settings: { ...job.image.edit.settings, randomSeed: false } });
}
