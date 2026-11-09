import { AKATZ_CHARACTER_LORA, INTERACTION_MOTION_LORA, openjutsuDraftSchema, type OpenjutsuDraft } from './openjutsu';

// This evaluates compatibility with the current six-step setup. It is not
// Akatz's published Turbo8/er_sde/normal recipe and changes no normal preset.
export function akatzComparisonRequests(value: OpenjutsuDraft) {
  const base = openjutsuDraftSchema.parse(structuredClone(value));
  const s = base.settings;
  if (!base.sourceId || !base.referenceId || !base.length || base.length < 2.5 || base.length > 5 || base.length > s.clipSeconds
    || !s.referenceScene || s.interactionGuide !== 'aligned-interactions-v1' || s.noLipSync || s.sourceFaceGuide || base.outputFPS !== 24) {
    throw new Error('Choose an audio-enabled, single-window aligned Motion Transfer parent with native 24fps output.');
  }
  if (!s.model.endsWith('minimax_h3_ref2va_pruned_int8_convrot.safetensors') || s.steps !== 6 || s.acceleration !== 'none') throw new Error('This matched comparison uses the current Ref2VA INT8/six-step recipe without extra acceleration.');
  if (s.loras.some(l => l.name === AKATZ_CHARACTER_LORA)) throw new Error('The parent already contains the candidate Akatz adapter.');
  const motion = s.loras.filter(l => l.name === INTERACTION_MOTION_LORA && l.enabled !== false && l.strength === 1);
  if (motion.length !== 1 || s.loras.length >= 4) throw new Error('This comparison needs one active Motion Transfer adapter at 1 and one free adapter slot.');
  const withCharacter = (strength: number, keepMotion: boolean) => {
    const request = structuredClone(base);
    request.settings.loras = [...request.settings.loras.filter(l => keepMotion || l.name !== INTERACTION_MOTION_LORA), { name: AKATZ_CHARACTER_LORA, strength }];
    return openjutsuDraftSchema.parse(request);
  };
  return [
    { name: 'motion-control', request: base },
    { name: 'combined035', request: withCharacter(0.35, true) },
    { name: 'combined065', request: withCharacter(0.65, true) },
    { name: 'combined100', request: withCharacter(1, true) },
    { name: 'akatz-only', request: withCharacter(1, false) },
  ];
}

export function akatzSourceSceneRequest(value: OpenjutsuDraft): OpenjutsuDraft {
  const request = akatzComparisonRequests(value).find(a => a.name === 'akatz-only')!.request;
  request.settings.referenceScene = false;
  delete request.settings.interactionGuide;
  return openjutsuDraftSchema.parse(request);
}

// The caller must hash/ingest an actual completed native parent first. The
// request never silently pads, stretches or repeats the intermediate video.
export function derivedComparisonRequest(value: OpenjutsuDraft, sourceId: string, nativeFrames: number): OpenjutsuDraft {
  if (!sourceId || nativeFrames < 56 || nativeFrames > 107 || !Number.isInteger(nativeFrames) || (nativeFrames - 5) % 17 !== 0) throw new Error('The derived source needs a verified native frame count on the H3 grid, long enough for a second Remotion pass.');
  const request = structuredClone(value);
  request.sourceId = sourceId; request.start = 0; request.length = nativeFrames / 24;
  return openjutsuDraftSchema.parse(request);
}
