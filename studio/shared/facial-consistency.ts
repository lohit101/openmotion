import { z } from 'zod';

export const facialProfileSchema = z.enum(['off', 'perform-onnx60', 'regional-onnx60']);
export type FacialProfile = z.infer<typeof facialProfileSchema>;
export const facialProfileLabels: Record<FacialProfile, string> = {
  off: 'Off', 'perform-onnx60': 'Standard + ONNX 60%', 'regional-onnx60': 'Regional + ONNX 60%',
};
export const facialVersions = ['source-face-v1', 'source-face-v2', 'source-face-v3', 'source-face-v4', 'source-face-v5',
  'source-face-v6', 'source-face-v7', 'source-face-v8', 'source-face-v9', 'source-face-v10', 'source-face-v11'] as const;
export const isOcclusionTrackedFacialVersion = (version: string) => version === 'source-face-v11';
export const isBoundaryFacialVersion = (version: string) => ['source-face-v9', 'source-face-v10', 'source-face-v11'].includes(version);
export const isCleanupFacialVersion = (version: string) => ['source-face-v3', 'source-face-v4', 'source-face-v5', 'source-face-v6', 'source-face-v7', 'source-face-v8', 'source-face-v9', 'source-face-v10', 'source-face-v11'].includes(version);
export const isCalibratedFacialVersion = (version: string) => ['source-face-v4', 'source-face-v5', 'source-face-v7', 'source-face-v8', 'source-face-v10', 'source-face-v11'].includes(version);
export const isEyeFinishedFacialVersion = (version: string) => ['source-face-v5', 'source-face-v8'].includes(version);
export const isGeometryFacialVersion = (version: string) => ['source-face-v6', 'source-face-v7', 'source-face-v8', 'source-face-v9', 'source-face-v10', 'source-face-v11'].includes(version);
export const usesFacialConsistency = (settings: { engine?: string; facialConsistency?: FacialProfile }) =>
  settings.engine === 'viggle' && !!settings.facialConsistency && settings.facialConsistency !== 'off';

export const facialVersionForSettings = (settings: { facialSceneMatch?: boolean; facialFeatureCleanup?: boolean; facialConsistency?: FacialProfile; facialEyeCalibration?: boolean; facialEyeFinish?: boolean; facialBoundaryBlend?: boolean; facialOcclusionTracking?: boolean }) => {
  if (settings.facialSceneMatch === false) return 'source-face-v1' as const;
  if (settings.facialFeatureCleanup !== true) return 'source-face-v2' as const;
  const calibrated = settings.facialConsistency === 'perform-onnx60' && settings.facialEyeCalibration === true;
  // The optional multi-stage eye finish keeps its own frozen compositor.
  if (calibrated && settings.facialEyeFinish === true) return 'source-face-v8' as const;
  if (settings.facialBoundaryBlend === true) return calibrated
    ? settings.facialOcclusionTracking === true ? 'source-face-v11' as const : 'source-face-v10' as const
    : 'source-face-v9' as const;
  return calibrated ? 'source-face-v7' as const : 'source-face-v6' as const;
};

export const facialRuntimeReadyForSettings = (settings: { engine?: string; facialConsistency?: FacialProfile; facialSceneMatch?: boolean; facialFeatureCleanup?: boolean; facialEyeCalibration?: boolean; facialEyeFinish?: boolean; facialBoundaryBlend?: boolean; facialOcclusionTracking?: boolean },
  state: { facialRuntimeReady?: boolean; facialCleanupRuntimeReady?: boolean; facialCalibratedRuntimeReady?: boolean; facialEyeFinishRuntimeReady?: boolean; facialGeometryRuntimeReady?: boolean; facialBoundaryRuntimeReady?: boolean; facialOcclusionRuntimeReady?: boolean }) => {
  if (!usesFacialConsistency(settings)) return true;
  const version = facialVersionForSettings(settings);
  if (isOcclusionTrackedFacialVersion(version) && !state.facialOcclusionRuntimeReady) return false;
  if (isBoundaryFacialVersion(version) && !state.facialBoundaryRuntimeReady) return false;
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
  occlusion?: { version: 'source-occlusion-v1'; receiptSHA256: string; partialEyeFrames: number; primaryFrames: number; preservedFrames: number; sourceRGBTransferred: false; protectedByTargetMask: true };
  baseSHA256?: string; sourceSHA256?: string; referenceSHA256?: string; outputSHA256?: string;
  refinedFrames?: number; skippedFrames?: number; elapsedSeconds?: number; gpu?: string;
  cancellationConfirmed?: boolean;
  preflightComplete?: boolean; remoteActive?: boolean;
}

export const canFinishFacialLocally = (job: { facialConsistency?: FacialConsistencyRun }) =>
  ['downloaded', 'complete'].includes(job.facialConsistency?.state || '');

export function facialProgressForRun(version: FacialConsistencyRun['version'], frameCount: number, frame: number, total: number) {
  if (!Number.isInteger(frameCount) || frameCount < 1 || !Number.isInteger(frame) || frame < 0 || !Number.isInteger(total) || frame > total) return null;
  const stages = isOcclusionTrackedFacialVersion(version) ? 6 : isEyeFinishedFacialVersion(version) ? 4 : 1;
  // v11 also prints direct N-frame facial logs after its five preparation stages.
  const completed = stages === 6 && total === frameCount ? 5 * frameCount + frame : frame;
  if (total !== stages * frameCount && !(stages === 6 && total === frameCount)) return null;
  return { completed, total: stages * frameCount, processedFrames: Math.max(0, completed - (stages - 1) * frameCount), multistage: stages > 1 };
}

const calibrationReasons: Record<string, string> = {
  'anchor-face-uncertain': 'the matching source frame did not have one clear face',
  'reference-face-uncertain': 'the edited reference face could not be verified',
  'anchor-reference-pose-mismatch': 'the source and edited reference had different head poses',
  'anchor-eyes-not-visible': 'no matching clear eye was visible in the source and reference',
};
export const facialCalibrationReason = (reason?: string | null): string => calibrationReasons[reason || ''] || 'the source anchor could not be verified';
