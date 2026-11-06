import path from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './media';
import { compileOpenjutsu } from './openjutsu-workflow';
import { openjutsuDefaults } from '../shared/openjutsu';
import type { Catalog } from '../shared/types';
import { validateGraph } from './workflow';
import runtime from '../../config/openjutsu-runtime.lock.json';
const graphs = [false, true].map(referenceScene => compileOpenjutsu({ ...openjutsuDefaults, referenceScene }, { start: 0, length: 6 }, undefined, 'readiness'));
export const openjutsuToolClasses = [...new Set(graphs.flatMap(graph => Object.values(graph).map(node => node.class_type)))].sort();
export const openjutsuToolInputs = Object.fromEntries(openjutsuToolClasses.map(name => [name, [...new Set(graphs.flatMap(graph => Object.values(graph).filter(node => node.class_type === name).flatMap(node => Object.keys(node.inputs))))].sort()]));
export const hasOpenjutsuTools = (catalog: Catalog) => graphs.every(graph => validateGraph(graph, catalog).every(issue => issue.startsWith('Unavailable ')));
export async function manageOpenjutsuTools(repo: string, instanceId: number, action: 'status' | 'prepare') {
  const request = { ...runtime, classes: openjutsuToolClasses, inputs: openjutsuToolInputs, key: createHash('sha256').update(JSON.stringify({ runtime, inputs: openjutsuToolInputs })).digest('hex') };
  const output = await command('python3', ['-u', path.join(repo, 'scripts/managed_openjutsu_tools.py'), '--instance-id', String(instanceId), '--action', action, '--request', JSON.stringify(request)], undefined, action === 'prepare' ? 1800000 : 20000);
  const line = output.split(/\r?\n/).findLast(line => line.startsWith('RECAST_OPENJUTSU_TOOLS '));
  if (!line) throw new Error('The GPU did not return an OpenJutsu tool status.');
  const result = JSON.parse(line.slice('RECAST_OPENJUTSU_TOOLS '.length));
  if (result.key !== request.key || !['ready', 'running', 'unknown'].every(key => typeof result[key] === 'boolean')) throw new Error('The OpenJutsu setup status could not be verified.');
  return result as { ready: boolean; running: boolean; unknown: boolean; missing: string[]; error?: string };
}
