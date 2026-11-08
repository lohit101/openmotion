import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { defaults, type Graph, type Job } from '../shared/types';
import { emptySmoothMotionDraft, smoothMotionDraftSchema, smoothMotionFiles, type SmoothMotionRun } from '../shared/smooth-motion';
import { publicJob, type Store } from './store';
import type { Runner } from './runner';
import type { ConnectionManager } from './comfy';
import type { ModelManager } from './models';
import { fileSHA256 } from './openjutsu-runner';
import { openjutsuGraphHash } from './openjutsu-workflow';
import { ingest } from './media';

export function compileSmoothMotion(id: string, hash: string, fps: 30 | 48 | 60, video = 'source.mp4'): Graph {
  return { '1': { class_type: 'RecastSmoothVideoV1', inputs: { video, source_sha256: hash, target_fps: fps, run_id: id, model_name: 'rife_v4.25.safetensors' }, _meta: { title: 'Smoothing motion' } } };
}
export function automaticSmoothMotion(job: Job): SmoothMotionRun {
  const run = job.openjutsu!, fps = run.outputFPS;
  if (!run.nativeFile || !run.nativeSHA256 || !fps || fps === 24 || !run.actualSeconds) throw new Error('The native render must be saved before smoothing.');
  const graph = compileSmoothMotion(job.id, run.nativeSHA256, fps);
  return { version: 'smooth-motion-v1', targetFPS: fps, sourceFile: run.nativeFile, sourceSHA256: run.nativeSHA256, sourceSeconds: run.actualSeconds, automatic: true, instanceId: run.instanceId, endpoint: run.endpoint, graph, graphSHA256: openjutsuGraphHash(graph) };
}
export function registerSmoothMotionRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, models: ModelManager, assertIdle: () => void) {
  app.get('/api/smooth-motion/draft', (_req, res) => res.json(smoothMotionDraftSchema.parse(store.value('smooth-motion-draft', emptySmoothMotionDraft()))));
  app.post('/api/smooth-motion/draft', (req, res) => {
    const d = smoothMotionDraftSchema.parse(req.body);
    if (d.sourceId && store.asset(d.sourceId)?.kind !== 'video') throw new Error('Choose a video from this library.');
    store.set('smooth-motion-draft', d); res.json(d);
  });
  app.post('/api/smooth-motion/use', async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(req.body), parent = store.job(jobId);
    if (!parent || parent.deleted || parent.status !== 'completed' || !parent.output || parent.image) throw new Error('Choose a completed video.');
    const previous = smoothMotionDraftSchema.parse(store.value('smooth-motion-draft', emptySmoothMotionDraft()));
    const source = previous.parentId === jobId && store.asset(previous.sourceId || '') || await ingest(store, parent.output, 'video', parent.title + '.mp4', true);
    const draft = { ...previous, sourceId: source.id, parentId: jobId }; store.set('smooth-motion-draft', draft);
    res.json({ draft, asset: { ...source, path: '', poster: 'ready' } });
  });
  app.post('/api/smooth-motion/jobs', async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!key || key.length > 120) throw new Error('A processing request ID is required.');
    const draft = smoothMotionDraftSchema.parse(req.body), existing = store.byKey(key);
    if (existing) {
      if (!existing.smoothMotion || existing.smoothMotion.automatic || existing.sourceId !== draft.sourceId || existing.smoothMotion.targetFPS !== draft.fps || existing.smoothMotion.parentId !== (draft.parentId || undefined)) throw new Error('This request ID belongs to different inputs.');
      return void res.json(publicJob(existing));
    }
    assertIdle(); const source = store.asset(draft.sourceId || '');
    if (source?.kind !== 'video' || source.duration <= 0 || source.duration > 300) throw new Error('Choose a video up to five minutes long.');
    if (connection.status.state !== 'online' || !models.state.smoothMotionToolsReady || smoothMotionFiles.some(id => models.state.files.find(f => f.id === id)?.status !== 'installed')) throw new Error('Use Download Smooth Motion to prepare the model and tools first.');
    const endpoint = connection.status.endpoint, instanceId = store.value<number | null>('cloud-connected-instance', null), hash = await fileSHA256(source.path);
    if (draft.parentId) { const parent = store.job(draft.parentId); if (!parent || parent.deleted || parent.status !== 'completed' || !parent.output || await fileSHA256(parent.output) !== hash) throw new Error('The original video changed. Select it again.'); }
    assertIdle(); if (connection.status.state !== 'online' || connection.status.endpoint !== endpoint || store.value('cloud-connected-instance', null) !== instanceId) throw new Error('The GPU changed during validation. Nothing was queued.');
    const raced = store.byKey(key); if (raced) return void res.json(publicJob(raced));
    const id = randomUUID(), graph = compileSmoothMotion(id, hash, draft.fps);
    const run: SmoothMotionRun = { version: 'smooth-motion-v1', targetFPS: draft.fps, sourceFile: source.path, sourceSHA256: hash, sourceSeconds: source.duration, ...(draft.parentId ? { parentId: draft.parentId } : {}), instanceId, endpoint, graph, graphSHA256: openjutsuGraphHash(graph) };
    const job: Job = { id, title: source.name.replace(/\.[^.]+$/, '') + ` / ${draft.fps}fps`, status: 'queued', sourceId: source.id, referenceId: '', settings: { ...defaults, fps: 24, seconds: Math.min(30, source.duration) }, smoothMotion: run,
      width: source.width, height: source.height, createdAt: new Date().toISOString(), favorite: false, deleted: false, origin: 'render', workflow: graph,
      progress: { stage: 'Queued for Smooth Motion', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: 0, targetFrames: Math.ceil(source.duration * draft.fps), updatedAt: Date.now() }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null };
    store.addJob(job, key); void runner.kick(); res.status(202).json(publicJob(job));
  });
}
