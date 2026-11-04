import type { Job, Settings } from './types';
import { clipFrameCount, frameFloor } from './clip';
import { canFinishFacialLocally } from './facial-consistency';

export type AnchorDirection = 'backward' | 'forward';
export interface AnchorBranch {
  direction: AnchorDirection; frames: number; childJobId?: string;
  completedFrames: number; progress: number; outputSHA256?: string;
  state: 'waiting' | 'running' | 'interrupted' | 'completed';
}
export interface AnchoredVideoRun {
  version: 'bidirectional-v1' | 'shared-anchor-v2'; anchorFrame: number; frames: number;
  state: 'preparing' | 'rendering' | 'assembling' | 'assembled';
  sourceSHA256?: string; referenceSHA256?: string; preparedSHA256?: string;
  branches: AnchorBranch[]; activeChildId?: string; outputSHA256?: string; masterSHA256?: string;
  sharedPrefix?: { reverseJobId: string; forwardJobId: string; reversePromptId: string; contextSHA256: string; proofSHA256: string };
}
export interface AnchorChild {
  parentJobId: string; direction: AnchorDirection; frames: number; inputSHA256: string; referenceSHA256: string;
  /** New chronology/proof only; absent on every historical directional run. */
  sharedAnchor?: { file: string; sha256: string; proofJSON: string; proofSHA256: string };
  sourceSHA256?: string; anchorFrame?: number;
  sharedVersion?: 'shared-anchor-v2';
}
export function referenceFrameIndex(s: Pick<Settings, 'referenceTime' | 'start' | 'fps'>): number {
  return s.referenceTime == null ? 0 : Math.round(s.referenceTime * s.fps) - frameFloor(s.start, s.fps);
}
/** Readiness/UI can inspect an invalid draft without throwing or downloading. */
export function videoDirectionFrames(s: Settings, shared = false): number[] {
  const frames = clipFrameCount(s.seconds, s.fps), anchor = referenceFrameIndex(s);
  return s.engine === 'viggle' && s.referencePreparation === 'prepared' && anchor > 0 && anchor < frames
    ? [anchor + 1, frames - anchor + (shared ? 4 : 0)] : [frames];
}
export function anchorIssue(s: Settings): string | null {
  if (s.referenceTime == null) return null;
  if (s.engine !== 'viggle' || s.referencePreparation !== 'prepared') return 'A later reference frame needs Viggle and an already edited source frame.';
  const anchor = referenceFrameIndex(s), frames = clipFrameCount(s.seconds, s.fps);
  if (anchor < 0 || anchor >= frames) return 'The reference frame is outside the selected clip. Select its matching moment inside the trim.';
  if (anchor && (anchor < 4 || anchor > frames - 5)) return 'Choose a later reference at least four frames from either edge of the selected clip (about 0.17 seconds).';
  return null;
}
export function anchoredRun(s: Settings, version: AnchoredVideoRun['version'] = 'bidirectional-v1'): AnchoredVideoRun | undefined {
  const issue = anchorIssue(s); if (issue) throw new Error(issue);
  const anchorFrame = referenceFrameIndex(s); if (!anchorFrame) return;
  const frames = clipFrameCount(s.seconds, s.fps);
  return { version, anchorFrame, frames, state: 'preparing', branches: [
    { direction: 'backward', frames: anchorFrame + 1, completedFrames: 0, progress: 0, state: 'waiting' },
    { direction: 'forward', frames: frames - anchorFrame + (version === 'shared-anchor-v2' ? 4 : 0), completedFrames: 0, progress: 0, state: 'waiting' },
  ] };
}
export const canFinishAnchoredLocally = (job: Pick<Job, 'anchoredVideo' | 'facialConsistency'>) =>
  !!job.anchoredVideo && job.anchoredVideo.branches.every(b => b.state === 'completed' && !!b.outputSHA256) && (!job.facialConsistency || canFinishFacialLocally(job));
export function anchorProgress(job: Job): number {
  const a = job.anchoredVideo!;
  if (a.state === 'preparing' && !a.branches.some(b => b.childJobId)) return /preparing/.test(job.progress.stage.toLowerCase()) ? 1 : 0;
  if (a.state === 'assembled') return job.facialConsistency ? 78 : 96;
  if (a.state === 'assembling') return job.facialConsistency ? 76 : 94;
  const total = a.branches.reduce((sum, b) => sum + b.frames, 0);
  return 5 + (job.facialConsistency ? 69 : 85) * a.branches.reduce((sum, b) => sum + b.frames * b.progress / 100, 0) / total;
}
