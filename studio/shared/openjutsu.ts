import { z } from 'zod';
import { outputFPSSchema } from './smooth-motion';
import { DEFAULT_MODEL, DEFAULT_DESCRIBER } from '../vendor/openjutsu/lib/model';
import manifest from '../../config/openjutsu-models.lock.json';
import importedPreset from '../../config/openjutsu-preset.json';
import faceManifest from '../../config/openjutsu-face-models.lock.json';

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
  // API-only evaluation until a matched video comparison qualifies it. Absent
  // on historical drafts/runs; selection does not provision any new files.
  sourceFaceGuide: z.enum(['source-face-guide-v1', 'source-face-detail-v1']).optional(),
}).strict().refine(s => !s.sourceFaceGuide || !s.noLipSync, 'Source facial guidance keeps audio enabled; disable No lip-sync for this comparison.');
export type OpenjutsuSettings = z.infer<typeof openjutsuSettingsSchema>;
export const openjutsuDefaults = openjutsuSettingsSchema.parse(importedPreset.settings);
export const openjutsuDraftSchema = z.object({ sourceId: z.string().nullable(), referenceId: z.string().nullable(), start: z.number().min(0).default(0), length: z.number().min(0).max(3600).default(0), settings: openjutsuSettingsSchema, outputFPS: outputFPSSchema.default(24) }).strict();
export type OpenjutsuDraft = z.infer<typeof openjutsuDraftSchema>;
export const emptyOpenjutsuDraft = (): OpenjutsuDraft => ({ sourceId: null, referenceId: null, outputFPS: 24, ...importedPreset.section, settings: structuredClone(openjutsuDefaults) });
export const openjutsuFaceSettingsSchema = z.object({ style: z.enum(['photo', 'mouth']).default('photo'), chunkSeconds: z.number().min(2.5).max(15).default(6.5) }).strict();
export type OpenjutsuFaceSettings = z.infer<typeof openjutsuFaceSettingsSchema>;
export const openjutsuFaceDraftSchema = openjutsuDraftSchema.extend({ face: openjutsuFaceSettingsSchema, parentId: z.string().uuid().nullable().default(null) });
export type OpenjutsuFaceDraft = z.infer<typeof openjutsuFaceDraftSchema>;
export const emptyOpenjutsuFaceDraft = (): OpenjutsuFaceDraft => ({ ...emptyOpenjutsuDraft(), start: 0, length: 0, face: openjutsuFaceSettingsSchema.parse({}), parentId: null });
export interface OpenjutsuRun { outputFPS?: 24 | 30 | 48 | 60; version: 'openjutsu-simple-v1' | 'openjutsu-face-v1'; face?: OpenjutsuFaceSettings; parentId?: string; settings: OpenjutsuSettings; section: { start: number; length: number }; sourceSHA256: string; referenceSHA256: string; graphSHA256: string; instanceId: number | null; endpoint: string; nativeFile?: string; nativeSHA256?: string; actualFrames?: number; actualSeconds?: number; }
export const openjutsuCatalogFiles = [...manifest.files.map(file => file.destination), ...manifest.shared];
export function openjutsuFiles(s: OpenjutsuSettings): string[] {
  return [...new Set(['diffusion_models/' + s.model, 'text_encoders/' + s.describer, 'text_encoders/' + s.textEncoder,
    'vae/' + s.videoVae, 'vae/' + s.audioVae, 'checkpoints/sam3.1_multiplex_fp16.safetensors', ...s.loras.filter(l => l.enabled !== false && l.strength !== 0).map(l => 'loras/' + l.name)])];
}
export function openjutsuFaceFiles(s: OpenjutsuSettings): string[] {
  return [...openjutsuFiles(s).filter(id => !id.startsWith('checkpoints/')), ...faceManifest.files.map((file: { destination: string }) => file.destination)];
}
export function openjutsuFaceDraftForJob(job: import('./types').Job): OpenjutsuFaceDraft {
  if (!job.openjutsu?.face) throw new Error('This is not a Fix Faces result.');
  return { outputFPS: job.openjutsu.outputFPS || 24, sourceId: job.sourceId, referenceId: job.referenceId, start: job.openjutsu.section.start, length: job.openjutsu.section.length, settings: structuredClone(job.openjutsu.settings), face: structuredClone(job.openjutsu.face), parentId: job.openjutsu.parentId || null };
}
export function openjutsuDraftForJob(job: import('./types').Job): OpenjutsuDraft {
  if (!job.openjutsu) throw new Error('This video was made with the previous workflow. Select its media for a new OpenJutsu run.');
  return { outputFPS: job.openjutsu.outputFPS || 24, sourceId: job.sourceId, referenceId: job.referenceId, start: job.openjutsu.section.start, length: job.openjutsu.section.length, settings: structuredClone(job.openjutsu.settings) };
}
export const canFinishOpenjutsuLocally = (job: import('./types').Job) => !!(job.smoothMotion ? job.smoothMotion.nativeFile : job.openjutsu?.nativeFile);
