import { z } from 'zod';

export const facialProfileSchema = z.enum(['off', 'perform-onnx60', 'regional-onnx60']);
export type FacialProfile = z.infer<typeof facialProfileSchema>;
export const facialProfileLabels: Record<FacialProfile, string> = {
  off: 'Off', 'perform-onnx60': 'Standard + ONNX 60%', 'regional-onnx60': 'Regional + ONNX 60%',
};
export const facialVersions = ['source-face-v1', 'source-face-v2', 'source-face-v3', 'source-face-v4', 'source-face-v5',
  'source-face-v6', 'source-face-v7', 'source-face-v8'] as const;
export const isCleanupFacialVersion = (version: string) => ['source-face-v3', 'source-face-v4', 'source-face-v5', 'source-face-v6', 'source-face-v7', 'source-face-v8'].includes(version);
export const isCalibratedFacialVersion = (version: string) => ['source-face-v4', 'source-face-v5', 'source-face-v7', 'source-face-v8'].includes(version);
export const isEyeFinishedFacialVersion = (version: string) => ['source-face-v5', 'source-face-v8'].includes(version);
export const isGeometryFacialVersion = (version: string) => ['source-face-v6', 'source-face-v7', 'source-face-v8'].includes(version);
export const usesFacialConsistency = (settings: { engine?: string; facialConsistency?: FacialProfile }) =>
  settings.engine === 'viggle' && !!settings.facialConsistency && settings.facialConsistency !== 'off';

export const facialVersionForSettings = (settings: { facialSceneMatch?: boolean; facialFeatureCleanup?: boolean; facialConsistency?: FacialProfile; facialEyeCalibration?: boolean; facialEyeFinish?: boolean }) =>
  settings.facialSceneMatch === false ? 'source-face-v1' as const : settings.facialFeatureCleanup === true
    ? settings.facialConsistency === 'perform-onnx60' && settings.facialEyeCalibration === true ? settings.facialEyeFinish === true ? 'source-face-v8' as const : 'source-face-v7' as const : 'source-face-v6' as const
    : 'source-face-v2' as const;

export const facialRuntimeReadyForSettings = (settings: { engine?: string; facialConsistency?: FacialProfile; facialSceneMatch?: boolean; facialFeatureCleanup?: boolean; facialEyeCalibration?: boolean; facialEyeFinish?: boolean },
  state: { facialRuntimeReady?: boolean; facialCleanupRuntimeReady?: boolean; facialCalibratedRuntimeReady?: boolean; facialEyeFinishRuntimeReady?: boolean; facialGeometryRuntimeReady?: boolean }) => {
  if (!usesFacialConsistency(settings)) return true;
  const version = facialVersionForSettings(settings);
  if (isGeometryFacialVersion(version) && !state.facialGeometryRuntimeReady) return false;
  return isEyeFinishedFacialVersion(version) ? !!state.facialEyeFinishRuntimeReady : isCalibratedFacialVersion(version) ? !!state.facialCalibratedRuntimeReady :
    isCleanupFacialVersion(version) ? !!state.facialCleanupRuntimeReady : !!state.facialRuntimeReady;
};

export interface FacialConsistencyRun {
  version: typeof facialVersions[number]; profile: Exclude<FacialProfile, 'off'>; blend: 0.6; instanceId: number; profileSHA256: string;
  anchorFrame?: number;
  eyeCalibration?: { state: 'active' | 'skipped'; anchorFrame: number; reason?: string | null; eligibleEyes?: boolean[]; fileSHA256: string };
  state: 'pending' | 'preparing' | 'processing' | 'saving' | 'downloaded' | 'complete' | 'interrupted';
  processedFrames: number; frames: number;
  workUnits?: { completed: number; total: number };
  eyeFinish?: { version: 'source-eye-finish-v1'; restorationFrames: number; placementFrames: number; restorationSeconds: number; observationSeconds: number; placementSeconds: number; nativeOutputSHA256: string; sourceRGBTransferred: false };
  baseSHA256?: string; sourceSHA256?: string; referenceSHA256?: string; outputSHA256?: string;
  refinedFrames?: number; skippedFrames?: number; elapsedSeconds?: number; gpu?: string;
  cancellationConfirmed?: boolean;
  preflightComplete?: boolean; remoteActive?: boolean;
}

export const canFinishFacialLocally = (job: { facialConsistency?: FacialConsistencyRun }) =>
  ['downloaded', 'complete'].includes(job.facialConsistency?.state || '');

const calibrationReasons: Record<string, string> = {
  'anchor-face-uncertain': 'the matching source frame did not have one clear face',
  'reference-face-uncertain': 'the edited reference face could not be verified',
  'anchor-reference-pose-mismatch': 'the source and edited reference had different head poses',
  'anchor-eyes-not-visible': 'no matching clear eye was visible in the source and reference',
};
export const facialCalibrationReason = (reason?: string | null): string => calibrationReasons[reason || ''] || 'the source anchor could not be verified';
