/** Offline only: freeze a three-arm comparison; never contacts a GPU/provider. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileOpenjutsu, openjutsuGraphHash } from '../server/openjutsu-workflow';
import { fileSHA256 } from '../server/openjutsu-runner';
import { openjutsuDraftSchema } from '../shared/openjutsu';
import type { Asset, Job } from '../shared/types';

const [database, parentId, destination] = process.argv.slice(2);
if (!database || !parentId || !destination || process.argv.length !== 5) throw new Error('Usage: tsx scripts/prepare-source-face-guide.ts <studio.sqlite> <completed-job-id> <new-output-folder>');
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
if (parent.openjutsu!.settings.noLipSync) throw new Error('Use an audio-enabled parent.');
const [sourceSHA256, referenceSHA256] = await Promise.all([fileSHA256(source.path), fileSHA256(reference.path)]);
if (sourceSHA256 !== parent.openjutsu!.sourceSHA256 || referenceSHA256 !== parent.openjutsu!.referenceSHA256) throw new Error('A paid parent input changed. No comparison was prepared.');
const start = parent.openjutsu!.section.start, length = Math.min(5, parent.openjutsu!.section.length || source.duration - start);
if (length < 4.5) throw new Error('Choose a parent with at least 4.5 seconds for this bounded comparison.');
const common = openjutsuDraftSchema.parse({ sourceId: source.id, referenceId: reference.id, start, length, outputFPS: 24,
  settings: { ...parent.openjutsu!.settings, seed: 1729, clipSeconds: 5 } });
delete common.settings.sourceFaceGuide;
const profiles = [undefined, 'source-face-guide-v1', 'source-face-detail-v1'] as const;
const folder = path.resolve(destination);
await mkdir(folder, { recursive: false });
const arms = [];
for (const profile of profiles) {
  const name = profile || 'control', requestKey = randomUUID();
  const request = structuredClone(common);
  if (profile) request.settings.sourceFaceGuide = profile;
  const graph = compileOpenjutsu(request.settings, { start, length }, undefined, 'face-guide-comparison');
  await writeFile(path.join(folder, name + '.graph.json'), JSON.stringify(graph, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(folder, name + '.request.json'), JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
  arms.push({ name, requestKey, graphSHA256: openjutsuGraphHash(graph), sourceFaceGuide: profile || null,
    requestSHA256: createHash('sha256').update(JSON.stringify(request)).digest('hex') });
}
const manifest = { version: 'source-face-guide-comparison-v1', preparedAt: new Date().toISOString(), parentId, sourceId: source.id, referenceId: reference.id,
  sourceSHA256, referenceSHA256, start, requestedSeconds: length, expectedSingleSegmentFrames: Math.floor((Math.floor(length * 24) - 5) / 17) * 17 + 5,
  seed: common.settings.seed, steps: common.settings.steps, resolution: common.settings.resolution, motion: common.settings.motion, outputFPS: 24,
  controls: 'Same source/photo/audio, seed, prompts, H3 model, existing DMAD adapter, Euler/simple schedule, dimensions and native frame grid. No RIFE, Clarity or Fix Faces.',
  scope: 'Only the native grey face-guide nodes and their frozen blur differ. No source-face compositing, new weights, sampler tuning or default promotion.',
  gpuExecution: 'Not submitted. Requires an available user-connected GPU and separately observed idle/readiness before each explicit submission.', arms };
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
// Re-read written inputs so the manifest is reviewable without trusting an
// in-memory preview. Request IDs stay fixed for any later acknowledgement retry.
for (const arm of arms) {
  const actual = JSON.parse(await readFile(path.join(folder, arm.name + '.request.json'), 'utf8'));
  if (createHash('sha256').update(JSON.stringify(actual)).digest('hex') !== arm.requestSHA256) throw new Error('A comparison request was not saved exactly.');
}
console.log(JSON.stringify({ prepared: true, folder, arms: arms.map(a => a.name), expectedFrames: manifest.expectedSingleSegmentFrames, gpuActions: 0 }));
