import type { Job, Settings } from './types';
import { viggleWindow } from './viggle-segments';
import { anchorIssue } from './anchored-video';

// Missing engine fields belong to legacy SCAIL jobs; never migrate a paid run
// to another model while checking/resuming it.
export const isViggle = (s: Pick<Settings, 'engine'>): boolean => s.engine === 'viggle';
// Reusing an old paid recipe must preserve its effective reference policy,
// even when it predates the new settings field and the new-job default.
export function referenceModeForRun(job: Pick<Job, 'settings' | 'viggleSegmentation'>): Settings['viggleReferenceMode'] {
  if (job.viggleSegmentation === 'five-frame-v1') return 'original';
  if (job.viggleSegmentation === 'last-frame-v2' || job.viggleSegmentation === 'encoded-overlap-v3') return 'previous';
  return job.settings.viggleReferenceMode || 'previous';
}
export const engineLabel = (s: Pick<Settings, 'engine'>): string => isViggle(s) ? 'Viggle Animate · INT8' : 'SCAIL-2 · INT8';
export const vigglePasses = (s: Pick<Settings, 'viggleQuality'>): number => s.viggleQuality === 'balanced' ? 5 : 3;
export const viggleSigmas = (s: Pick<Settings, 'viggleQuality'>): string => s.viggleQuality === 'balanced'
  ? '1.0, 0.9230769230769231, 0.8181818181818182, 0.6666666666666666, 0.42857142857142855, 0.0'
  : '1.0, 0.8571428571428571, 0.6, 0.0';

export function engineIssue(s: Settings): string | null {
  const anchor = anchorIssue(s); if (anchor) return anchor;
  if (s.facialConsistency && s.facialConsistency !== 'off' && (!isViggle(s) || s.referencePreparation !== 'prepared')) return 'Facial consistency needs Viggle and an already edited starting frame. Prepare the frame in Imagen, then select Use an already edited source frame.';
  if (s.imagenRepaintEnabled && (!s.imagenRepaint?.bodyView || !s.imagenRepaint.faceView)) return 'Choose a saved character and its body and facial views for Imagen segment refresh.';
  if (s.imagenRepaintEnabled && (!isViggle(s) || s.referencePreparation !== 'prepared' || s.viggleReferenceMode !== 'previous')) return 'Imagen segment refresh needs Viggle, an edited starting frame and previous-frame continuity.';
  if (!isViggle(s)) return [s.loraA, s.loraB].some(name => name.startsWith('viggle_')) ? 'Viggle adapters cannot be used with SCAIL. Select a model-matched adapter.' : null;
  if (s.mode !== 'swap') return 'Viggle supports Character swap here. Use SCAIL for Motion transfer.';
  if (s.fps !== 24) return 'Viggle uses native 24 fps. Select 24 fps before generating.';
  if (s.seconds > 30) return 'Viggle supports up to 30 seconds here, using saved overlapping segments.';
  if (s.orientation !== 'source') return 'Viggle keeps the source composition. Select Match source framing.';
  if (s.loraA !== 'None' || s.loraB !== 'None') return 'SCAIL/Wan style LoRAs are incompatible with Viggle. Clear LoRA A and B.';
  return null;
}

export const defaultVigglePrompt = 'Use the reference character’s face, hair and outfit. Preserve the person’s exact position, apparent size, pose and camera distance in the source video. Match the scene’s lighting and keep natural skin texture.';

export function planForJob(s: Settings, completed: number, target: number, legacy: (completed: number, target: number, cap: number) => { skip: number; cap: number; overlap: number }, continuation?: Job['viggleSegmentation']) {
  if (!isViggle(s)) return legacy(completed, target, s.framesPerPass);
  const issue = engineIssue(s); if (issue) throw new Error(issue);
  if (continuation === 'five-frame-v1' || continuation === 'last-frame-v2' || continuation === 'encoded-overlap-v3') return viggleWindow(completed, target);
  if (completed !== 0 || target > 124) throw new Error('Viggle single-shot renders cannot continue as SCAIL chunks. Reuse the settings for a new shot.');
  return { skip: 0, cap: target, overlap: 0 };
}

export function repaintPrompt(s: Settings): string {
  return 'Edit image 1, the source video frame. Replace only the main person with the adult character from image 2. '
    + 'Take the exact facial identity, hair, clothing and visible accessories from image 2. '
    + 'Keep the source person’s screen location, apparent height, head size, pose, body orientation, camera distance and framing from image 1. '
    + 'Preserve image 1’s background, objects, foreground occlusions, perspective and camera lens. '
    + 'Light the replacement with the same light direction, exposure, colour temperature, shadows and reflections as image 1. '
    + 'Use natural skin texture and ordinary camera detail. Keep the source expression; do not beautify, smooth skin or change the camera. '
    + (s.prompt.trim() ? 'Additional appearance guidance: ' + s.prompt.trim() : 'Make the edit look like a single unretouched frame from the original recording.');
}
