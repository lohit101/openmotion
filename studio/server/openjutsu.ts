import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { openjutsuDraftSchema, emptyOpenjutsuDraft, openjutsuFiles, type OpenjutsuDraft } from '../shared/openjutsu';
import { defaults, type Job } from '../shared/types';
import { publicJob, type Store } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { ModelManager } from './models';
import { compileOpenjutsu, openjutsuDimensions, openjutsuGraphHash } from './openjutsu-workflow';
import { fileSHA256 } from './openjutsu-runner';
import { validateGraph } from './workflow';

export async function createOpenjutsuJob(store: Store, connection: ConnectionManager, runner: Runner, models: ModelManager, value: OpenjutsuDraft, key: string, assertIdle: () => void) {
  const prior = store.byKey(key);
  if (prior) { if (!prior.openjutsu) throw new Error('This request ID belongs to another workflow.'); return prior; }
  const draft = openjutsuDraftSchema.parse(value), source = store.asset(draft.sourceId || ''), reference = store.asset(draft.referenceId || '');
  if (source?.kind !== 'video' || reference?.kind !== 'image' || reference.maskFor) throw new Error('Add a motion video and a character image.');
  const seconds = draft.length || source.duration - draft.start;
  if (!Number.isFinite(source.duration) || seconds < 2 || draft.start + seconds > source.duration + 1 / 24) throw new Error('Choose at least two seconds inside the source video.');
  assertIdle();
  if (connection.status.state !== 'online') throw new Error('Connect the GPU before generating. Your settings stay saved.');
  const endpoint = connection.status.endpoint, instanceId = store.value<number | null>('cloud-connected-instance', null);
  const same = () => {
    assertIdle();
    if (connection.status.state !== 'online' || connection.status.endpoint !== endpoint || store.value('cloud-connected-instance', null) !== instanceId) throw new Error('The GPU changed while checking this run. Nothing was queued.');
  };
  const graph = compileOpenjutsu(draft.settings, { start: draft.start, length: draft.length });
  const [sourceSHA256, referenceSHA256, catalog] = await Promise.all([fileSHA256(source.path), fileSHA256(reference.path), connection.client().json('/object_info')]);
  same();
  // Media filenames are bound only after upload. Admit placeholders in those
  // two widgets only; model choices and all other inputs stay fully validated.
  const validationCatalog = structuredClone(catalog);
  for (const [node, field, placeholder] of [['LoadImage', 'image', 'reference.png'], ['VHS_LoadVideo', 'video', 'source.mp4']]) {
    const rule = validationCatalog[node]?.input.required?.[field];
    if (rule && Array.isArray(rule[0])) rule[0] = [...rule[0], placeholder];
  }
  const issues = validateGraph(graph, validationCatalog);
  if (issues.length) throw new Error('Download Remotion or prepare the OpenJutsu engine for these settings: ' + issues.slice(0, 4).join(' '));
  const raced = store.byKey(key); if (raced) { if (!raced.openjutsu) throw new Error('This request ID belongs to another workflow.'); return raced; }
  const id = randomUUID(), frozen = compileOpenjutsu(draft.settings, { start: draft.start, length: draft.length }, undefined, id);
  const [width, height] = openjutsuDimensions(draft.settings, source, reference), frames = Math.floor(seconds * 24);
  const job: Job = { id, title: source.name.replace(/\.[^.]+$/, '') + ' / Remotion', status: 'queued', sourceId: source.id, referenceId: reference.id,
    settings: { ...defaults, engine: 'openjutsu', referencePreparation: 'prepared', mode: 'motion', fps: 24, start: draft.start, seconds: Math.min(30, seconds), resolution: '480', randomSeed: false, seed: draft.settings.seed, facialConsistency: 'off', imagenRepaintEnabled: false },
    openjutsu: { version: 'openjutsu-simple-v1', settings: structuredClone(draft.settings), section: { start: draft.start, length: draft.length }, sourceSHA256, referenceSHA256, graphSHA256: openjutsuGraphHash(frozen), instanceId, endpoint },
    width, height, createdAt: new Date().toISOString(), favorite: false, deleted: false,
    progress: { stage: 'Queued for Remotion', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: frames, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: frozen };
  same(); store.addJob(job, key); void runner.kick(); return job;
}
export function registerOpenjutsuRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, models: ModelManager, assertIdle: () => void) {
  app.get('/api/openjutsu/catalog', (_req, res) => res.json(connection.status.state === 'online' ? Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'SpectrumApplyMiniMaxH3'].filter(name => connection.catalog[name]).map(name => [name, connection.catalog[name]])) : {}));
  app.get('/api/openjutsu/draft', (_req, res) => res.json(openjutsuDraftSchema.parse(store.value('openjutsu-draft', emptyOpenjutsuDraft()))));
  app.post('/api/openjutsu/draft', (req, res) => {
    const draft = openjutsuDraftSchema.parse(req.body);
    if (draft.sourceId && store.asset(draft.sourceId)?.kind !== 'video' || draft.referenceId && store.asset(draft.referenceId)?.kind !== 'image') throw new Error('Choose inputs from this library.');
    store.set('openjutsu-draft', draft); res.json(draft);
  });
  app.post('/api/openjutsu/jobs', async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A generation request ID is required.' });
    res.status(202).json(publicJob(await createOpenjutsuJob(store, connection, runner, models, req.body, key, assertIdle)));
  });
}
