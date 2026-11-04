import { z } from 'zod';

export const KIE_MODEL = 'wan/3-0-video' as const;
export const kieResolutions = ['480P', '720P', '1080P'] as const;
export const kieDraftSchema = z.object({
  sourceId: z.string().min(1).max(120).nullable().default(null), referenceId: z.string().min(1).max(120).nullable().default(null),
  start: z.number().finite().nonnegative().default(0), seconds: z.number().int().min(2).max(15).default(5),
  resolution: z.enum(kieResolutions).default('480P'), prompt: z.string().trim().max(16000).default(''),
  seed: z.number().int().min(0).max(2147483647).nullable().default(null), keepSourceAudio: z.boolean().default(true),
}).strict();
export type KieDraft = z.infer<typeof kieDraftSchema>;
export const kieDefaults: KieDraft = kieDraftSchema.parse({});
export interface KieAccountStatus { configured: boolean; keyHint: string | null; credits: number | null; checkedAt: string | null; error: string | null; }
export const kieBasePrompt = 'Replace the main person in Video1 with the exact character in Image1. Preserve the original clothing and accessories from Video1, fitted naturally to the reference character. Keep the source camera, framing, background, pose, hand movements, gaze, expressions and lip movements synchronized with Video1. Preserve the character’s facial identity, head shape, hairstyle, skin tone and body proportions consistently through turns and occlusions. Produce a natural photorealistic video without unrelated scene changes.';
export function kiePrompt(instructions: string) { return kieBasePrompt + (instructions.trim() ? '\n\nAdditional instructions:\n' + instructions.trim() : ''); }
export type KiePhase = 'preparing' | 'uploading' | 'submitting' | 'waiting' | 'rendering' | 'downloading' | 'saving' | 'complete' | 'attention' | 'failed' | 'cancelled';
export interface KieVideoRun {
  version: 'kie-wan3-v1'; provider: 'kie.ai'; model: typeof KIE_MODEL; settings: KieDraft; prompt: string;
  phase: KiePhase; submission: 'not-submitted' | 'submitting' | 'submitted' | 'unknown' | 'rejected'; taskId?: string;
  requestFingerprint: string; sourceSHA256?: string; referenceSHA256?: string; submittedAt?: string;
  accountFingerprint?: string; providerState?: string; creditsConsumed?: number; providerSeconds?: number;
  aspectRatio?: 'adaptive' | '16:9' | '9:16' | '4:3' | '3:4' | '1:1'; sourceDuration?: number; sourceAudio: boolean; cancellationNotice?: string; warnings: string[];
  output?: { width: number; height: number; fps: number; duration: number; frames: number; sha256: string; audio: 'source' | 'generated' | 'none'; warnings: string[] };
}
export interface KieBootstrap { provider: 'kie.ai'; model: typeof KIE_MODEL; draft: KieDraft; account: KieAccountStatus; }
export function kieSummary(run: KieVideoRun) {
  return { provider: 'Kie.ai', model: 'Wan 3.0', resolution: run.settings.resolution, duration: run.output?.duration ?? run.settings.seconds,
    fps: run.output?.fps ?? null, taskId: run.taskId ?? null };
}
