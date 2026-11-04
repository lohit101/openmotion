import type { FaceRepairRange } from './face-repair';
import type { Job } from './types';

export interface RepairSelection { id: string; startFrame: number; endFrame: number; }
/** A cleared attempt ID is an explicit new draft, including when opened from a saved repair. */
export function resolveRepairAttempt<T extends Pick<Job, 'id' | 'faceRepair'>>(
  job: T, jobs: readonly T[], eligibilityAttempts: readonly T[], attemptId: string | null,
): T | null {
  if (attemptId === null) return null;
  return eligibilityAttempts.find(item => item.id === attemptId)
    || jobs.find(item => item.id === attemptId)
    || (job.id === attemptId && job.faceRepair ? job : null);
}
/** Several visible selections can belong to one merged repair/loop range. */
export function repairSelectionRangeIndex(selection: Pick<RepairSelection, 'startFrame' | 'endFrame'>, ranges: readonly FaceRepairRange[]): number {
  return ranges.findIndex(range => selection.startFrame >= range.startFrame && selection.endFrame <= range.endFrame);
}
export function repairPointerFrame(clientX: number, left: number, width: number, frames: number): number {
  if (!Number.isFinite(clientX + left + width) || width <= 0 || frames < 1) return 0;
  return Math.max(0, Math.min(frames, Math.round((clientX - left) / width * frames)));
}
export function moveRepairEdge(range: RepairSelection, edge: 'start' | 'end', frame: number, frames: number): RepairSelection {
  if (!Number.isFinite(frame)) return range;
  const value = Math.round(frame);
  return edge === 'start' ? { ...range, startFrame: Math.max(0, Math.min(range.endFrame - 1, value)) }
    : { ...range, endFrame: Math.max(range.startFrame + 1, Math.min(frames, value)) };
}
export function addRepairSelection(at: number, frames: number, fps: number, id: string): RepairSelection {
  const startFrame = Math.max(0, Math.min(frames - 1, Math.round(Number.isFinite(at) ? at : 0)));
  return { id, startFrame, endFrame: Math.min(frames, startFrame + Math.max(1, Math.round(fps))) };
}
/** Read-only loop context includes both protected joins. It never expands edit permission. */
export function repairLoopFrames(range: FaceRepairRange, frames: number, fps: number): [number, number] {
  return [Math.max(0, range.editableStartFrame - Math.ceil(fps * .5)), Math.min(frames, range.editableEndFrame + Math.ceil(fps * .5))];
}
export function repairEditableFrames(ranges: FaceRepairRange[]): number {
  const sorted = ranges.map(r => [r.editableStartFrame, r.editableEndFrame]).sort((a, b) => a[0] - b[0]);
  let end = 0, count = 0;
  for (const [start, next] of sorted) { count += Math.max(0, next - Math.max(start, end)); end = Math.max(end, next); }
  return count;
}
