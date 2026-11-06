import { createHash } from 'node:crypto';
import graphSource from '../vendor/openjutsu/workflows/simple.api.json';
import { NODES, pruneSimple, setSection, isLink, canvasSize, type ApiGraph } from '../vendor/openjutsu/lib/simple';
import { applyModel, checkAcceleration } from '../vendor/openjutsu/lib/model';
import { openjutsuSettingsSchema, type OpenjutsuSettings } from '../shared/openjutsu';
import type { Asset, Graph } from '../shared/types';

export const openjutsuGraphHash = (graph: Graph) => createHash('sha256').update(JSON.stringify(graph)).digest('hex');
export function compileOpenjutsu(settings: OpenjutsuSettings, section: { start: number; length: number }, names = { source: 'source.mp4', reference: 'reference.png' }, namespace?: string): Graph {
  const s = openjutsuSettingsSchema.parse(settings); checkAcceleration(s);
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
    if (!/^[a-zA-Z0-9-]+$/.test(namespace)) throw new Error('Invalid run namespace.');
    const plan = Object.values(graph).find(n => n.class_type === 'MiniMaxH3ChainPlanModern')!;
    graph.recast_run_name = { class_type: 'StringConcatenate', inputs: { string_a: `recast-${namespace}-`, string_b: plan.inputs.run_name, delimiter: '' }, _meta: { title: 'Saved Recast run' } };
    plan.inputs.run_name = ['recast_run_name', 0];
    graph[NODES.final].inputs.filename = ['recast_run_name', 0];
  }
  return graph as Graph;
}
export function openjutsuDimensions(settings: OpenjutsuSettings, source: Pick<Asset, 'width' | 'height'>, reference: Pick<Asset, 'width' | 'height'>): [number, number] {
  if (typeof settings.resolution !== 'string') return [settings.resolution.width, settings.resolution.height];
  return canvasSize(...(settings.referenceScene ? [reference.width, reference.height] as const : [source.width, source.height] as const), settings.resolution) as [number, number];
}
