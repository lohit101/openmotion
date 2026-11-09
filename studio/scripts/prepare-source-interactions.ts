/** Offline only: freeze complete-guide / aligned / task-LoRA comparisons. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileOpenjutsu, openjutsuGraphHash } from '../server/openjutsu-workflow';
import { fileSHA256 } from '../server/openjutsu-runner';
import { openjutsuDraftSchema, openjutsuFiles } from '../shared/openjutsu';
import manifest from '../../config/openjutsu-models.lock.json';
import type { Asset, Job } from '../shared/types';

const [database, parentId, destination] = process.argv.slice(2);
if (!database || !parentId || !destination || process.argv.length !== 5) throw new Error('Usage: tsx scripts/prepare-source-interactions.ts <studio.sqlite> <completed-job-id> <new-output-folder>');
const db = new DatabaseSync(path.resolve(database), { readOnly: true });
const get = <T>(table: 'assets' | 'jobs', id: string): T => {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined;
  if (!row) throw new Error('The saved input or job is unavailable.');
  return JSON.parse(row.data);
};
let parent: Job, source: Asset, reference: Asset;
try {
  parent = get<Job>('jobs', parentId);
  if (!parent.openjutsu || parent.openjutsu.face || parent.status !== 'completed' || parent.deleted) throw new Error('Select a completed native Remotion parent.');
  source = get<Asset>('assets', parent.sourceId); reference = get<Asset>('assets', parent.referenceId);
} finally { db.close(); }
if (source.kind !== 'video' || !source.hasAudio || reference.kind !== 'image') throw new Error('This comparison needs a source performance with audio and a character photo.');
if (!parent.openjutsu!.settings.referenceScene || parent.openjutsu!.settings.noLipSync) throw new Error('Use an audio-enabled reference-scene parent.');
const [sourceSHA256, referenceSHA256] = await Promise.all([fileSHA256(source.path), fileSHA256(reference.path)]);
if (sourceSHA256 !== parent.openjutsu!.sourceSHA256 || referenceSHA256 !== parent.openjutsu!.referenceSHA256) throw new Error('A paid parent input changed. No comparison was prepared.');
const start = parent.openjutsu!.section.start, length = Math.min(5, parent.openjutsu!.section.length || source.duration - start);
if (length < 2) throw new Error('Choose a parent with at least two seconds.');
if (Math.abs(Math.log(source.width / source.height / (reference.width / reference.height))) > 0.05) throw new Error('For this comparison, use a repainted reference with the same framing/aspect ratio as the source.');
const task = manifest.files.find(f => f.destination === 'loras/minimax_h3_motion_transfer_v1.0_ref2va.safetensors')!;
const taskName = task.destination.slice('loras/'.length);
const common = openjutsuDraftSchema.parse({ sourceId: source.id, referenceId: reference.id, start, length, outputFPS: 24,
  settings: { ...parent.openjutsu!.settings, resolution: '480p', motion: 768, steps: 6, seed: 1729, clipSeconds: 5 } });
delete common.settings.sourceFaceGuide; delete common.settings.interactionGuide;
if (common.settings.loras.some(l => l.name === taskName)) throw new Error('Select a parent without the candidate task LoRA for an independent control.');
if (common.settings.loras.length >= 4) throw new Error('This comparison needs one free task-adapter slot.');
const profiles = [
  { name: 'control', profile: undefined },
  { name: 'complete-reference', profile: 'reference-interactions-v1' },
  { name: 'aligned-control', profile: 'aligned-interactions-v1' },
  { name: 'aligned-motion-lora', profile: 'aligned-interactions-v1', task: true },
] as const;
const folder = path.resolve(destination); await mkdir(folder, { recursive: false });
const arms = [];
for (const arm of profiles) {
  const requestKey = randomUUID(), request = structuredClone(common);
  if (arm.profile) request.settings.interactionGuide = arm.profile;
  if ('task' in arm) request.settings.loras.push({ name: taskName, strength: 1 });
  const graph = compileOpenjutsu(request.settings, { start, length }, undefined, 'interactions-' + arm.name);
  await writeFile(path.join(folder, arm.name + '.graph.json'), JSON.stringify(graph, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(folder, arm.name + '.request.json'), JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
  arms.push({ name: arm.name, requestKey, graphSHA256: openjutsuGraphHash(graph), interactionGuide: arm.profile || null,
    requestSHA256: createHash('sha256').update(JSON.stringify(request)).digest('hex'), files: openjutsuFiles(request.settings) });
}
const record = { version: 'source-interactions-comparison-v1', preparedAt: new Date().toISOString(), parentId, sourceId: source.id, referenceId: reference.id,
  sourceSHA256, referenceSHA256, start, requestedSeconds: length, expectedSingleSegmentFrames: Math.floor((Math.floor(length * 24) - 5) / 17) * 17 + 5,
  seed: 1729, steps: 6, resolution: '480p', motion: 768, outputFPS: 24, optionalDownload: task,
  controls: 'Same inputs, seed, six steps, current DMAD, Euler/simple, dimensions and native frame grid. No RIFE, Clarity, Fix Faces or source-pixel overlay. The two aligned arms differ only by the optional task adapter/model cache namespace.',
  limits: 'Single window only. Six steps with the current DMAD is experimental: the publisher example uses DMD8/Euler/simple at eight steps. Prompts are common to the aligned pair, but realized captions must be archived before making a strict causal claim. Full-circle, walk-by, cuts, unseen back-view fidelity and exact foreground protection are not established.',
  gpuExecution: 'Not submitted. GPU is paused. No watcher, compute resume, model download or queued job is created by this script.', arms };
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
for (const arm of arms) {
  const request = JSON.parse(await readFile(path.join(folder, arm.name + '.request.json'), 'utf8'));
  if (createHash('sha256').update(JSON.stringify(request)).digest('hex') !== arm.requestSHA256) throw new Error('A comparison request was not saved exactly.');
}
console.log(JSON.stringify({ prepared: true, folder, arms: arms.map(a => a.name), expectedFrames: record.expectedSingleSegmentFrames, optionalBytes: task.size, gpuActions: 0 }));
