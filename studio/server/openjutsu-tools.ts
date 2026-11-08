import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { command } from './media';
import { compileOpenjutsu, compileOpenjutsuFace } from './openjutsu-workflow';
import { openjutsuDefaults } from '../shared/openjutsu';
import type { Catalog } from '../shared/types';
import { validateGraph } from './workflow';
import runtime from '../../config/openjutsu-runtime.lock.json';
import faceRuntime from '../../config/openjutsu-face-runtime.lock.json';
const graphs = [false, true].map(referenceScene => compileOpenjutsu({ ...openjutsuDefaults, referenceScene }, { start: 0, length: 6 }, undefined, 'readiness'));
export const openjutsuToolClasses = [...new Set(graphs.flatMap(graph => Object.values(graph).map(node => node.class_type)))].sort();
export const openjutsuToolInputs = Object.fromEntries(openjutsuToolClasses.map(name => [name, [...new Set(graphs.flatMap(graph => Object.values(graph).filter(node => node.class_type === name).flatMap(node => Object.keys(node.inputs))))].sort()]));
export const hasOpenjutsuTools = (catalog: Catalog) => graphs.every(graph => validateGraph(graph, catalog).every(issue => issue.startsWith('Unavailable ')));
const faceGraphs = ['photo', 'mouth'].map(style => compileOpenjutsuFace(openjutsuDefaults, { style: style as 'photo' | 'mouth', chunkSeconds: 6.5 }));
export const hasOpenjutsuFaceTools = (catalog: Catalog) => faceGraphs.every(graph => validateGraph(graph, catalog).every(issue => issue.startsWith('Unavailable ')));
export async function manageOpenjutsuTools(repo: string, instanceId: number, action: 'status' | 'prepare', face = false) {
  const selected = face ? faceGraphs : graphs, selectedRuntime = face ? faceRuntime : runtime;
  const classes = [...new Set(selected.flatMap(graph => Object.values(graph).map(node => node.class_type)))].sort();
  const inputs = Object.fromEntries(classes.map(name => [name, [...new Set(selected.flatMap(graph => Object.values(graph).filter(node => node.class_type === name).flatMap(node => Object.keys(node.inputs))))].sort()]));
  const request = { ...selectedRuntime, classes, inputs, ...(face ? { face: true } : {}), key: createHash('sha256').update(JSON.stringify({ runtime: selectedRuntime, inputs })).digest('hex') };
  const output = await command('python3', ['-u', path.join(repo, 'scripts/managed_openjutsu_tools.py'), '--instance-id', String(instanceId), '--action', action, '--request', JSON.stringify(request)], undefined, action === 'prepare' ? 1800000 : 20000);
  const line = output.split(/\r?\n/).findLast(line => line.startsWith('RECAST_OPENJUTSU_TOOLS '));
  if (!line) throw new Error('The GPU did not return an OpenJutsu tool status.');
  const result = JSON.parse(line.slice('RECAST_OPENJUTSU_TOOLS '.length));
  if (result.key !== request.key || !['ready', 'running', 'unknown'].every(key => typeof result[key] === 'boolean')) throw new Error('The OpenJutsu setup status could not be verified.');
  return result as { ready: boolean; running: boolean; unknown: boolean; missing: string[]; error?: string };
}

export const hasSmoothMotionTools = (catalog: Catalog) => !!catalog.RecastSmoothVideoV1 && !!catalog.FrameInterpolationModelLoader;
export async function manageSmoothMotionTools(repo: string, instanceId: number, action: 'status' | 'prepare') {
  const files = Object.fromEntries(['__init__.py', 'motion.py'].map(name => {
    const content = readFileSync(path.join(repo, 'custom_nodes/recast_post_processing', name), 'utf8');
    return [name, { content, sha256: createHash('sha256').update(content).digest('hex') }];
  }));
  const request = { comfyui: runtime.comfyui, packs: [], classes: ['RecastSmoothVideoV1', 'FrameInterpolationModelLoader'], inputs: { RecastSmoothVideoV1: ['video', 'source_sha256', 'target_fps', 'run_id', 'model_name'] }, local_nodes: [{ directory: 'recast_post_processing', files }], key: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  const output = await command('python3', ['-u', path.join(repo, 'scripts/managed_openjutsu_tools.py'), '--instance-id', String(instanceId), '--action', action, '--request', JSON.stringify(request)], undefined, action === 'prepare' ? 1800000 : 20000);
  const line = output.split(/\r?\n/).findLast(line => line.startsWith('RECAST_OPENJUTSU_TOOLS '));
  if (!line) throw new Error('The GPU returned no Smooth Motion tool status.');
  const value = JSON.parse(line.slice('RECAST_OPENJUTSU_TOOLS '.length));
  if (value.key !== request.key || !['ready', 'running', 'unknown'].every(k => typeof value[k] === 'boolean')) throw new Error('Smooth Motion tool status could not be verified.');
  return value as { ready: boolean; running: boolean; unknown: boolean; missing: string[]; error?: string };
}
