/** Read-only/offline preparation. Does not submit, upload or resume anything. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { akatzComparisonRequests, akatzSourceSceneRequest, derivedComparisonRequest } from '../shared/akatz-comparison';
import { openjutsuDraftForJob, openjutsuDraftSchema, openjutsuFiles, AKATZ_CHARACTER_LORA } from '../shared/openjutsu';
import { compileOpenjutsu, openjutsuGraphHash } from '../server/openjutsu-workflow';
import { fileSHA256 } from '../server/openjutsu-runner';
import manifest from '../../config/openjutsu-models.lock.json';
import type { Asset, Job } from '../shared/types';

const [database, parentId, destination] = process.argv.slice(2);
if (!database || !parentId || !destination || process.argv.length !== 5) throw new Error('Usage: tsx scripts/prepare-akatz-comparison.ts <database> <completed-aligned-motion-job> <new-output-folder>');
const db = new DatabaseSync(path.resolve(database), { readOnly: true });
const get = <T>(table: 'jobs' | 'assets', id: string): T => {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined;
  if (!row) throw new Error('A saved job/input is missing.');
  return JSON.parse(row.data);
};
let parent: Job, source: Asset, reference: Asset;
try {
  parent = get<Job>('jobs', parentId);
  if (parent.deleted || parent.status !== 'completed' || !parent.openjutsu?.nativeFile || parent.openjutsu.face || !parent.openjutsu.actualFrames) throw new Error('Choose a completed native aligned-motion parent.');
  source = get<Asset>('assets', parent.sourceId); reference = get<Asset>('assets', parent.referenceId);
} finally { db.close(); }
if (source.kind !== 'video' || reference.kind !== 'image' || !source.hasAudio) throw new Error('The comparison needs a video with audio and a character image.');
const native = parent.openjutsu!;
const [sourceSHA256, referenceSHA256, baselineSHA256] = await Promise.all([fileSHA256(source.path), fileSHA256(reference.path), fileSHA256(native.nativeFile!)]);
if (sourceSHA256 !== native.sourceSHA256 || referenceSHA256 !== native.referenceSHA256 || baselineSHA256 !== native.nativeSHA256) throw new Error('An immutable input or baseline video changed.');
const base = openjutsuDraftSchema.parse({ ...openjutsuDraftForJob(parent), outputFPS: 24 });
const requests = akatzComparisonRequests(base), folder = path.resolve(destination);
await mkdir(folder, { recursive: false });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const arms = [];
for (const arm of requests) {
  const requestKey = randomUUID(), graph = compileOpenjutsu(arm.request.settings, { start: arm.request.start, length: arm.request.length }, undefined, 'akatz-' + arm.name);
  await writeFile(path.join(folder, arm.name + '.request.json'), JSON.stringify(arm.request, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(folder, arm.name + '.graph.json'), JSON.stringify(graph, null, 2) + '\n', { flag: 'wx' });
  arms.push({ name: arm.name, requestKey, requestSHA256: hash(arm.request), graphSHA256: openjutsuGraphHash(graph), files: openjutsuFiles(arm.request.settings), ...(arm.name === 'motion-control' ? { reuseCompletedJob: parentId, nativeSHA256: baselineSHA256 } : {}) });
}
const swapFirst = akatzSourceSceneRequest(base);
const sequences = {
  swapThenMotion: { firstStage: swapFirst, secondStageTemplate: { ...derivedComparisonRequest(base, 'DERIVED', native.actualFrames!), sourceId: null }, firstRequestKey: randomUUID(), secondRequestKey: randomUUID() },
  motionThenSwap: { reuseFirstJob: parentId, firstNativeSHA256: baselineSHA256, secondStageTemplate: { ...derivedComparisonRequest(swapFirst, 'DERIVED', native.actualFrames!), sourceId: null }, secondRequestKey: randomUUID() },
};
await writeFile(path.join(folder, 'sequences.json'), JSON.stringify(sequences, null, 2) + '\n', { flag: 'wx' });
const record = { version: 'akatz-motion-comparison-v1', preparedAt: new Date().toISOString(), parentId, sourceId: source.id, referenceId: reference.id, sourceSHA256, referenceSHA256, baselineSHA256,
  expectedNativeFrames: native.actualFrames, outputFPS: 24, optionalDownload: manifest.files.find(f => f.destination === 'loras/' + AKATZ_CHARACTER_LORA), arms, sequencesSHA256: hash(sequences),
  controls: 'Keep the existing inputs, prompt templates, aligned guidance, seed, DMAD and six Euler/simple steps. Combined strengths are exploratory; Akatz alone means only its task adapter replaces Motion Transfer, with DMAD retained.',
  limits: 'Not the publisher Turbo8/er_sde/normal/masked-native-video recipe. No claim that a failed current-recipe arm disproves Akatz. Realized captions must be captured for a strict causal comparison. No extra character sheets in this matrix.',
  sequenceContract: 'Second-stage templates have no source and cannot be submitted directly. Require a completed native first stage, exact expected frame count/FPS, verified SHA256 and an ingested derivative bound to that result. Materialize/freeze a new request once, keep its key for acknowledgement retries, and never overwrite either parent. Upscale/face finishing excluded.',
  execution: 'No submission, weight download, GPU operation or watcher. Earlier20cent allowance is closed; a new bounded authorization is required.' };
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, arms: arms.map(a => a.name), baselineReuse: true, optionalBytes: record.optionalDownload!.size, expectedFrames: record.expectedNativeFrames, additionalSinglePassJobs: 4, additionalJobsForBothOrders: 3, gpuActions: 0 }));
