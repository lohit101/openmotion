import { createHash } from 'node:crypto';
import graphSource from '../vendor/openjutsu/workflows/simple.api.json';
import faceSource from '../vendor/openjutsu/workflows/face.api.json';
import { pruneFace, applyDetectorPaths } from '../vendor/openjutsu/lib/face';
import { NODES, pruneSimple, setSection, isLink, canvasSize, type ApiGraph } from '../vendor/openjutsu/lib/simple';
import { applyModel, checkAcceleration } from '../vendor/openjutsu/lib/model';
import { openjutsuSettingsSchema, openjutsuFaceSettingsSchema, leaveInteractionComparison, type OpenjutsuFaceSettings, type OpenjutsuSettings } from '../shared/openjutsu';
import type { Asset, Graph } from '../shared/types';
import { applySourceFaceGuide } from './source-face-guide';
import { applySourceInteractions } from './source-interactions';

export const openjutsuGraphHash = (graph: Graph) => createHash('sha256').update(JSON.stringify(graph)).digest('hex');
export function compileOpenjutsuFace(settings: OpenjutsuSettings, face: OpenjutsuFaceSettings, section = { start: 0, length: 0 }, names = { source: 'source.mp4', reference: 'reference.png' }, detectors = ['bbox/face_yolov8m.pt', 'segm/person_yolov8m-seg.pt']): Graph {
  const s = openjutsuSettingsSchema.parse({ ...settings, ...leaveInteractionComparison(settings) }), f = openjutsuFaceSettingsSchema.parse(face);
  const graph = pruneFace(structuredClone(faceSource) as ApiGraph, { ...f, seed: s.seed });
  // The same soundless-video adapter used by native loadGraph().
  graph['1_soundtrack'] = { class_type: 'H3SoundtrackOrSilence', inputs: { audio: ['1', 2], video_info: ['1', 3] }, _meta: { title: 'Soundtrack (silence if none)' } };
  for (const node of Object.values(graph)) for (const [field, value] of Object.entries(node.inputs)) if (node !== graph['1_soundtrack'] && isLink(value) && value[0] === '1' && value[1] === 2) node.inputs[field] = ['1_soundtrack', 0];
  applyDetectorPaths(graph, detectors); applyModel(graph, s); setSection(graph, '1', section);
  // Native JSON predates the pinned FaceRefine enum rename. This is the same
  // largest-face selection, using the installed node's accepted identifier.
  for (const node of Object.values(graph)) if (node.class_type === 'H3FaceTrackCrop' && node.inputs.select === 'largest') node.inputs.select = 'largest_face';
  graph['1'].inputs.video = names.source; graph['2'].inputs.image = names.reference;
  return graph as Graph;
}
export function compileOpenjutsu(settings: OpenjutsuSettings, section: { start: number; length: number }, names = { source: 'source.mp4', reference: 'reference.png' }, namespace?: string): Graph {
  const s = openjutsuSettingsSchema.parse(settings); checkAcceleration(s);
  // Aligned guide + carried generated history have overlapping anchors. Keep
  // the first evaluation single-window until real continuation is qualified.
  if (s.interactionGuide === 'aligned-interactions-v1' && (!section.length || section.length > 5 || section.length > s.clipSeconds)) throw new Error('The experimental aligned interaction comparison needs one explicit section of five seconds or less, inside one segment.');
  const original = structuredClone(graphSource) as ApiGraph;
  // Verbatim loadGraph() soundless-video compatibility from Desktop OpenJutsu.
  for (const id of Object.keys(original).filter(id => original[id].class_type === 'VHS_LoadVideo')) {
    const soundtrack = `${id}_soundtrack`; let used = false;
    for (const node of Object.values(original)) for (const [key, value] of Object.entries(node.inputs)) if (isLink(value) && value[0] === id && value[1] === 2) { node.inputs[key] = [soundtrack, 0]; used = true; }
    if (used) original[soundtrack] = { class_type: 'H3SoundtrackOrSilence', inputs: { audio: [id, 2], video_info: [id, 3] }, _meta: { title: 'Soundtrack (silence if none)' } };
  }
  const graph = pruneSimple(original, s); applyModel(graph, s); setSection(graph, NODES.video, section);
  graph[NODES.video].inputs.video = names.source; graph[NODES.picture].inputs.image = names.reference;
  if (namespace) {
    if (!/^[a-zA-Z0-9-]+$/.test(namespace) || namespace.length > 64 || namespace.startsWith('-') || namespace.endsWith('-')) throw new Error('Invalid run namespace.');
    const plan = Object.values(graph).find(n => n.class_type === 'MiniMaxH3ChainPlanModern')!;
    // A job already freezes its inputs/settings and has a unique ID. Appending
    // OpenJutsu's picture/scene/model suffix chain can exceed its 96-char limit.
    // Use that job identity alone for both the chain and the assembled output.
    graph.recast_run_name = { class_type: 'StringConcatenate', inputs: { string_a: `recast-${namespace}`, string_b: '', delimiter: '' }, _meta: { title: 'Saved Recast run' } };
    plan.inputs.run_name = ['recast_run_name', 0];
    graph[NODES.final].inputs.filename = ['recast_run_name', 0];
  }
  if (s.interactionGuide) return applySourceInteractions(graph as Graph, s.interactionGuide);
  return s.sourceFaceGuide ? applySourceFaceGuide(graph as Graph, s.sourceFaceGuide) : graph as Graph;
}
export function openjutsuDimensions(settings: OpenjutsuSettings, source: Pick<Asset, 'width' | 'height'>, reference: Pick<Asset, 'width' | 'height'>): [number, number] {
  if (typeof settings.resolution !== 'string') return [settings.resolution.width, settings.resolution.height];
  return canvasSize(...(settings.referenceScene ? [reference.width, reference.height] as const : [source.width, source.height] as const), settings.resolution) as [number, number];
}
