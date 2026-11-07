import { z } from 'zod';
import manifest from '../../config/image-edit-models.lock.json';

// Frozen 2511 dependencies and settings: saved paid runs must never use 2.1.
export const legacyImageEditVersion = 'image-edit-2511-v1' as const;
export const legacyImageEditSettingsSchema = z.object({
  prompt: z.string().max(5000).default(''),
  aspect: z.enum(['source', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']).default('source'),
  resolution: z.enum(['1k', '2k']).default('1k'),
  quality: z.enum(['native', 'lightning']).default('native'),
  precision: z.enum(['int8', 'bf16']).default('int8'),
  format: z.enum(['png', 'jpeg']).default('png'),
  seed: z.number().int().min(0).max(4294967295).default(42),
  randomSeed: z.boolean().default(true),
}).strict();
export type LegacyImageEditSettings = z.infer<typeof legacyImageEditSettingsSchema>;
export const legacyImageEditModel = (s: LegacyImageEditSettings) => `qwen_image_edit_2511_${s.precision === 'int8' ? 'int8_convrot' : 'bf16'}.safetensors`;
export const legacyImageEditEncoder = 'qwen_2.5_vl_7b_fp8_scaled.safetensors';
export const legacyImageEditVae = 'qwen_image_vae.safetensors';
export const legacyImageEditLightning = 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors';
export function legacyImageEditFiles(s: LegacyImageEditSettings): string[] {
  const wanted = new Set([legacyImageEditModel(s), legacyImageEditEncoder, legacyImageEditVae, ...(s.quality === 'lightning' ? [legacyImageEditLightning] : [])]);
  return manifest.files.filter(f => wanted.has(f.destination.split('/').at(-1)!)).map(f => f.destination);
}
export const legacyImageEditSampling = (s: LegacyImageEditSettings) => ({ steps: s.quality === 'lightning' ? 4 : 40, cfg: s.quality === 'lightning' ? 1 : 4, shift: 3.1 });
