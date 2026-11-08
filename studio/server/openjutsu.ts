import { smoothMotionFiles } from '../shared/smooth-motion';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { openjutsuDraftSchema, emptyOpenjutsuDraft, openjutsuFaceDraftSchema, emptyOpenjutsuFaceDraft, openjutsuFaceFiles, type OpenjutsuFaceDraft, type OpenjutsuDraft } from '../shared/openjutsu';
import { z } from 'zod';
import { ingest } from './media';
import { defaults, type Job } from '../shared/types';
import { publicJob, type Store } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { ModelManager } from './models';
import { compileOpenjutsu, compileOpenjutsuFace, openjutsuDimensions, openjutsuGraphHash } from './openjutsu-workflow';
import { fileSHA256 } from './openjutsu-runner';
import { validateGraph } from './workflow';

export async function createOpenjutsuJob(store: Store, connection: ConnectionManager, runner: Runner, models: ModelManager, value: OpenjutsuDraft, key: string, assertIdle: () => void, faceDraft?: OpenjutsuFaceDraft) {
  const prior = store.byKey(key);
  if (prior) { if (!prior.openjutsu || !!prior.openjutsu.face !== !!faceDraft) throw new Error('This request ID belongs to another workflow.'); return prior; }
  const draft = openjutsuDraftSchema.parse(value), source = store.asset(draft.sourceId || ''), reference = store.asset(draft.referenceId || '');
  if (source?.kind !== 'video' || reference?.kind !== 'image' || reference.maskFor) throw new Error('Add a motion video and a character image.');
  const seconds = draft.length || source.duration - draft.start;
  if (!Number.isFinite(source.duration) || seconds < (faceDraft ? 1 / 24 : 2) || draft.start + seconds > source.duration + 1 / 24) throw new Error(faceDraft ? 'Choose a valid section inside the finished video.' : 'Choose at least two seconds inside the source video.');
  assertIdle();
  if (connection.status.state !== 'online') throw new Error('Connect the GPU before generating. Your settings stay saved.');
  const endpoint = connection.status.endpoint, instanceId = store.value<number | null>('cloud-connected-instance', null);
  const same = () => {
    assertIdle();
    if (connection.status.state !== 'online' || connection.status.endpoint !== endpoint || store.value('cloud-connected-instance', null) !== instanceId) throw new Error('The GPU changed while checking this run. Nothing was queued.');
  };
  const [sourceSHA256, referenceSHA256, catalog] = await Promise.all([fileSHA256(source.path), fileSHA256(reference.path), connection.client().json('/object_info')]);
  same();
  if (draft.outputFPS !== 24 && (!models.state.smoothMotionToolsReady || smoothMotionFiles.some(id => models.state.files.find(f => f.id === id)?.status !== 'installed'))) throw new Error('Download Smooth Motion before generating at this output frame rate.');
  const detectors = catalog.H3FaceTrackCrop?.input.required?.detector?.[0];
  const graph = faceDraft ? compileOpenjutsuFace(draft.settings, faceDraft.face, { start: draft.start, length: draft.length }, undefined, Array.isArray(detectors) ? detectors : []) : compileOpenjutsu(draft.settings, { start: draft.start, length: draft.length });
  if (faceDraft) {
    const missing = openjutsuFaceFiles(draft.settings).filter(id => models.state.files.find(file => file.id === id)?.status !== 'installed');
    if (missing.length) throw new Error('Download Fix Faces before processing: ' + missing.join(', '));
    if (faceDraft.parentId) {
      const parent = store.job(faceDraft.parentId);
      if (!parent || parent.deleted || parent.status !== 'completed' || !parent.output || await fileSHA256(parent.output) !== sourceSHA256) throw new Error('The selected original video changed. Choose its completed result again.');
      same();
    }
  }
  // Media filenames are bound only after upload. Admit placeholders in those
  // two widgets only; model choices and all other inputs stay fully validated.
  const validationCatalog = structuredClone(catalog);
  for (const [node, field, placeholder] of [['LoadImage', 'image', 'reference.png'], ['VHS_LoadVideo', 'video', 'source.mp4']]) {
    const rule = validationCatalog[node]?.input.required?.[field];
    if (rule && Array.isArray(rule[0])) rule[0] = [...rule[0], placeholder];
  }
  const issues = validateGraph(graph, validationCatalog);
  if (issues.length) throw new Error((faceDraft ? 'Download Fix Faces' : 'Download Remotion') + ' or prepare the OpenJutsu engine for these settings: ' + issues.slice(0, 4).join(' '));
  const raced = store.byKey(key); if (raced) { if (!raced.openjutsu || !!raced.openjutsu.face !== !!faceDraft) throw new Error('This request ID belongs to another workflow.'); return raced; }
  const id = randomUUID(), frozen = faceDraft ? graph : compileOpenjutsu(draft.settings, { start: draft.start, length: draft.length }, undefined, id);
  const [width, height] = faceDraft ? [source.width, source.height] : openjutsuDimensions(draft.settings, source, reference), frames = Math.floor(seconds * 24);
  const job: Job = { id, title: source.name.replace(/\.[^.]+$/, '') + (faceDraft ? ' / Fix Faces' : ' / Remotion'), status: 'queued', sourceId: source.id, referenceId: reference.id,
    settings: { ...defaults, engine: 'openjutsu', referencePreparation: 'prepared', mode: 'motion', fps: 24, start: draft.start, seconds: Math.min(30, seconds), resolution: '480', randomSeed: false, seed: draft.settings.seed, facialConsistency: 'off', imagenRepaintEnabled: false },
    openjutsu: { version: faceDraft ? 'openjutsu-face-v1' : 'openjutsu-simple-v1', outputFPS: draft.outputFPS, ...(faceDraft ? { face: structuredClone(faceDraft.face), ...(faceDraft.parentId ? { parentId: faceDraft.parentId } : {}) } : {}), settings: structuredClone(draft.settings), section: { start: draft.start, length: draft.length }, sourceSHA256, referenceSHA256, graphSHA256: openjutsuGraphHash(frozen), instanceId, endpoint },
    width, height, createdAt: new Date().toISOString(), favorite: false, deleted: false,
    progress: { stage: 'Queued for Remotion', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: frames, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: frozen };
  same(); store.addJob(job, key); void runner.kick(); return job;
}
export function registerOpenjutsuRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, models: ModelManager, assertIdle: () => void) {
  app.get('/api/openjutsu/face/draft', (_req, res) => res.json(openjutsuFaceDraftSchema.parse(store.value('openjutsu-face-draft', emptyOpenjutsuFaceDraft()))));
  app.post('/api/openjutsu/face/draft', (req, res) => {
    const draft = openjutsuFaceDraftSchema.parse(req.body);
    if (draft.sourceId && store.asset(draft.sourceId)?.kind !== 'video' || draft.referenceId && store.asset(draft.referenceId)?.kind !== 'image') throw new Error('Choose inputs from this library.');
    store.set('openjutsu-face-draft', draft); res.json(draft);
  });
  app.post('/api/openjutsu/face/use', async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(req.body), parent = store.job(jobId);
    if (!parent || parent.deleted || parent.status !== 'completed' || !parent.output || parent.image) return void res.status(400).json({ error: 'Choose a completed video.' });
    const previous = openjutsuFaceDraftSchema.parse(store.value('openjutsu-face-draft', emptyOpenjutsuFaceDraft()));
    const source = previous.parentId === jobId && store.asset(previous.sourceId || '') || await ingest(store, parent.output, 'video', parent.title + '.mp4', true);
    const draft = openjutsuFaceDraftSchema.parse({ ...previous, sourceId: source.id, referenceId: store.asset(parent.referenceId)?.kind === 'image' ? parent.referenceId : previous.referenceId, parentId: jobId, start: 0, length: 0, settings: parent.openjutsu?.settings || previous.settings, face: parent.openjutsu?.face || previous.face });
    store.set('openjutsu-face-draft', draft); res.json({ draft, asset: { ...source, path: '', poster: 'ready' } });
  });
  app.post('/api/openjutsu/face/jobs', async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) return void res.status(400).json({ error: 'A generation request ID is required.' });
    const draft = openjutsuFaceDraftSchema.parse(req.body), { face: _face, parentId: _parent, ...base } = draft;
    res.status(202).json(publicJob(await createOpenjutsuJob(store, connection, runner, models, base, key, assertIdle, draft)));
  });
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
