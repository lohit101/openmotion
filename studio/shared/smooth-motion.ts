import { z } from 'zod';
import manifest from '../../config/smooth-motion-models.lock.json';
import type { Graph } from './types';

export const outputFPSSchema = z.union([z.literal(24), z.literal(30), z.literal(48), z.literal(60)]);
export const smoothFPSSchema = z.union([z.literal(30), z.literal(48), z.literal(60)]);
export const smoothMotionFiles = manifest.files.map(f => f.destination);
export const smoothMotionDraftSchema = z.object({ sourceId: z.string().uuid().nullable(), parentId: z.string().uuid().nullable().default(null), fps: smoothFPSSchema.default(30) }).strict();
export type SmoothMotionDraft = z.infer<typeof smoothMotionDraftSchema>;
export const emptySmoothMotionDraft = (): SmoothMotionDraft => ({ sourceId: null, parentId: null, fps: 30 });
export interface SmoothMotionRun {
  version: 'smooth-motion-v1'; targetFPS: 30 | 48 | 60; sourceSHA256: string; sourceFile: string; sourceSeconds: number;
  parentId?: string; automatic?: boolean; instanceId: number | null; endpoint: string; graphSHA256: string; graph: Graph;
  nativeFile?: string; nativeSHA256?: string; actualFrames?: number; actualSeconds?: number; face?: never;
}
export const smoothOutputFPS = (job: import('./types').Job): number => job.smoothMotion?.targetFPS || job.settings.fps;
