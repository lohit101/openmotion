import { z } from 'zod';

export const timelineClipSchema = z.object({ id: z.string().uuid(), jobId: z.string().min(1).max(120), inFrame: z.number().int().nonnegative(), outFrame: z.number().int().positive() }).strict().refine(clip => clip.outFrame > clip.inFrame, 'Keep at least one frame in each clip.');
export const editDraftSchema = z.object({ title: z.string().trim().min(1).max(120).default('Untitled edit'), mode: z.enum(['lossless', 'mp4']).default('lossless'), clips: z.array(timelineClipSchema).max(32) }).strict();
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type EditDraft = z.infer<typeof editDraftSchema>;
export interface EditorSource {
  jobId: string; title: string; width: number; height: number; frames: number; fps: number; duration: number;
  codec: string; pixelFormat: string; colorRange: string; colorSpace: string; colorPrimaries: string; colorTransfer: string;
  hasAudio: boolean; sampleRate: number; channels: number; channelLayout: string;
}
export interface EditSourceReceipt extends TimelineClip { title: string; fps: number; sourceFrames: number; width: number; height: number; }
export interface ClipEditReceipt { version: 'timeline-v1'; mode: EditDraft['mode']; method: 'stream-copy' | 'lossless-encode' | 'h264-encode'; format: 'mkv' | 'mp4'; videoCodec: 'ffv1' | 'h264'; duration: number; frames: number; fps: number; width: number; height: number; sources: EditSourceReceipt[]; }
export interface LocalExport { id: string; title: string; status: 'queued' | 'exporting' | 'completed' | 'failed' | 'cancelled'; stage: string; percent: number; error: string | null; resultJobId: string | null; mode: EditDraft['mode']; createdAt: string; }

export const clipSeconds = (clip: TimelineClip, source: EditorSource): number => (clip.outFrame - clip.inFrame) / source.fps;
export function timelineLayout(clips: TimelineClip[], sources: Record<string, EditorSource>) {
  let time = 0;
  return clips.flatMap(clip => { const source = sources[clip.jobId]; if (!source) return []; const duration = clipSeconds(clip, source), start = time; time += duration; return [{ clip, source, start, duration, end: time }]; });
}
export function trimTimelineClip(clip: TimelineClip, edge: 'in' | 'out', frame: number, source: EditorSource): TimelineClip {
  const value = Number.isFinite(frame) ? Math.round(frame) : edge === 'in' ? clip.inFrame : clip.outFrame;
  return edge === 'in' ? { ...clip, inFrame: Math.max(0, Math.min(clip.outFrame - 1, value)) } : { ...clip, outFrame: Math.min(source.frames, Math.max(clip.inFrame + 1, value)) };
}
export function locateTimeline(clips: TimelineClip[], sources: Record<string, EditorSource>, time: number) {
  const rows = timelineLayout(clips, sources), row = rows.find(item => time < item.end - 1e-6) || rows.at(-1);
  return row ? { ...row, sourceTime: row.clip.inFrame / row.source.fps + Math.min(Math.max(0, time - row.start), Math.max(0, row.duration - 1 / row.source.fps)) } : null;
}
