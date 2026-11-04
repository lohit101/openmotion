import { z } from 'zod';
import type { Job } from './types';

export const faceRepairGoals = ['auto', 'identity', 'boundary', 'eyes'] as const;
export type FaceRepairGoal = typeof faceRepairGoals[number];
export const faceRepairGoalLabels: Record<FaceRepairGoal, string> = { auto: 'Auto', identity: 'Identity', boundary: 'Face edges / flicker', eyes: 'Eyes / expression' };
export interface FaceRepairRange { startFrame: number; endFrame: number; editableStartFrame: number; editableEndFrame: number; }
export interface FaceRepairCandidate {
  id: string; recipe: string; qualified: boolean; previewSHA256: string; masterSHA256: string;
  changedFrames: number; protectedFramesExact: boolean; protectedPixelsExact: boolean; warnings: string[];
}
export interface FaceRepairBinding {
  finishedSHA256: string; rawSHA256: string; sourceSHA256: string; referenceSHA256: string;
  parentProfileSHA256: string; profileSHA256: string; parentReceiptSHA256: string; parentCalibrationSHA256: string;
}
export interface FaceRepairRun {
  version: 'face-repair-v1'; parentJobId: string; rootJobId: string; requestId: string; instanceId: number;
  goal: FaceRepairGoal; ranges: FaceRepairRange[]; frames: number; fps: number; width: number; height: number;
  binding: FaceRepairBinding; state: 'queued' | 'processing' | 'downloaded' | 'review' | 'accepted' | 'interrupted';
  processedFrames: number; remoteActive: boolean; cancellationConfirmed?: boolean;
  candidates: FaceRepairCandidate[]; acceptedCandidateId?: string; acceptedAt?: string; receiptSHA256?: string;
}
export interface FaceRepairEligibility {
  eligible: boolean; reason: string | null; parentJobId: string; frames: number; fps: number;
  maxHandleSeconds: number; availableGoals: FaceRepairGoal[]; attempts: Job[];
}
export const faceRepairRequestSchema = z.object({
  requestId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  goal: z.enum(faceRepairGoals).default('auto'),
  ranges: z.array(z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict()).min(1).max(12),
}).strict();
export function faceRepairEligibilityReason(job: Job): string | null {
  if (job.status !== 'completed' || !job.output || job.deleted) return 'Choose a completed saved Remotion video.';
  if (job.faceRepair?.state === 'accepted' && job.origin === 'repair') return null;
  if (job.mediaType === 'image' || job.settings.engine !== 'viggle' || job.origin !== 'render' || job.edit || job.upscale || job.faceRefinement || job.faceRepair || job.anchorChild)
    return 'Repair the original Remotion video before Clarity upscaling or clip editing.';
  if (job.settings.fps !== 24 || job.progress.targetFrames > 720) return 'Selective face repair currently requires an unmodified 24 fps Remotion clip of up to 720 frames.';
  if (job.videoRecovery) return 'This historical video has a recovered timing offset. Keep its original output; selective repair needs an exact source clock.';
  if (!job.facialConsistency || job.facialConsistency.state !== 'complete' || job.facialConsistency.profile !== 'perform-onnx60' || !['source-face-v7', 'source-face-v8', 'source-face-v10', 'source-face-v11'].includes(job.facialConsistency.version))
    return 'This video needs a completed calibrated Standard facial finish before selective face repair.';
  return null;
}
/** Half-open source-frame selections. Handles are explicit edit permission, never silent extra footage. */
export function normalizeRepairRanges(ranges: { startFrame: number; endFrame: number }[], frames: number, fps: number): FaceRepairRange[] {
  if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isFinite(fps) || fps <= 0 || !ranges.length || ranges.length > 12) throw new Error('Choose one to twelve valid frame ranges.');
  const sorted = ranges.map(range => {
    if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame > frames || range.startFrame >= range.endFrame) throw new Error('Every repair range must contain at least one frame inside this video.');
    return { ...range };
  }).sort((a, b) => a.startFrame - b.startFrame);
  const merged: { startFrame: number; endFrame: number }[] = [];
  for (const range of sorted) { const last = merged.at(-1); if (last && range.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, range.endFrame); else merged.push(range); }
  const handles = Math.floor(fps * .25 + 1e-8);
  return merged.map(range => ({ ...range, editableStartFrame: Math.max(0, range.startFrame - handles), editableEndFrame: Math.min(frames, range.endFrame + handles) }));
}
export function repairFrameWeight(frame: number, ranges: FaceRepairRange[]): number {
  const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  return Math.max(0, ...ranges.map(r => frame < r.editableStartFrame || frame >= r.editableEndFrame ? 0 : frame < r.startFrame
    ? smooth((frame - r.editableStartFrame) / Math.max(1, r.startFrame - r.editableStartFrame))
    : frame >= r.endFrame ? smooth((r.editableEndFrame - 1 - frame) / Math.max(1, r.editableEndFrame - r.endFrame)) : 1));
}
export const canFinishRepairLocally = (job: Pick<Job, 'faceRepair'>) => ['downloaded', 'review', 'accepted'].includes(job.faceRepair?.state || '');
