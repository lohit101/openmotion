import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { compileWorkflow, validateGraph } from './workflow';
import { applyProgress, ConnectionManager, OfflineError } from './comfy';
import { command, poster, prepareVideo } from './media';
import type { Store } from './store';
import type { Graph, Job } from '../shared/types';
import { nextSegment } from '../shared/types';
import { exists, localReferenceGeometry, type ReferenceGeometry } from './framing';
import { missingPinnedAdapters } from './models';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class Runner {
  busy = false; active: Job | null = null; abort: AbortController | null = null;
  public geometry: ReferenceGeometry;
  constructor(public store: Store, public connection: ConnectionManager, public template: Graph, public repo: string, geometry?: ReferenceGeometry) { this.geometry = geometry || localReferenceGeometry(repo); }
  interrupt(reason: string) {
    this.abort?.abort(new OfflineError(reason));
    for (const job of this.store.jobs()) if (job.origin === 'render' && ['queued', 'running', 'reconnecting'].includes(job.status)) {
      job.status = 'interrupted'; job.error = reason; job.progress.stage = 'GPU instance action requested'; job.progress.value = null; job.progress.max = null; this.store.saveJob(job);
    }
  }
  async kick() {
    if (this.busy || this.connection.status.state !== 'online') return;
    this.busy = true;
    try {
      while (this.connection.status.state === 'online') {
        const next = this.store.jobs().reverse().find(j => j.origin === 'render' && !j.deleted && ['queued', 'running', 'reconnecting'].includes(j.status));
        if (!next) break;
        this.active = next; this.abort = new AbortController(); await this.run(next, this.abort.signal); this.active = null;
      }
    } finally { this.busy = false; this.active = null; this.abort = null; }
  }
  save(job: Job) { this.store.saveJob(job); }
  stage(job: Job, stage: string, value: number | null = null, max: number | null = null, unit = 'items') { job.progress = { ...job.progress, stage, node: null, value, max, unit, updatedAt: Date.now() }; this.save(job); }
  checkCancelled(job: Job) { if (this.store.job(job.id)?.cancelRequested) throw new Error('Cancelled.'); }
  async cancel(job: Job) {
    job.cancelRequested = true;
    this.store.saveJob(job, false);
    try {
      if (job.submitting && !job.pendingPrompt) {
        for (let i = 0; i < 30 && !job.pendingPrompt; i++) { await pause(400); job.pendingPrompt = this.store.job(job.id)?.pendingPrompt || (this.active?.id === job.id ? this.active.pendingPrompt : null) || null; }
        if (!job.pendingPrompt) await this.recoverPending(job);
        if (!job.pendingPrompt) throw new OfflineError('Cancellation could not be confirmed. Reconnect and check cancellation; the request may still be running on the GPU.');
      }
      if (job.pendingPrompt) await this.connection.client().cancel(job.pendingPrompt);
      job.cancellationConfirmed = true; job.status = 'cancelled'; job.progress.stage = 'Cancelled'; this.store.saveJob(job, false);
      if (this.active?.id === job.id) this.abort?.abort();
    } catch (error) {
      job.status = 'interrupted'; job.error = 'Cancellation could not be confirmed. The GPU job may still be running. Reconnect and check cancellation.'; this.store.saveJob(job, false);
      if (this.active?.id === job.id) this.abort?.abort();
      throw error;
    }
  }
  async recoverPending(job: Job) {
    const client = this.connection.client(); const queue = await client.json('/queue'); const histories = await client.json('/history?max_items=100');
    const prefix = `recast/${job.id}/segment_${String(job.segments.length).padStart(4, '0')}`;
    const match = [...queue.queue_running, ...queue.queue_pending, ...Object.values(histories).map((h: any) => h.prompt)]
      .find((entry: any[]) => entry?.[3]?.client_id === 'recast-' + job.id && entry?.[2]?.['46']?.inputs.filename_prefix === prefix);
    if (match) job.pendingPrompt = match[1];
    job.submitting = false;
  }
  async resume(job: Job) {
    if (job.submitting && !job.pendingPrompt) await this.recoverPending(job);
    if (job.pendingPrompt) {
      const client = this.connection.client(); const history = await client.json('/history/' + job.pendingPrompt); const queue = await client.json('/queue');
      const ids = [...queue.queue_running, ...queue.queue_pending].map((v: any[]) => v[1]);
      if (!history[job.pendingPrompt] && !ids.includes(job.pendingPrompt)) job.pendingPrompt = null;
      if (history[job.pendingPrompt || '']?.status?.status_str === 'error') throw new Error('This segment failed on the GPU. Reuse its settings to create a corrected run.');
    }
    job.status = 'queued'; job.cancelRequested = false; job.cancellationConfirmed = false; job.error = null; this.store.saveJob(job, false); void this.kick();
  }
  async run(job: Job, signal: AbortSignal) {
    const folder = path.join(this.store.root, 'jobs', job.id); await mkdir(folder, { recursive: true });
    const source = this.store.asset(job.sourceId)!, reference = this.store.asset(job.referenceId)!;
    const client = this.connection.client(); let socket: WebSocket | undefined;
    try {
      this.checkCancelled(job); job.status = 'running'; job.startedAt ||= new Date().toISOString(); this.save(job);
      if (!job.uploads) {
        this.stage(job, 'Preparing your clip');
        const existingSource = path.join(folder, 'prepared-source.mp4');
        const reusable = job.framingVersion && await exists(path.join(folder, 'reference-framing.json')) && await exists(existingSource);
        const prepared = reusable ? existingSource : await prepareVideo(job, source, folder, signal); this.checkCancelled(job);
        let referenceFile = reference.path;
        if (job.framingVersion && job.settings.mode === 'swap') {
          this.stage(job, 'Matching character to source framing');
          const aligned = await this.geometry.prepare(job, prepared, reference.path, folder, signal);
          referenceFile = aligned.file; job.referenceFraming = aligned.summary; this.save(job); this.checkCancelled(job);
        }
        this.stage(job, 'Transferring inputs to GPU', 0, 2, 'inputs');
        const video = await client.upload(prepared, job.id + '-source', signal); this.stage(job, 'Transferring inputs to GPU', 1, 2, 'inputs');
        const image = await client.upload(referenceFile, job.id + '-reference', signal); job.uploads = { source: video, reference: image }; this.save(job);
      }
      while (job.progress.completedFrames < job.progress.targetFrames) {
        this.checkCancelled(job);
        job.progress.segment = job.segments.length + 1;
        const plan = nextSegment(job.progress.completedFrames, job.progress.targetFrames, job.settings.framesPerPass);
        const receive = (event: any) => { if (!signal.aborted && applyProgress(job, event)) this.save(job); };
        socket = await client.watch('recast-' + job.id, receive).catch(() => undefined);
        if (!job.pendingPrompt) {
          this.stage(job, 'Checking workflow'); const graph = compileWorkflow(this.template, job);
          const liveCatalog = await client.json('/object_info', undefined, signal);
          const missing = missingPinnedAdapters(graph, liveCatalog);
          if (missing.length) throw new Error('Download the selected adapters in Models before generating: ' + missing.join(', '));
          const issues = validateGraph(graph, liveCatalog);
          if (issues.length) throw new Error(issues.slice(0, 4).join(' '));
          job.workflow = graph; await writeFile(path.join(folder, `workflow_${job.segments.length}.json`), JSON.stringify(graph, null, 2));
          this.checkCancelled(job); this.stage(job, 'Waiting for GPU');
          job.submitting = true; this.save(job);
          // Keep submission alive through cancellation so its returned ID can be cancelled precisely.
          const response = await client.json('/prompt', { prompt: graph, client_id: 'recast-' + job.id });
          if (response.node_errors && Object.keys(response.node_errors).length) throw new Error('ComfyUI rejected the workflow: ' + JSON.stringify(response.node_errors).slice(0, 1200));
          if (!response.prompt_id) throw new Error('ComfyUI did not return a job ID.');
          job.pendingPrompt = response.prompt_id; job.submitting = false; this.save(job);
          if (this.store.job(job.id)?.cancelRequested) { await client.cancel(job.pendingPrompt!); const saved = this.store.job(job.id)!; saved.cancellationConfirmed = true; this.store.saveJob(saved, false); throw new Error('Cancelled.'); }
        }
        let history: any, missing = 0, lastSocketAttempt = Date.now();
        const segmentStart = Date.now();
        while (!history) {
          this.checkCancelled(job);
          const id = job.pendingPrompt!; const result = await client.json('/history/' + encodeURIComponent(id), undefined, signal);
          if (result[id]) { history = result[id]; break; }
          const queue = await client.json('/queue', undefined, signal);
          const present = [...queue.queue_running, ...queue.queue_pending].some((v: any[]) => v[1] === id);
          missing = present ? 0 : missing + 1;
          if (missing >= 5) throw new OfflineError('This job is absent from ComfyUI after a restart. Resume to rerun only the unfinished segment.');
          if ((!socket || socket.readyState !== WebSocket.OPEN) && Date.now() - lastSocketAttempt > 5000) { socket?.close(); socket = await client.watch('recast-' + job.id, receive).catch(() => undefined); lastSocketAttempt = Date.now(); }
          await pause(1500);
        }
        socket?.close(); socket = undefined;
        if (history.status?.status_str === 'error') {
          const event = history.status.messages?.find((m: any[]) => m[0] === 'execution_error');
          const text = event?.[1]?.exception_message || 'Generation failed on the GPU.';
          throw new Error(/out of memory/i.test(text) ? 'The GPU ran out of memory. Try 480p or fewer frames per pass, then reuse these settings.' : String(text).slice(0, 1800));
        }
        const outputs = history.outputs || {}, context = outputs['47']?.context?.[0];
        const video = outputs['46']?.gifs?.filter((f: any) => f.filename.endsWith('.mp4')).at(-1);
        if (!context || !video) throw new Error('The GPU finished without the expected video and continuity record.');
        const frames = Number(context.source_count) - plan.overlap;
        if (!(frames > 0)) throw new Error('The source ended before this segment added any frames.');
        const file = `segment_${String(job.segments.length).padStart(4, '0')}.mp4`;
        this.stage(job, 'Downloading completed segment'); await client.download(video, path.join(folder, file), signal);
        await writeFile(path.join(folder, `history_${job.segments.length}.json`), JSON.stringify(history, null, 2));
        if (job.saveDiagnosticLatent) {
          const latent = outputs['51']?.latents?.[0];
          try {
            if (!latent) throw new Error('No diagnostic latent was returned.');
            await client.download(latent, path.join(folder, `latent_${String(job.segments.length).padStart(4, '0')}.latent`), signal);
          } catch (error) {
            if (signal.aborted) throw error;
            // Diagnostics must not discard a completed paid render or cause it
            // to be sampled again. The saved segment remains authoritative.
            await writeFile(path.join(folder, `latent_${job.segments.length}_unavailable.json`), JSON.stringify({ warning: 'The completed video was retained but the optional latent export was unavailable.' }));
          }
        }
        job.segments.push({ file, promptId: job.pendingPrompt!, frames, seconds: (Date.now() - segmentStart) / 1000 });
        job.context = context.path; job.pendingPrompt = null; job.progress.completedFrames += frames;
        if (context.source_count < plan.cap) job.progress.targetFrames = job.progress.completedFrames;
        this.save(job);
      }
      this.checkCancelled(job); this.stage(job, 'Assembling final video');
      const assembly = { source: source.path, settings: { fps: job.settings.fps, start_seconds: Math.floor(job.settings.start * job.settings.fps) / job.settings.fps }, completed_frames: job.progress.completedFrames, segments: job.segments };
      await writeFile(path.join(folder, 'assembly.json'), JSON.stringify(assembly));
      const code = 'import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from render_clip import finish_video;p=Path(sys.argv[2]);finish_video(json.loads((p/"assembly.json").read_text()),p)';
      await command('python3', ['-c', code, path.join(this.repo, 'scripts'), folder], signal, 120000);
      job.output = path.join(folder, 'final.mp4'); job.poster = path.join(folder, 'poster.jpg'); await poster(job.output, job.poster);
      if (job.framingVersion && job.settings.mode === 'swap') {
        this.stage(job, 'Checking subject scale and position');
        try { job.framingCheck = await this.geometry.check(job, path.join(folder, 'prepared-source.mp4'), job.output, folder, signal); }
        catch (error) {
          if (signal.aborted) throw error;
          job.framingCheck = { status: 'unverified', samples: [], warnings: ['The video was saved, but its framing could not be checked. Review it against the source before using it.'] };
        }
      }
      job.status = 'completed'; job.finishedAt = new Date().toISOString(); job.elapsedSeconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt!)) / 1000;
      this.stage(job, job.framingCheck && job.framingCheck.status !== 'matched' ? 'Complete · review framing' : 'Complete', null, null);
    } catch (error) {
      if (signal.aborted && signal.reason instanceof OfflineError) error = signal.reason;
      const saved = this.store.job(job.id); const cancelled = saved?.cancelRequested && saved.cancellationConfirmed;
      job.status = cancelled ? 'cancelled' : saved?.cancelRequested || error instanceof OfflineError ? 'interrupted' : 'failed';
      job.error = cancelled ? null : saved?.cancelRequested ? 'Cancellation could not be confirmed. The GPU job may still be running. Reconnect and check cancellation.' : (error instanceof Error ? error.message : String(error));
      if (error instanceof OfflineError) this.connection.disconnect('GPU connection lost. Reconnect to check and resume the existing run.');
      job.progress.stage = cancelled ? 'Cancelled' : job.status === 'interrupted' ? 'Connection interrupted' : 'Generation failed';
      job.progress.value = null; job.progress.max = null; this.save(job);
    } finally { socket?.close(); }
  }
}
