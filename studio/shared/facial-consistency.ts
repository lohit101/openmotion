import { z } from 'zod';

export const facialProfileSchema = z.enum(['off', 'perform-onnx60', 'regional-onnx60']);
export type FacialProfile = z.infer<typeof facialProfileSchema>;
export const facialProfileLabels: Record<FacialProfile, string> = {
  off: 'Off', 'perform-onnx60': 'Standard + ONNX 60%', 'regional-onnx60': 'Regional + ONNX 60%',
};
export const usesFacialConsistency = (settings: { engine?: string; facialConsistency?: FacialProfile }) =>
  settings.engine === 'viggle' && !!settings.facialConsistency && settings.facialConsistency !== 'off';

export interface FacialConsistencyRun {
  version: 'source-face-v1'; profile: Exclude<FacialProfile, 'off'>; blend: 0.6; instanceId: number; profileSHA256: string;
  state: 'pending' | 'preparing' | 'processing' | 'saving' | 'downloaded' | 'complete' | 'interrupted';
  processedFrames: number; frames: number;
  baseSHA256?: string; sourceSHA256?: string; referenceSHA256?: string; outputSHA256?: string;
  refinedFrames?: number; skippedFrames?: number; elapsedSeconds?: number; gpu?: string;
  cancellationConfirmed?: boolean;
  preflightComplete?: boolean; remoteActive?: boolean;
}

export const canFinishFacialLocally = (job: { facialConsistency?: FacialConsistencyRun }) =>
  ['downloaded', 'complete'].includes(job.facialConsistency?.state || '');
