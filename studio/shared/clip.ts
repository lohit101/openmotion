export const MAX_CLIP_SECONDS = 30;
// New uploads still start with a short selection; longer paid work is explicit.
export const DEFAULT_CLIP_SECONDS = 5;
export interface ClipSelection { start: number; seconds: number; }
export type TrimAction = 'start' | 'end' | 'move';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const frameFloor = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-7);
export const clipFrameCount = (seconds: number, fps: number) => Math.ceil(seconds * fps - 1e-7);
export const minimumClipFrames = (fps: number) => Math.max(5, Math.ceil(.2 * fps));

export function normalizeClip(selection: ClipSelection, duration: number, fps: number): ClipSelection | null {
  if (![duration, fps, selection.start, selection.seconds].every(Number.isFinite) || duration <= 0 || fps <= 0) return null;
  const total = frameFloor(duration, fps), minimum = minimumClipFrames(fps), cap = Math.min(total, Math.floor(MAX_CLIP_SECONDS * fps));
  if (cap < minimum) return null;
  const length = clamp(Math.round(selection.seconds * fps), minimum, cap);
  const start = clamp(Math.round(selection.start * fps), 0, total - length);
  return { start: start / fps, seconds: length / fps };
}

// Restore a draft after a corrected source duration without moving its chosen
// starting frame. Only the unavailable tail is shortened.
export function clampClipEnd(selection:ClipSelection,duration:number,fps:number):ClipSelection|null{
  if(![duration,fps,selection.start,selection.seconds].every(Number.isFinite)||duration<=0||fps<=0)return null;
  const total=frameFloor(duration,fps),minimum=minimumClipFrames(fps);
  if(total<minimum)return null;
  const start=clamp(Math.round(selection.start*fps),0,total-minimum);
  const length=clamp(Math.round(selection.seconds*fps),minimum,Math.min(total-start,Math.floor(MAX_CLIP_SECONDS*fps)));
  return {start:start/fps,seconds:length/fps};
}

export function trimClip(selection: ClipSelection, action: TrimAction, seconds: number, duration: number, fps: number): ClipSelection {
  const current = normalizeClip(selection, duration, fps);
  if (!current) return selection;
  if (!Number.isFinite(seconds)) return current;
  const total = frameFloor(duration, fps), minimum = minimumClipFrames(fps), maximum = Math.floor(MAX_CLIP_SECONDS * fps);
  const begin = Math.round(current.start * fps), length = Math.round(current.seconds * fps), finish = begin + length, point = Math.round(seconds * fps);
  if (action === 'start') { const start = clamp(point, Math.max(0, finish - maximum), finish - minimum); return { start: start / fps, seconds: (finish - start) / fps }; }
  if (action === 'end') { const end = clamp(point, begin + minimum, Math.min(total, begin + maximum)); return { start: begin / fps, seconds: (end - begin) / fps }; }
  return { start: clamp(point, 0, total - length) / fps, seconds: length / fps };
}

export function dragClip(selection:ClipSelection,action:TrimAction,fromX:number,toX:number,width:number,duration:number,fps:number):ClipSelection{
  if(![fromX,toX,width,duration].every(Number.isFinite)||width<=0)return selection;
  const anchor=action==='end'?selection.start+selection.seconds:selection.start;
  // Keep pointer travel outside the strip. Clamping it before subtracting the
  // grab offset makes the outer handles unable to reach either endpoint.
  return trimClip(selection,action,anchor+(toX-fromX)/width*duration,duration,fps);
}

export function clipTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.00';
  const hundredths = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(hundredths / 6000)}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}
