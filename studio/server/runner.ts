import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
import { isViggle, planForJob } from '../shared/engines';
import { canFinishImageLocally, isImageJob, type ImageReview } from '../shared/image-replacement';
import { ImageFinalizationError, processImage } from './image-processing';
import { DownloadError, type DownloadProgress } from './download';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class Runner {
  busy = false; active: Job | null = null; abort: AbortController | null = null;
  private resumes = new Map<string, Promise<void>>();
  public geometry: ReferenceGeometry;
  public imageProcessor = processImage;
  constructor(public store: Store, public connection: ConnectionManager, public template: Graph, public repo: string, geometry?: ReferenceGeometry) { this.geometry = geometry || localReferenceGeometry(repo); }
  interrupt(reason: string) {
    this.abort?.abort(new OfflineError(reason));
    for (const job of this.store.jobs()) if (job.origin === 'render' && ['queued', 'running', 'reconnecting'].includes(job.status)) {
      job.status = 'interrupted'; job.error = reason; job.progress.stage = 'GPU instance action requested'; job.progress.value = null; job.progress.max = null; this.store.saveJob(job);
    }
  }
  async kick() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (true) {
        const next = this.store.jobs().reverse().find(j => j.origin === 'render' && !j.deleted && ['queued', 'running', 'reconnecting'].includes(j.status) && (this.connection.status.state === 'online' || canFinishImageLocally(j)));
        if (!next) break;
        this.active = next; this.abort = new AbortController(); await this.run(next, this.abort.signal); this.active = null;
      }
    } finally { this.busy = false; this.active = null; this.abort = null; }
  }
  save(job: Job) { this.store.saveJob(job); }
  stage(job: Job, stage: string, value: number | null = null, max: number | null = null, unit = 'items') { job.progress = { ...job.progress, stage, node: null, value, max, unit, updatedAt: Date.now() }; this.save(job); }
  transferProgress(job: Job, stage: string): DownloadProgress {
    let last = 0;
    return (received, total) => { if (Date.now() - last >= 500 || received === total) { last = Date.now(); this.stage(job, stage, received, total, 'bytes'); } };
  }
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
    if (match) job.submitting = false;
  }
  private async cachedHistory(job: Job): Promise<any | null> {
    try {
      const record = JSON.parse(await readFile(path.join(this.store.root, 'jobs', job.id, `history_${job.segments.length}.json`), 'utf8'));
      const prefix = `recast/${job.id}/segment_${String(job.segments.length).padStart(4, '0')}`;
      return record.prompt?.[1] === job.pendingPrompt && record.prompt?.[2]?.['46']?.inputs.filename_prefix === prefix && record.status?.status_str === 'success' ? record : null;
    } catch { return null; }
  }
  private lostSegment(job: Job) {
    job.status = 'interrupted'; job.retryRequired = true;
    job.error = 'This segment is no longer in the GPU queue or saved history, usually after a server/container restart. Existing local segments are kept. Rendering the missing segment again costs compute; nothing has been resubmitted.';
    job.progress.stage = 'Missing segment · waiting for your choice'; this.save(job);
  }
  async resume(job: Job, retryMissing = false) {
    const existing = this.resumes.get(job.id); if (existing) return existing;
    const task = this.resumeChecked(job, retryMissing); this.resumes.set(job.id, task);
    try { await task; } finally { this.resumes.delete(job.id); }
  }
  private async resumeChecked(job: Job, retryMissing: boolean) {
    if (job.submitting && !job.pendingPrompt) await this.recoverPending(job);
    let missing = !!job.submitting && !job.pendingPrompt;
    if (job.pendingPrompt) {
      const client = this.connection.client(); const history = await client.json('/history/' + job.pendingPrompt); const queue = await client.json('/queue');
      const ids = [...queue.queue_running, ...queue.queue_pending].map((v: any[]) => v[1]);
      missing = !history[job.pendingPrompt] && !ids.includes(job.pendingPrompt) && !await this.cachedHistory(job);
      if (history[job.pendingPrompt || '']?.status?.status_str === 'error') throw new Error('This segment failed on the GPU. Reuse its settings to create a corrected run.');
    }
    if (missing && !retryMissing) { this.lostSegment(job); return; }
    if (missing) { job.pendingPrompt = null; job.submitting = false; }
    job.retryRequired = false; job.status = 'queued'; job.cancelRequested = false; job.cancellationConfirmed = false; job.error = null; this.store.saveJob(job, false); void this.kick();
  }
  async run(job: Job, signal: AbortSignal) {
    const folder = path.join(this.store.root, 'jobs', job.id); await mkdir(folder, { recursive: true });
    const source = this.store.asset(job.sourceId)!, reference = this.store.asset(job.referenceId)!;
    const client = this.connection.client(); let socket: WebSocket | undefined;
    const restore = client.recover;
    if (restore) client.recover = async recoverySignal => {
      job.status = 'reconnecting'; this.stage(job, 'Restoring connection · keeping the same GPU job');
      const recovered = await restore(recoverySignal);
      if (recovered) { job.status = 'running'; this.stage(job, 'Connection restored · checking existing output'); }
      return recovered;
    };
    try {
      this.checkCancelled(job); job.status = 'running'; job.startedAt ||= new Date().toISOString(); this.save(job);
      if (!job.uploads && isImageJob(job) && !canFinishImageLocally(job)) {
        this.stage(job, 'Preparing target and identity references');
        const prepared = await this.imageProcessor('prepare', job, this.store, this.repo, folder, signal) as { hasFace: boolean; warnings: string[] };
        job.image!.prepared = prepared; this.save(job); this.checkCancelled(job);
        const files = [['source', 'target.png'], ['reference', 'identity.png'], ...(prepared.hasFace ? [['face', 'face.png']] : []), ...(job.image!.settings.protectBackground ? [['original', 'original.png'], ['mask', 'edit-mask.png']] : [])];
        const g = job.image!.geometry, nativeMask = g.width === g.outputWidth && g.height === g.outputHeight && g.x === 0 && g.y === 0;
        if (job.image!.version && job.image!.settings.protectBackground && !nativeMask) files.push(['noiseMask', 'working-mask.png']);
        if (['masked-latent-v3', 'masked-latent-v4'].includes(job.image!.version || '') && job.image!.settings.identityRefine) files.push(['faceMask', 'face-refine-mask.png']);
        if (job.image!.version?.startsWith('scene-anchor-')) {
          files.push(['structure', 'source-structure.png']);
          if (job.image!.settings.qwenHeadRefine) files.push(['faceMask', 'face-refine-mask.png'], ['bodyMask', 'body-mask.png']);
        }
        if (['native-mask-v1', 'native-scene-v1', 'identity-first-v1', 'identity-first-v2', 'body-identity-v1', 'body-identity-v2'].includes(job.image!.version || '') && job.image!.settings.qwenHeadRefine) files.push(['faceMask', 'face-refine-mask.png']);
        if (['body-identity-v1', 'body-identity-v2'].includes(job.image!.version || '') && job.image!.settings.qwenNormalizeReference) files.push(['bodyReference', 'body-reference-canvas.png']);
        if (job.image!.version === 'body-identity-v2') files.push(['structure', 'source-pose.png'], ['bodyAppearance', 'body-appearance.png']);
        const uploads: Record<string, string> = {};
        for (const [key, name] of files) { this.stage(job, 'Transferring image inputs to GPU', Object.keys(uploads).length, files.length, 'inputs'); uploads[key] = await client.upload(path.join(folder, name), job.id + '-' + key, signal); this.checkCancelled(job); }
        if (job.image!.version && job.image!.settings.protectBackground && nativeMask) uploads.noiseMask = uploads.mask;
        job.uploads = uploads as NonNullable<Job['uploads']>; this.save(job);
      }
      if (!job.uploads && !isImageJob(job)) {
        this.stage(job, 'Preparing your clip');
        const existingSource = path.join(folder, 'prepared-source.mp4');
        const reusable = job.framingVersion && await exists(path.join(folder, 'reference-framing.json')) && await exists(existingSource);
        const prepared = reusable ? existingSource : await prepareVideo(job, source, folder, signal); this.checkCancelled(job);
        let referenceFile = reference.path;
        if (job.framingVersion && job.settings.mode === 'swap' && !isViggle(job.settings)) {
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
        const plan = isImageJob(job) ? { skip: 0, cap: 1, overlap: 0 } : planForJob(job.settings, job.progress.completedFrames, job.progress.targetFrames, nextSegment, job.viggleSegmentation);
        const receive = (event: any) => { if (!signal.aborted && applyProgress(job, event)) this.save(job); };
        socket = await client.watch('recast-' + job.id, receive).catch(() => undefined);
        if (!job.pendingPrompt) {
          if (job.viggleSegmentation === 'five-frame-v1' && plan.overlap && job.settings.referencePreparation !== 'prepared' && !job.uploads?.preparedFrame) {
            if (!job.keyframe || !await exists(job.keyframe)) throw new Error('The original conditioning frame is unavailable. Restore it before continuing; the character will not be repainted again.');
            this.stage(job, 'Restoring the original conditioning frame');
            job.uploads!.preparedFrame = await client.upload(job.keyframe, job.id + '-prepared-frame', signal); this.save(job);
          }
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
        let history: any = await this.cachedHistory(job), missing = 0, lastSocketAttempt = Date.now();
        const segmentStart = Date.now();
        while (!history) {
          this.checkCancelled(job);
          const id = job.pendingPrompt!; const result = await client.json('/history/' + encodeURIComponent(id), undefined, signal);
          if (result[id]) { history = result[id]; break; }
          const queue = await client.json('/queue', undefined, signal);
          const present = [...queue.queue_running, ...queue.queue_pending].some((v: any[]) => v[1] === id);
          missing = present ? 0 : missing + 1;
          if (missing >= 5) { this.lostSegment(job); return; }
          if ((!socket || socket.readyState !== WebSocket.OPEN) && Date.now() - lastSocketAttempt > 5000) { socket?.close(); socket = await client.watch('recast-' + job.id, receive).catch(() => undefined); lastSocketAttempt = Date.now(); }
          await pause(1500);
        }
        socket?.close(); socket = undefined;
        // Persist a successful paid receipt BEFORE any optional preview or media
        // transfer. Recovery must never pay for a completed window a second time.
        if (history.status?.status_str === 'success') {
          const receipt = path.join(folder, `history_${job.segments.length}.json`);
          await writeFile(receipt + '.part', JSON.stringify(history, null, 2)); await rename(receipt + '.part', receipt);
        }
        // The repainted frame is an auditable intermediate, including when a
        // later sampler fails. Never generate another frame to recover it.
        const keyframe = history.outputs?.['121']?.images?.[0];
        if (isViggle(job.settings) && keyframe && !job.keyframe) {
          const file = path.join(folder, 'keyframe.png');
          try { if (!await exists(file)) await client.download(keyframe, file, signal); job.keyframe = file; this.save(job); }
          catch (error) {
            if (signal.aborted) throw error;
            if (job.viggleSegmentation && job.settings.referencePreparation !== 'prepared') throw new DownloadError('The original repainted frame could not be saved. Resume its download; the completed segment will not be rendered again.');
            await writeFile(path.join(folder, 'keyframe-download-warning.json'), JSON.stringify({ warning: 'The reference preview could not be downloaded. The existing video run was not resubmitted.' }));
          }
        }
        if (isImageJob(job)) for (const [node, name] of [['154', 'body-stage'], ['155', 'body-raw'], ['222', 'head-raw'], ['224', 'head-stage'], ['322', 'lighting-raw'], ['324', 'composition-raw'], ['505', 'reference-normalized']]) {
          const preview = history.outputs?.[node]?.images?.[0]; if (!preview) continue;
          try { const file = path.join(folder, `${name}.png`); if (!await exists(file)) await client.download(preview, file, signal); }
          catch (error) { if (signal.aborted) throw error; await writeFile(path.join(folder, `${name}-preview-warning.json`), JSON.stringify({ warning: 'The intermediate image preview could not be downloaded. No image was resubmitted.' })); }
        }
        let segmentReference: string | undefined;
        if (job.viggleSegmentation === 'last-frame-v2' && keyframe) {
          const name = job.segments.length === 0 ? 'keyframe.png' : `reference_${String(job.segments.length).padStart(4, '0')}.png`;
          try { const file = path.join(folder, name); if (!await exists(file)) await client.download(keyframe, file, signal); segmentReference = name; }
          catch (error) { if (signal.aborted) throw error; /* A missing preview never discards or resamples a paid segment. */ }
        }
        if (history.status?.status_str === 'error') {
          const event = history.status.messages?.find((m: any[]) => m[0] === 'execution_error');
          const text = event?.[1]?.exception_message || 'Generation failed on the GPU.';
          throw new Error(/out of memory/i.test(text) ? 'The GPU ran out of memory. Try 480p or fewer frames per pass, then reuse these settings.' : String(text).slice(0, 1800));
        }
        if (isImageJob(job)) {
          const image = history.outputs?.['46']?.images?.find((file: any) => String(file.filename).endsWith('.png'));
          if (!image) throw new Error('The GPU finished without the expected replacement image.');
          const receipt = path.join(folder, 'history_0.json');
          await writeFile(receipt + '.part', JSON.stringify(history, null, 2)); await rename(receipt + '.part', receipt);
          this.stage(job, 'Saving the completed replacement image');
          const file = path.join(folder, 'gpu-result.png');
          if (!await exists(file)) await client.download(image, file, signal);
          job.segments.push({ file: 'gpu-result.png', promptId: job.pendingPrompt!, frames: 1, seconds: (Date.now() - segmentStart) / 1000 });
          job.pendingPrompt = null; job.progress.completedFrames = 1; this.save(job); continue;
        }
        const outputs = history.outputs || {}, context = outputs['47']?.context?.[0];
        const video = outputs['46']?.gifs?.filter((f: any) => f.filename.endsWith('.mp4')).at(-1);
        if (!context || !video) throw new Error('The GPU finished without the expected video and continuity record.');
        const finalWindow = plan.skip + plan.cap === job.progress.targetFrames;
        if (job.viggleSegmentation && (context.version !== job.viggleSegmentation || context.job_id !== job.id || context.source_count !== plan.cap || context.source_end_frame !== plan.skip + plan.cap || (context.terminal ? !finalWindow : !context.artifact))) throw new Error('The saved Viggle segment receipt does not match its requested source range. Existing output has been retained.');
        const frames = Number(context.source_count) - plan.overlap;
        if (!(frames > 0)) throw new Error('The source ended before this segment added any frames.');
        const file = `segment_${String(job.segments.length).padStart(4, '0')}.mp4`;
        // Retain the completion receipt before transferring media. A later
        // disconnect must not turn a completed paid segment into a new render.
        const receipt = path.join(folder, `history_${job.segments.length}.json`);
        await writeFile(receipt + '.part', JSON.stringify(history, null, 2)); await rename(receipt + '.part', receipt);
        this.stage(job, 'Downloading completed segment');
        if (!await exists(path.join(folder, file))) await client.download(video, path.join(folder, file), signal, this.transferProgress(job, 'Downloading completed segment'));
        if (job.viggleSegmentation && !context.terminal) {
          this.stage(job, 'Saving continuation anchor locally');
          const anchor = path.join(folder, `context_${job.segments.length}.safetensors`);
          if (!await exists(anchor)) await client.download(context.artifact, anchor, signal, this.transferProgress(job, 'Backing up continuity · completed segment is saved'));
        }
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
        job.segments.push({ file, promptId: job.pendingPrompt!, frames, seconds: (Date.now() - segmentStart) / 1000, ...(segmentReference ? { reference: segmentReference } : {}) });
        job.context = context.path; job.pendingPrompt = null; job.progress.completedFrames += frames;
        if (context.source_count < plan.cap) job.progress.targetFrames = job.progress.completedFrames;
        this.save(job);
      }
      this.checkCancelled(job);
      if (isImageJob(job)) {
        this.stage(job, 'Preserving scene pixels and preparing face review');
        job.image!.review = await this.imageProcessor('finish', job, this.store, this.repo, folder, signal) as ImageReview;
        job.output = path.join(folder, 'final.png'); job.poster = path.join(folder, 'poster.jpg'); await poster(job.output, job.poster);
        job.status = 'completed'; job.finishedAt = new Date().toISOString(); job.elapsedSeconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt!)) / 1000;
        this.stage(job, 'Complete · review facial identity and framing'); return;
      }
      this.stage(job, 'Assembling final video');
      const assembly = { source: source.path, settings: { fps: job.settings.fps, start_seconds: Math.floor(job.settings.start * job.settings.fps) / job.settings.fps }, completed_frames: job.progress.completedFrames, segments: job.segments };
      await writeFile(path.join(folder, 'assembly.json'), JSON.stringify(assembly));
      const code = 'import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from render_clip import finish_video;p=Path(sys.argv[2]);finish_video(json.loads((p/"assembly.json").read_text()),p)';
      await command('python3', ['-c', code, path.join(this.repo, 'scripts'), folder], signal, 120000);
      job.output = path.join(folder, 'final.mp4'); job.poster = path.join(folder, 'poster.jpg'); await poster(job.output, job.poster);
      if ((job.framingVersion || isViggle(job.settings)) && job.settings.mode === 'swap') {
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
      job.status = cancelled ? 'cancelled' : saved?.cancelRequested || error instanceof OfflineError || error instanceof DownloadError || error instanceof ImageFinalizationError ? 'interrupted' : 'failed';
      job.error = cancelled ? null : saved?.cancelRequested ? 'Cancellation could not be confirmed. The GPU job may still be running. Reconnect and check cancellation.' : (error instanceof Error ? error.message : String(error));
      if (error instanceof OfflineError) this.connection.disconnect('GPU connection lost. Reconnect to check and resume the existing run.');
      job.progress.stage = cancelled ? 'Cancelled' : error instanceof DownloadError ? 'Download paused · completed render kept' : error instanceof ImageFinalizationError ? 'Image saved · finish local processing' : job.status === 'interrupted' ? 'Connection interrupted' : 'Generation failed';
      job.progress.value = null; job.progress.max = null; this.save(job);
    } finally { socket?.close(); }
  }
}
