import { frameFloor, type ClipSelection, type TrimAction } from './clip';

export interface ClipLimits { minSeconds: number; maxSeconds: number; wholeSeconds?: boolean; destination?: string; }
export function limitedClip(selection: ClipSelection, duration: number, fps: number, limits: ClipLimits): ClipSelection | null {
  if (![selection.start, selection.seconds, duration, fps, limits.minSeconds, limits.maxSeconds].every(Number.isFinite) || fps <= 0 || limits.minSeconds <= 0 || limits.maxSeconds < limits.minSeconds) return null;
  const total = frameFloor(duration, fps), capSeconds = limits.wholeSeconds ? Math.floor(total / fps) : total / fps;
  const maximum = Math.min(limits.maxSeconds, capSeconds);
  if (maximum < limits.minSeconds) return null;
  const seconds = Math.max(limits.minSeconds, Math.min(maximum, limits.wholeSeconds ? Math.round(selection.seconds) : selection.seconds));
  const length = Math.round(seconds * fps), start = Math.max(0, Math.min(total - length, Math.round(selection.start * fps)));
  return { start: start / fps, seconds: length / fps };
}
export function trimLimitedClip(selection: ClipSelection, action: TrimAction, point: number, duration: number, fps: number, limits: ClipLimits): ClipSelection {
  const current = limitedClip(selection, duration, fps, limits);
  if (!current || !Number.isFinite(point)) return selection;
  const end = current.start + current.seconds;
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  if (action === 'move') return limitedClip({ ...current, start: point }, duration, fps, limits) || current;
  if (action === 'start') {
    if (limits.wholeSeconds) {
      // Keep the opposite edge fixed while the selected duration snaps. At the
      // source boundary, allow the end to follow so zero stays reachable.
      if (point <= 0 && end <= limits.maxSeconds + .5) return limitedClip({ start: 0, seconds: end }, duration, fps, limits) || current;
      const seconds = clamp(Math.round(end - point), limits.minSeconds, Math.min(limits.maxSeconds, Math.floor(end)));
      return limitedClip({ start: end - seconds, seconds }, duration, fps, limits) || current;
    }
    const start = clamp(point, Math.max(0, end - limits.maxSeconds), end - limits.minSeconds);
    return limitedClip({ start, seconds: end - start }, duration, fps, limits) || current;
  }
  return limitedClip({ start: current.start, seconds: clamp(point, current.start + limits.minSeconds, Math.min(duration, current.start + limits.maxSeconds)) - current.start }, duration, fps, limits) || current;
}
