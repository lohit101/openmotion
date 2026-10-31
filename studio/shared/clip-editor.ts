import { z } from 'zod';

export const timelineClipSchema = z.object({ id: z.string().uuid(), jobId: z.string().min(1).max(120).refine(id => !id.startsWith('asset:'), 'Use assetId for an imported video.').optional(), assetId: z.string().uuid().optional(), inFrame: z.number().int().nonnegative(), outFrame: z.number().int().positive() }).strict().refine(clip => !!clip.jobId !== !!clip.assetId, 'Choose one library video or imported video.').refine(clip => clip.outFrame > clip.inFrame, 'Keep at least one frame in each clip.');
export const editDraftSchema = z.object({ title: z.string().trim().min(1).max(120).default('Untitled edit'), mode: z.enum(['lossless', 'mp4']).default('lossless'), clips: z.array(timelineClipSchema).max(32) }).strict();
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type EditDraft = z.infer<typeof editDraftSchema>;
export interface EditorSource {
  jobId?: string; assetId?: string; title: string; width: number; height: number; frames: number; fps: number; duration: number;
  codec: string; pixelFormat: string; colorRange: string; colorSpace: string; colorPrimaries: string; colorTransfer: string;
  hasAudio: boolean; sampleRate: number; channels: number; channelLayout: string;
}
export type EditSourceReceipt = TimelineClip & { title: string; fps: number; sourceFrames: number; width: number; height: number; };
export interface ClipEditReceipt { version: 'timeline-v1'; mode: EditDraft['mode']; method: 'stream-copy' | 'lossless-encode' | 'h264-encode'; format: 'mkv' | 'mp4'; videoCodec: 'ffv1' | 'h264'; duration: number; frames: number; fps: number; width: number; height: number; sources: EditSourceReceipt[]; }
export interface LocalExport { id: string; title: string; status: 'queued' | 'exporting' | 'completed' | 'failed' | 'cancelled'; stage: string; percent: number; error: string | null; resultJobId: string | null; mode: EditDraft['mode']; createdAt: string; }

export const clipSourceKey = (source: { jobId?: string; assetId?: string }): string => source.assetId ? `asset:${source.assetId}` : source.jobId || '';
export const clipVideoUrl = (source: { jobId?: string; assetId?: string }): string => source.assetId ? `/api/clip-editor/sources/${encodeURIComponent(clipSourceKey(source))}/preview` : `/api/jobs/${encodeURIComponent(source.jobId || '')}/video`;
export const clipPosterUrl = (source: { jobId?: string; assetId?: string }): string => source.assetId ? `/api/assets/${encodeURIComponent(source.assetId)}/poster` : `/api/jobs/${encodeURIComponent(source.jobId || '')}/poster`;

export const clipSeconds = (clip: TimelineClip, source: EditorSource): number => (clip.outFrame - clip.inFrame) / source.fps;
export function timelineLayout(clips: TimelineClip[], sources: Record<string, EditorSource>) {
  let time = 0;
  return clips.flatMap(clip => { const source = sources[clipSourceKey(clip)]; if (!source) return []; const duration = clipSeconds(clip, source), start = time; time += duration; return [{ clip, source, start, duration, end: time }]; });
}
export function trimTimelineClip(clip: TimelineClip, edge: 'in' | 'out', frame: number, source: EditorSource): TimelineClip {
  const value = Number.isFinite(frame) ? Math.round(frame) : edge === 'in' ? clip.inFrame : clip.outFrame;
  return edge === 'in' ? { ...clip, inFrame: Math.max(0, Math.min(clip.outFrame - 1, value)) } : { ...clip, outFrame: Math.min(source.frames, Math.max(clip.inFrame + 1, value)) };
}
// Continue an intentional edge drag when the pointer runs out of visible room.
// A fresh press or a pointer in the middle of the viewport must not change time.
export function trimEdgeTravel(fromX:number,toX:number,left:number,right:number,seconds:number):number {
  if(![fromX,toX,left,right,seconds].every(Number.isFinite)||right<=left||seconds<=0)return 0;
  const direction=toX<fromX-4&&toX<left+20?-1:toX>fromX+4&&toX>right-20?1:0;
  if(!direction)return 0;
  const distance=direction<0?left+20-toX:toX-right+20;
  return direction*Math.min(240,80+distance*4)*Math.min(seconds,.05);
}
export function locateTimeline(clips: TimelineClip[], sources: Record<string, EditorSource>, time: number) {
  const rows = timelineLayout(clips, sources), row = rows.find(item => time < item.end - 1e-6) || rows.at(-1);
  return row ? { ...row, sourceTime: row.clip.inFrame / row.source.fps + Math.min(Math.max(0, time - row.start), Math.max(0, row.duration - 1 / row.source.fps)) } : null;
}
