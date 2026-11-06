import { z } from 'zod';
import { DEFAULT_MODEL, DEFAULT_DESCRIBER } from '../vendor/openjutsu/lib/model';
import manifest from '../../config/openjutsu-models.lock.json';
import importedPreset from '../../config/openjutsu-preset.json';

const file = z.string().min(1).max(300).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Choose an installed relative model filename.');
export const openjutsuSettingsSchema = z.object({
  resolution: z.union([z.enum(['480p', '576p', '736p', '768p', '1080p']), z.object({ width: z.number().int().min(256).max(2048).multipleOf(32), height: z.number().int().min(256).max(2048).multipleOf(32) }).strict()]).default('736p'),
  referenceScene: z.boolean().default(true), motion: z.union([z.literal(512), z.literal(768), z.literal(1376)]).default(512),
  hatFix: z.boolean().default(false), noLipSync: z.boolean().default(false), margin: z.enum(['tight', 'normal', 'loose']).default('normal'),
  target: z.string().trim().min(1).max(100).default('person'), role: z.string().max(500).default(''),
  seed: z.number().int().min(0).max(0xffffffff).default(0), clipSeconds: z.number().min(2.5).max(15).default(6),
  steps: z.number().int().min(1).max(100).default(DEFAULT_MODEL.steps), model: file.default(DEFAULT_MODEL.model),
  loras: z.array(z.object({ name: file, strength: z.number().min(-4).max(4), enabled: z.boolean().optional(), speed: z.boolean().optional() }).strict()).max(4).default(DEFAULT_MODEL.loras),
  describer: file.default(DEFAULT_DESCRIBER), textEncoder: file.default(DEFAULT_MODEL.textEncoder), videoVae: file.default(DEFAULT_MODEL.videoVae), audioVae: file.default(DEFAULT_MODEL.audioVae),
  acceleration: z.enum(['none', 'spectrum']).default('none'),
}).strict();
export type OpenjutsuSettings = z.infer<typeof openjutsuSettingsSchema>;
export const openjutsuDefaults = openjutsuSettingsSchema.parse(importedPreset.settings);
export const openjutsuDraftSchema = z.object({ sourceId: z.string().nullable(), referenceId: z.string().nullable(), start: z.number().min(0).default(0), length: z.number().min(0).max(3600).default(0), settings: openjutsuSettingsSchema }).strict();
export type OpenjutsuDraft = z.infer<typeof openjutsuDraftSchema>;
export const emptyOpenjutsuDraft = (): OpenjutsuDraft => ({ sourceId: null, referenceId: null, ...importedPreset.section, settings: structuredClone(openjutsuDefaults) });
export interface OpenjutsuRun { version: 'openjutsu-simple-v1'; settings: OpenjutsuSettings; section: { start: number; length: number }; sourceSHA256: string; referenceSHA256: string; graphSHA256: string; instanceId: number | null; endpoint: string; nativeFile?: string; nativeSHA256?: string; actualFrames?: number; actualSeconds?: number; }
export const openjutsuCatalogFiles = [...manifest.files.map(file => file.destination), ...manifest.shared];
export function openjutsuFiles(s: OpenjutsuSettings): string[] {
  return [...new Set(['diffusion_models/' + s.model, 'text_encoders/' + s.describer, 'text_encoders/' + s.textEncoder,
    'vae/' + s.videoVae, 'vae/' + s.audioVae, 'checkpoints/sam3.1_multiplex_fp16.safetensors', ...s.loras.filter(l => l.enabled !== false && l.strength !== 0).map(l => 'loras/' + l.name)])];
}
export function openjutsuDraftForJob(job: import('./types').Job): OpenjutsuDraft {
  if (!job.openjutsu) throw new Error('This video was made with the previous workflow. Select its media for a new OpenJutsu run.');
  return { sourceId: job.sourceId, referenceId: job.referenceId, start: job.openjutsu.section.start, length: job.openjutsu.section.length, settings: structuredClone(job.openjutsu.settings) };
}
export const canFinishOpenjutsuLocally = (job: import('./types').Job) => !!job.openjutsu?.nativeFile;
