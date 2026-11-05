import { z } from 'zod';

export const KIE_MODEL = 'wan/3-0-video' as const;
export const kieResolutions = ['480P', '720P', '1080P'] as const;
export const kieDraftSchema = z.object({
  sourceId: z.string().min(1).max(120).nullable().default(null), referenceId: z.string().min(1).max(120).nullable().default(null),
  // Optional rather than defaulted so legacy frozen drafts retain their exact shape.
  faceReferenceId: z.string().min(1).max(120).nullable().optional(),
  start: z.number().finite().nonnegative().default(0), seconds: z.number().int().min(2).max(15).default(5),
  resolution: z.enum(kieResolutions).default('480P'), prompt: z.string().trim().max(16000).default(''),
  seed: z.number().int().min(0).max(2147483647).nullable().default(null), keepSourceAudio: z.boolean().default(true),
}).strict();
export type KieDraft = z.infer<typeof kieDraftSchema>;
export const kieDefaults: KieDraft = kieDraftSchema.parse({ faceReferenceId: null });
export interface KieAccountStatus { configured: boolean; keyHint: string | null; credits: number | null; checkedAt: string | null; error: string | null; }
export const kieBasePrompt = `Replace the main person in Video1 with the character from Image1. It is the same character throughout the entire clip.
The character's face is the face from Image1, sharp and consistent in every frame, including the first frame. Do not blend it with the face of the person in Video1.
The outfit and accessories are exactly those from Image1. Use no clothing from Video1. Hair and body proportions come from Image1.
The background, lighting and camera framing come from Image1. Keep the same environment, light and fixed camera position. Use no background from Video1.
From Video1, take the body movement, hand movements, dance, head turns, gaze and facial expressions.
LIP SYNC: the lips and mouth copy the lip and mouth movements of the person in Video1 exactly, frame by frame: every opening, closing, smile and word shape at the same moment. Keep the lips in sync with Video1's speech and singing for the entire clip. Only the motion of the lips is copied; the lips themselves, teeth and facial identity stay those of Image1.
Photorealistic, natural skin and a single continuous shot.`;
export const kieFacePrompt = `Replace the main person in Video1 with the character from Image1 and Image2. They show the same character. It is the same character throughout the entire clip.
The character's face is the face from Image2, sharp and identical in every frame, including the first frame. Preserve Image2's facial structure, eye spacing, nose, lips, jawline and chin across head turns and expressions. Do not blend it with the face of the person in Video1.
The outfit and accessories are exactly those from Image1. Use no clothing from Video1 or Image2. Hair and body proportions come from Image1.
The background, lighting and camera framing come from Image1. Keep the same environment, light and fixed camera position. Use no background from Video1 or Image2.
From Video1, take the body movement, hand movements, dance, head turns, gaze and facial expressions. Preserve foreground occlusion: hands and objects passing in front of the face stay in front of the eyes and mouth.
LIP SYNC: the lips and mouth copy the lip and mouth movements of the person in Video1 exactly, frame by frame: every opening, closing, smile and word shape at the same moment. Keep the lips in sync with Video1's speech and singing for the entire clip. Only the motion of the lips is copied; the lips themselves, teeth and facial identity stay those of Image2.
Photorealistic, natural skin and a single continuous shot.`;
export function kiePrompt(instructions: string, hasFaceReference = false) { return (hasFaceReference ? kieFacePrompt : kieBasePrompt) + (instructions.trim() ? '\n\nAdditional instructions (override the defaults only where specified):\n' + instructions.trim() : ''); }
export type KiePhase = 'preparing' | 'uploading' | 'submitting' | 'waiting' | 'rendering' | 'downloading' | 'saving' | 'complete' | 'attention' | 'failed' | 'cancelled';
export interface KieVideoRun {
  version: 'kie-wan3-v1' | 'kie-wan3-v2'; provider: 'kie.ai'; model: typeof KIE_MODEL; settings: KieDraft; prompt: string;
  phase: KiePhase; submission: 'not-submitted' | 'submitting' | 'submitted' | 'unknown' | 'rejected'; taskId?: string;
  requestFingerprint: string; sourceSHA256?: string; referenceSHA256?: string; faceReferenceSHA256?: string; submittedAt?: string;
  accountFingerprint?: string; providerState?: string; creditsConsumed?: number; providerSeconds?: number;
  aspectRatio?: 'adaptive' | '16:9' | '9:16' | '4:3' | '3:4' | '1:1'; sourceDuration?: number; sourceAudio: boolean; cancellationNotice?: string; warnings: string[];
  output?: { width: number; height: number; fps: number; duration: number; frames: number; sha256: string; audio: 'source' | 'generated' | 'none'; warnings: string[] };
}
export interface KieBootstrap { provider: 'kie.ai'; model: typeof KIE_MODEL; draft: KieDraft; account: KieAccountStatus; }
export function kieSummary(run: KieVideoRun) {
  return { provider: 'Kie.ai', model: 'Wan 3.0', resolution: run.settings.resolution, duration: run.output?.duration ?? run.settings.seconds,
    fps: run.output?.fps ?? null, taskId: run.taskId ?? null };
}
