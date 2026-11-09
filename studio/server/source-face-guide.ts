import source from '../vendor/openjutsu/workflows/simple.api.json';
import type { Graph } from '../shared/types';

// Explicit experimental profiles. No profile means the copied OpenJutsu graph
// remains byte-for-byte unchanged. Do not retune a saved profile in place.
export type SourceFaceGuide = 'source-face-guide-v1' | 'source-face-detail-v1';
const faceBlur: Record<SourceFaceGuide, number> = {
  'source-face-guide-v1': 0.05,
  'source-face-detail-v1': 0.015,
};

export function applySourceFaceGuide(graph: Graph, profile: SourceFaceGuide): Graph {
  if (!Object.hasOwn(faceBlur, profile)) throw new Error('Unknown source facial guide profile.');
  const out = structuredClone(graph);
  if (out['41']?.class_type !== 'H3GreyMannequins' || out['36']?.class_type !== 'ImageFromBatch' || out['23']?.class_type !== 'CheckpointLoaderSimple') {
    throw new Error('The source facial guide needs the copied OpenJutsu motion and SAM graph.');
  }
  for (const id of ['69', '70', '71'] as const) {
    if (out[id]) throw new Error('Source facial guidance cannot replace existing no-lip-sync nodes.');
    out[id] = structuredClone(source[id]) as Graph[string];
  }
  // Only restore the native, grey facial-motion path. Audio, source clock,
  // prompts, person ownership, scene mode, model and sampling stay unchanged.
  out['41'].inputs.faces = ['71', 0];
  out['41'].inputs.face_size = ['71', 1];
  out['41'].inputs.face_blur = faceBlur[profile];
  return out;
}
