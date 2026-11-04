import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Job, Asset } from '../shared/types';
import { defaults } from '../shared/types';
import { KIE_MODEL, kieDraftSchema, kiePrompt, type KieDraft, type KiePhase } from '../shared/kie';
import { command, poster, probe, videoFrameInfo } from './media';
import type { Store } from './store';
import type { KieAccount } from './kie-account';
import { KieApiError, type KieClient, type KieVideoInput } from './kie-client';

export type KieClientLike = Pick<KieClient, 'getCredits' | 'uploadFile' | 'createTask' | 'getTask' | 'downloadResult'>;
const active = ['queued', 'running', 'reconnecting'];
const hashText = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function kieFileHash(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function json(file: string, value: unknown) { const temporary = file + '.tmp'; await writeFile(temporary, JSON.stringify(value) + '\n'); await rename(temporary, file); }
async function readJSON<T>(file: string): Promise<T | null> { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('A saved Kie task receipt is unreadable. Keep its files and restore the receipt before recovery.'); } }
interface Frozen { version: 1; draft: KieDraft; fingerprint: string; sourceOriginalSHA256: string; referenceOriginalSHA256: string; }
interface Prepared { fingerprint: string; sourceSHA256: string; referenceSHA256: string; duration: number; hasAudio: boolean; }
interface Uploads { source?: { url: string; expiresAt?: string | number }; reference?: { url: string; expiresAt?: string | number }; }
interface Intent { fingerprint: string; input: KieVideoInput; attemptedAt: string; state: 'not-submitted' | 'submitting' | 'submitted' | 'unknown' | 'rejected'; taskId?: string; }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export class KieJobs {
  private activeId: string | null = null;
  private task: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private closing = false;
  private creating = new Map<string, Promise<Job>>();
  constructor(public store: Store, private account: KieAccount, private client: KieClientLike, private pollMs = 5000) {
    // Opening this app never uploads or submits anything. Recovery is explicit.
    for (const job of store.jobs()) if (job.kie && [...active, 'interrupted', 'cancelled'].includes(job.status)) {
      const journal = path.join(this.folder(job), 'kie-submission.json');
      if (!job.kie.taskId && existsSync(journal)) {
        try {
          const saved: Intent = JSON.parse(readFileSync(journal, 'utf8'));
          if (saved.fingerprint !== job.kie.requestFingerprint) throw new Error('Submission binding changed');
          if (saved.taskId && /^[A-Za-z0-9_-]{1,200}$/.test(saved.taskId)) { job.kie.taskId = saved.taskId; job.kie.submission = 'submitted'; store.saveJob(job); }
          else if (['submitting', 'unknown'].includes(saved.state)) job.kie.submission = 'unknown';
        } catch { job.kie.submission = 'unknown'; }
      }
      if (!active.includes(job.status)) { store.saveJob(job); continue; }
      if (!job.kie.taskId && job.kie.submission === 'submitting') job.kie.submission = 'unknown';
      job.status = 'interrupted'; job.kie.phase = 'attention'; job.error = job.kie.submission === 'unknown'
        ? 'The app stopped while submitting. Kie.ai may have accepted and charged for this task. Check Kie.ai history and attach its task ID; nothing will be resubmitted automatically.'
        : 'The local app restarted. Check & resume this saved task; its task ID and completed files are kept.';
      store.saveJob(job);
    }
  }
  get busy() { return !!this.activeId || this.store.jobs().some(job => job.kie && active.includes(job.status)); }
  async create(input: unknown, requestId: string) {
    const draft = kieDraftSchema.parse(input);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(requestId)) throw new Error('A generation request ID is required.');
    const key = `kie:${requestId}`, existing = this.store.byKey(key);
    if (existing) { if (!same(existing.kie?.settings, draft)) throw new Error('This request ID belongs to different settings. Start a new request.'); return existing; }
    const pending = this.creating.get(key); if (pending) { const job = await pending; if (!same(job.kie?.settings, draft)) throw new Error('This request ID belongs to different settings.'); return job; }
    const task = this.createChecked(draft, key); this.creating.set(key, task);
    try { return await task; } finally { this.creating.delete(key); }
  }
  private async createChecked(draft: KieDraft, key: string) {
    this.account.key();
    const source = this.store.asset(draft.sourceId || ''), reference = this.store.asset(draft.referenceId || '');
    if (!source || source.kind !== 'video' || !reference || reference.kind !== 'image') throw new Error('Upload a source video and one character image first.');
    const fullPrompt = kiePrompt(draft.prompt); if (fullPrompt.length > 20000) throw new Error('The complete prompt exceeds Kie.ai’s 20,000-character limit. Shorten the additional instructions.');
    const meta = await probe(source.path), image = await probe(reference.path);
    this.dimensions(meta, 'video', 4096); this.dimensions(image, 'image', 8000);
    if (draft.start + draft.seconds > meta.duration + 1e-6) throw new Error('The selection extends beyond the available video. Choose a whole 2–15 second interval inside the source video.');
    if ((await stat(reference.path)).size > 20_000_000) throw new Error('The character image must be at most 20 MB.');
    const [sourceOriginalSHA256, referenceOriginalSHA256] = await Promise.all([kieFileHash(source.path), kieFileHash(reference.path)]);
    const fingerprint = hashText({ draft, fullPrompt, sourceOriginalSHA256, referenceOriginalSHA256 });
    const unresolved = this.store.jobs().find(job => job.kie?.requestFingerprint === fingerprint && (active.includes(job.status) || ['submitting', 'unknown'].includes(job.kie.submission) || job.kie.taskId && !['complete', 'failed'].includes(job.kie.phase)));
    if (unresolved) throw new Error(`This same request already has saved work (${unresolved.id}). Open it in My library and choose Check & resume. No duplicate task was submitted.`);
    const space = await statfs(this.store.root); if (space.bavail * space.bsize < 1024 ** 3) throw new Error('Free at least 1 GB of local storage before generating.');
    const duplicate = this.store.byKey(key); if (duplicate) return duplicate;
    const id = randomUUID(), createdAt = new Date().toISOString(), folder = path.join(this.store.root, 'jobs', id); await mkdir(folder, { recursive: true });
    const frozen: Frozen = { version: 1, draft, fingerprint, sourceOriginalSHA256, referenceOriginalSHA256 }; await json(path.join(folder, 'kie-inputs.json'), frozen);
    const job: Job = { id, title: source.name.replace(/\.[^.]+$/, '').slice(0, 95) + ' / character swap', status: 'queued', sourceId: source.id, referenceId: reference.id, createdAt, favorite: false, deleted: false,
      width: source.width, height: source.height, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'api', workflow: null,
      // Legacy storage container only. It is never compiled or shown as a GPU workflow.
      settings: { ...defaults, engine: 'scail2', prompt: fullPrompt, seconds: draft.seconds, start: draft.start, seed: draft.seed || 0, randomSeed: draft.seed === null, resolution: draft.resolution === '480P' ? '480' : '720', facialConsistency: 'off', facialOcclusionTracking: false, imagenRepaintEnabled: false },
      kie: { aspectRatio: this.aspect(meta.width, meta.height), version: 'kie-wan3-v1', provider: 'kie.ai', model: KIE_MODEL, settings: draft, prompt: fullPrompt, phase: 'preparing', submission: 'not-submitted', requestFingerprint: fingerprint, sourceAudio: meta.hasAudio, warnings: [] },
      progress: { stage: 'Queued for Kie.ai', node: null, value: null, max: null, unit: 'items', segment: 1, segments: 1, completedFrames: 0, targetFrames: 0, updatedAt: Date.now() } };
    const raced = this.store.jobs().find(item => item.kie?.requestFingerprint === fingerprint && (active.includes(item.status) || ['submitting', 'unknown'].includes(item.kie.submission)));
    if (raced) throw new Error(`This same request is already saved (${raced.id}). Open its existing run instead of submitting another task.`);
    this.store.addJob(job, key); return job;
  }
  private aspect(width: number, height: number): NonNullable<Job['kie']>['aspectRatio'] {
    const ratios = { '16:9': 16/9, '9:16': 9/16, '4:3': 4/3, '3:4': 3/4, '1:1': 1 } as const;
    const closest = Object.entries(ratios).sort((a, b) => Math.abs(width / height / a[1] - 1) - Math.abs(width / height / b[1] - 1))[0]!;
    return Math.abs(width / height / closest[1] - 1) <= .02 ? closest[0] as NonNullable<Job['kie']>['aspectRatio'] : 'adaptive';
  }
  private dimensions(meta: { width: number; height: number }, kind: string, maximum: number) {
    if (Math.min(meta.width, meta.height) < 240 || Math.max(meta.width, meta.height) > maximum || Math.max(meta.width / meta.height, meta.height / meta.width) > 8) throw new Error(`The ${kind} must have sides between 240 and ${maximum} pixels and an aspect ratio no wider than 8:1.`);
  }
  private folder(job: Job) { return path.join(this.store.root, 'jobs', job.id); }
  private stage(job: Job, phase: KiePhase, text: string, value: number | null = null, max: number | null = null, unit = 'items') {
    job.kie!.phase = phase; job.progress = { ...job.progress, stage: text, value, max, unit, updatedAt: Date.now() }; this.store.saveJob(job);
  }
  async kick() {
    if (this.task || this.closing) return;
    this.task = (async () => {
      while (!this.closing) {
        const job = this.store.jobs().reverse().find(job => job.kie && job.status === 'queued' && !job.deleted);
        if (!job) break; this.activeId = job.id; this.controller = new AbortController(); this.running = this.run(job, this.controller.signal); await this.running; this.running = null; this.activeId = null; this.controller = null;
      }
    })();
    try { await this.task; } finally { this.task = null; this.activeId = null; this.controller = null; }
  }
  private async prepare(job: Job, signal: AbortSignal): Promise<Prepared> {
    const folder = this.folder(job), frozen = await readJSON<Frozen>(path.join(folder, 'kie-inputs.json'));
    if (!frozen || frozen.fingerprint !== job.kie!.requestFingerprint || !same(frozen.draft, job.kie!.settings)) throw new Error('The frozen Kie input settings changed. No new task was submitted.');
    const source = this.store.asset(job.sourceId), reference = this.store.asset(job.referenceId);
    if (!source || !reference || await kieFileHash(source.path) !== frozen.sourceOriginalSHA256 || await kieFileHash(reference.path) !== frozen.referenceOriginalSHA256) throw new Error('An original input changed or is missing. Restore it before resuming; existing task IDs remain saved.');
    const clip = path.join(folder, 'prepared-source.mp4'), ref = path.join(folder, 'prepared-reference.png'), receipt = path.join(folder, 'kie-prepared.json');
    const saved = await readJSON<Prepared>(receipt);
    if (saved) {
      if (saved.fingerprint !== frozen.fingerprint || !existsSync(clip) || !existsSync(ref) || await kieFileHash(clip) !== saved.sourceSHA256 || await kieFileHash(ref) !== saved.referenceSHA256) throw new Error('A prepared Kie input changed. Keep its receipt and restore the saved media.');
      return saved;
    }
    this.stage(job, 'preparing', 'Preparing the selected source clip'); const draft = frozen.draft;
    const partial = path.join(folder, 'prepared-source.part.mp4'), native = await probe(source.path);
    if (!(native.fps > 0)) throw new Error('The source video frame rate could not be read.');
    await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '2', '-ss', String(draft.start), '-i', source.path, '-t', String(draft.seconds), '-map', '0:v:0', '-map', '0:a?', '-frames:v', String(Math.floor(draft.seconds * native.fps + 1e-6)), '-c:v', 'libx264', '-threads', '2', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', partial], signal, 180000);
    const video = await probe(partial); this.dimensions(video, 'video', 4096);
    if (Math.abs(video.duration - draft.seconds) > Math.max(.075, 1 / video.fps)) throw new Error('The selected video could not be trimmed to the requested duration. Nothing was uploaded.');
    if (video.duration > 15.0001 || video.duration + draft.seconds > 30.0001 || video.duration < 1) throw new Error('The prepared source exceeds Kie.ai’s video-duration limits. Select a shorter interval; nothing was uploaded.');
    if ((await stat(partial)).size > 100_000_000) throw new Error('The prepared source exceeds Kie.ai’s 100 MB video limit. Choose a shorter clip.');
    await rename(partial, clip);
    // API reference images must be opaque. Flatten alpha explicitly onto white,
    // retaining the original image separately and recording this preparation.
    await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '2', '-f', 'lavfi', '-i', `color=c=white:s=${reference.width}x${reference.height}`, '-i', reference.path, '-filter_complex', '[0:v][1:v]overlay=shortest=1,format=rgb24', '-frames:v', '1', '-threads', '2', ref], signal, 45000);
    if ((await stat(ref)).size > 20_000_000) throw new Error('The opaque prepared character image exceeds Kie.ai’s 20 MB limit. Resize the reference image and try a new request.');
    const prepared: Prepared = { fingerprint: frozen.fingerprint, sourceSHA256: await kieFileHash(clip), referenceSHA256: await kieFileHash(ref), duration: video.duration, hasAudio: video.hasAudio };
    await json(receipt, prepared); return prepared;
  }
  private async run(job: Job, signal: AbortSignal) {
    const folder = this.folder(job), run = job.kie!;
    try {
      job.status = 'running'; job.startedAt ||= new Date().toISOString(); this.store.saveJob(job);
      if (await this.canFinishLocally(job)) { await this.finish(job, signal); return; }
      const key = this.account.key(), intentFile = path.join(folder, 'kie-submission.json');
      let intent = await readJSON<Intent>(intentFile);
      if (intent && intent.fingerprint !== run.requestFingerprint) throw new Error('The saved submission belongs to different inputs.');
      if (intent?.taskId && !run.taskId) { run.taskId = intent.taskId; run.submission = 'submitted'; this.store.saveJob(job); }
      if (!run.taskId && (run.submission === 'unknown' || intent && ['submitting', 'unknown'].includes(intent.state))) throw new Error('Submission outcome is unknown. Check your Kie.ai task history and attach the existing task ID. Automatic resubmission is blocked to avoid another charge.');
      if (!run.taskId) {
        const balance = await this.account.refresh(); if (!(balance.credits! > 0)) throw new Error('Your Kie.ai credit balance is empty. Add credits before generating.');
        const prepared = await this.prepare(job, signal); run.sourceSHA256 = prepared.sourceSHA256; run.referenceSHA256 = prepared.referenceSHA256; run.sourceDuration = prepared.duration; run.sourceAudio = prepared.hasAudio; this.store.saveJob(job);
        const uploadsFile = path.join(folder, 'kie-uploads.json'), uploads = await readJSON<Uploads>(uploadsFile) || {};
        const usable = (entry?: Uploads['source']) => entry && (!entry.expiresAt || (typeof entry.expiresAt === 'number' ? entry.expiresAt : Date.parse(entry.expiresAt)) > Date.now() + 60000);
        this.stage(job, 'uploading', 'Uploading selected video to Kie.ai');
        if (!usable(uploads.source)) { uploads.source = await this.client.uploadFile(path.join(folder, 'prepared-source.mp4'), key, 'video', signal, { jobId: job.id }); await json(uploadsFile, uploads); }
        this.stage(job, 'uploading', 'Uploading character reference to Kie.ai');
        if (!usable(uploads.reference)) { uploads.reference = await this.client.uploadFile(path.join(folder, 'prepared-reference.png'), key, 'image', signal, { jobId: job.id }); await json(uploadsFile, uploads); }
        signal.throwIfAborted();
        const input: KieVideoInput = { prompt: run.prompt, reference_video_urls: [uploads.source!.url], reference_image_urls: [uploads.reference!.url], resolution: run.settings.resolution, duration: run.settings.seconds, aspect_ratio: run.aspectRatio || 'adaptive', audio: !run.settings.keepSourceAudio, ...(run.settings.seed === null ? {} : { seed: run.settings.seed }) };
        intent = { fingerprint: run.requestFingerprint, input, attemptedAt: new Date().toISOString(), state: 'submitting' };
        await json(intentFile, intent); run.submission = 'submitting'; run.accountFingerprint = this.account.fingerprint(); job.submitting = true; this.stage(job, 'submitting', 'Submitting one Kie.ai task');
        try {
          const created = await this.client.createTask(key, input, signal);
          // Persist the provider handle before polling, downloads or other work.
          intent = { ...intent, state: 'submitted', taskId: created.taskId }; await json(intentFile, intent);
          run.taskId = created.taskId; run.submission = 'submitted'; run.submittedAt = new Date().toISOString(); job.submitting = false; this.stage(job, 'waiting', 'Kie.ai accepted the task');
        } catch (error) {
          const rejected = error instanceof KieApiError && error.kind === 'rejected' && !error.submissionUnknown;
          const notSent = error instanceof KieApiError && !error.submissionUnknown && ['security', 'transient'].includes(error.kind);
          intent.state = notSent ? 'not-submitted' : rejected ? 'rejected' : 'unknown'; await json(intentFile, intent);
          run.submission = notSent ? 'not-submitted' : rejected ? 'rejected' : 'unknown'; job.submitting = false; this.store.saveJob(job);
          if (!rejected && !notSent) throw new Error('Kie.ai may have accepted this task, but its task ID was not received. Check Kie.ai history before retrying. Nothing will be resubmitted automatically.');
          throw error;
        }
      }
      while (true) {
        signal.throwIfAborted(); const task = await this.client.getTask(key, run.taskId!, signal);
        if (task.model && task.model !== KIE_MODEL) throw new Error('Kie.ai returned a different model for this saved task.');
        if (task.input && intent && !Object.entries(intent.input).every(([name, value]) => same((task.input as unknown as Record<string, unknown>)[name], value))) throw new Error('The provider task inputs differ from the saved submission receipt.');
        if (task.taskId !== run.taskId) throw new Error('Kie.ai returned a different task ID. Saved work was kept.');
        run.providerState = task.providerState;
        if (Number.isFinite(task.creditsConsumed)) run.creditsConsumed = task.creditsConsumed;
        if (Number.isFinite(task.costTime)) run.providerSeconds = task.costTime;
        if (task.state === 'failed') { run.phase = 'failed'; job.status = 'failed'; job.error = task.error || 'Kie.ai could not generate this task.'; job.finishedAt = new Date().toISOString(); this.store.saveJob(job); return; }
        if (task.state === 'succeeded') {
          const url = task.urls?.[0]; if (!url) throw new Error('Kie.ai marked this task complete without a video URL. Recover the same task; no new task was submitted.');
          await json(path.join(folder, 'kie-result.json'), { taskId: run.taskId, url, receivedAt: new Date().toISOString() });
          this.stage(job, 'downloading', 'Saving the completed Kie.ai video');
          const downloaded = await this.client.downloadResult(url, path.join(folder, 'api-output.mp4'), signal, (received, total) => this.stage(job, 'downloading', 'Saving the completed Kie.ai video', received, total || null, 'bytes'));
          await json(path.join(folder, 'kie-download.json'), { taskId: run.taskId, sha256: downloaded.sha256, bytes: downloaded.bytes });
          await this.finish(job, signal); return;
        }
        this.stage(job, task.state === 'waiting' ? 'waiting' : 'rendering', task.state === 'waiting' ? 'Waiting in Kie.ai’s queue' : 'Kie.ai is creating the character video', task.progress ?? null, task.progress === undefined ? null : 100, 'percent');
        await new Promise<void>((resolve, reject) => { if (signal.aborted) { reject(new Error('Stopped following this task locally.')); return; } const abort = () => { clearTimeout(timer); reject(new Error('Stopped following this task locally.')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, this.pollMs); signal.addEventListener('abort', abort, { once: true }); });
      }
    } catch (error) {
      const cancelled = this.store.job(job.id)?.cancelRequested;
      job.status = cancelled ? 'cancelled' : run.submission === 'rejected' ? 'failed' : 'interrupted'; run.phase = cancelled ? 'cancelled' : job.status === 'failed' ? 'failed' : 'attention';
      job.error = cancelled ? null : String((error as Error).message).split(this.store.root).join('[local media]').slice(0, 1800); job.cancellationConfirmed = !!cancelled;
      if (cancelled) run.cancellationNotice = run.taskId || run.submission === 'unknown' ? 'Stopped following locally. Kie.ai may continue processing and charging for the accepted task. Use Check & recover to retrieve it later.' : 'Stopped before a provider task was submitted.';
      const current = this.store.job(job.id); if (current) Object.assign(job, { title: current.title, favorite: current.favorite, deleted: current.deleted, cancelRequested: current.cancelRequested });
      this.store.saveJob(job, false);
    }
  }
  private async canFinishLocally(job: Job) {
    const folder = this.folder(job), journal = path.join(folder, 'kie-download.json'), receipt = await readJSON<{ taskId: string; sha256: string }>(journal), file = path.join(folder, 'api-output.mp4');
    if (receipt) return receipt.taskId === job.kie?.taskId && existsSync(file) && await kieFileHash(file) === receipt.sha256;
    // Recover the crash boundary after the HTTP client committed its verified
    // output but before this manager committed its task-bound journal. This
    // only reads owned local files; no key, DNS lookup or provider call is needed.
    if (!job.kie?.taskId || !existsSync(file)) return false;
    const resultFile = path.join(folder, 'kie-result.json'), clientFile = file + '.download.json';
    if (!existsSync(resultFile) || !existsSync(clientFile)) return false;
    for (const candidate of [file, resultFile, clientFile]) { const info = await lstat(candidate); if (!info.isFile() || info.isSymbolicLink()) return false; }
    const result = await readJSON<{ taskId: string; url: string }>(resultFile), saved = await readJSON<{ sourceHash: string; bytes: number; sha256: string }>(clientFile);
    if (!result || result.taskId !== job.kie.taskId || !saved || typeof result.url !== 'string') return false;
    let url: URL; try { url = new URL(result.url); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') return false;
    if (saved.sourceHash !== createHash('sha256').update(url.href).digest('hex') || !Number.isSafeInteger(saved.bytes) || saved.bytes < 1 || !/^[0-9a-f]{64}$/.test(saved.sha256)) return false;
    const actual = await lstat(file); if (actual.size !== saved.bytes || await kieFileHash(file) !== saved.sha256) return false;
    await json(journal, { taskId: job.kie.taskId, sha256: saved.sha256, bytes: saved.bytes, recoveredFrom: 'verified-client-download' });
    return true;
  }
  private async streamPackets(file: string, stream: 'v' | 'a') {
    const result = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', `${stream}:0`, '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash,pts_time,dts_time,duration_time:packet_side_data=skip_samples,discard_padding', '-of', 'json', file], undefined, 30000));
    return result.packets || [];
  }
  private async finish(job: Job, signal: AbortSignal) {
    const folder = this.folder(job), run = job.kie!, input = path.join(folder, 'api-output.mp4'), output = path.join(folder, 'final.mp4');
    if (!await this.canFinishLocally(job)) throw new Error('The saved provider result is incomplete or changed. Recover its existing task output.');
    this.stage(job, 'saving', 'Finishing the local video');
    const original = await probe(input), clock = await videoFrameInfo(input, signal), warnings: string[] = [];
    if (!(original.duration > 0) || !(original.fps > 0) || !Number.isSafeInteger(clock.frames) || clock.frames < 1 || original.duration > 60) throw new Error('The provider output is not a readable short video. Its downloaded file was preserved.');
    if (Math.abs(original.duration - run.settings.seconds) > Math.max(.05, 1 / original.fps)) warnings.push(`Kie.ai returned ${original.duration.toFixed(3)} seconds for a ${run.settings.seconds}-second request. No video frames were padded, removed or retimed.`);
    const useAudio = run.settings.keepSourceAudio && run.sourceAudio, generatedAudio = !run.settings.keepSourceAudio && original.hasAudio;
    if (useAudio) {
      const source = path.join(folder, 'prepared-source.mp4'); if (!existsSync(source) || await kieFileHash(source) !== run.sourceSHA256) throw new Error('The paid provider video is saved. Restore the exact prepared source audio before finishing locally.');
      await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '2', '-i', input, '-i', source, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', output], signal, 120000);
    } else await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '2', '-i', input, '-map', '0:v:0', ...(generatedAudio ? ['-map', '0:a:0', '-c', 'copy'] : ['-c:v', 'copy', '-an']), '-movflags', '+faststart', output], signal, 120000);
    if (!run.settings.keepSourceAudio && !generatedAudio) warnings.push('Kie.ai returned no generated audio track for this request.');
    const [actual, actualClock] = await Promise.all([probe(output), videoFrameInfo(output, signal)]);
    if (actualClock.frames !== clock.frames || actual.width !== original.width || actual.height !== original.height || Math.abs(actual.fps - original.fps) > 1e-6 || Math.abs(actual.duration - original.duration) > .01 || actual.hasAudio !== !!(useAudio || generatedAudio)) throw new Error('The local output changed provider video timing or audio selection. The paid download is preserved.');
    if (!same(await this.streamPackets(input, 'v'), await this.streamPackets(output, 'v'))) throw new Error('Local finishing changed the provider video packets or timestamps. The original download is preserved.');
    if (useAudio && !same(await this.streamPackets(path.join(folder, 'prepared-source.mp4'), 'a'), await this.streamPackets(output, 'a'))) throw new Error('The copied source audio changed. The provider video and prepared source remain saved.');
    if (generatedAudio && !same(await this.streamPackets(input, 'a'), await this.streamPackets(output, 'a'))) throw new Error('The generated audio changed during local finishing.');
    const thumbnail = path.join(folder, 'poster.jpg'); await poster(output, thumbnail); signal.throwIfAborted();
    run.output = { width: actual.width, height: actual.height, fps: actual.fps, duration: actual.duration, frames: actualClock.frames, sha256: await kieFileHash(output), audio: useAudio ? 'source' : generatedAudio ? 'generated' : 'none', warnings };
    run.warnings = warnings; run.phase = 'complete'; job.output = output; job.poster = thumbnail; job.outputSize = { width: actual.width, height: actual.height }; job.width = actual.width; job.height = actual.height;
    job.progress.targetFrames = actualClock.frames; job.progress.completedFrames = actualClock.frames; job.status = 'completed'; job.error = null; job.finishedAt = new Date().toISOString(); job.elapsedSeconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt || job.createdAt)) / 1000;
    await json(path.join(folder, 'kie-receipt.json'), { version: 'kie-wan3-v1', taskId: run.taskId, provider: run.provider, model: run.model, settings: run.settings, prompt: run.prompt, inputSHA256: { source: run.sourceSHA256, reference: run.referenceSHA256 }, output: run.output, submittedAt: run.submittedAt, completedAt: job.finishedAt, submittedAspectRatio: run.aspectRatio, actualSourceDuration: run.sourceDuration, providerSeconds: run.providerSeconds ?? null, creditsConsumed: run.creditsConsumed ?? null });
    this.stage(job, 'complete', 'Your video is ready', 100, 100, 'percent');
  }
  async cancel(job: Job) {
    if (!job.kie || !['queued', 'running', 'reconnecting', 'interrupted'].includes(job.status)) return job;
    job.cancelRequested = true; this.store.saveJob(job, false);
    if (this.activeId === job.id) { this.controller?.abort(); await this.running; return this.store.job(job.id)!; }
    job.status = 'cancelled'; job.cancellationConfirmed = true; job.kie.phase = 'cancelled'; job.kie.cancellationNotice = job.kie.taskId || job.kie.submission === 'unknown' ? 'Stopped following locally. Accepted Kie.ai work may continue and consume credits. Check & recover the saved task later.' : 'Stopped before submitting a provider task.'; this.store.saveJob(job, false); return job;
  }
  async resume(job: Job, taskId?: string) {
    if (!job.kie || !['interrupted', 'cancelled', 'failed'].includes(job.status)) throw new Error('Choose a saved task that needs attention.');
    if (this.activeId === job.id) throw new Error('This task is already being followed.');
    const intentFile = path.join(this.folder(job), 'kie-submission.json'), intent = await readJSON<Intent>(intentFile);
    if (taskId) {
      if (job.kie.taskId && job.kie.taskId !== taskId) throw new Error('This run already belongs to another Kie.ai task.');
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(taskId) || !intent) throw new Error('Enter the task ID from the matching Kie.ai history entry.');
      const task = await this.client.getTask(this.account.key(), taskId);
      const data = task as typeof task & { model?: string; input?: KieVideoInput };
      if (data.model !== KIE_MODEL || !data.input || !Object.entries(intent.input).every(([key, value]) => same((data.input as unknown as Record<string, unknown>)[key], value))) throw new Error('This Kie.ai task does not match the frozen video, reference and settings. No task was attached or submitted.');
      job.kie.taskId = taskId; job.kie.submission = 'submitted'; await json(intentFile, { ...intent, taskId, state: 'submitted' });
    }
    if (intent?.taskId && !job.kie.taskId) { job.kie.taskId = intent.taskId; job.kie.submission = 'submitted'; }
    if (!job.kie.taskId && (job.kie.submission === 'unknown' || intent && ['submitting', 'unknown'].includes(intent.state))) throw new Error('Submission may already have been charged. Find its task ID in Kie.ai history and attach it; this app will not create another task automatically.');
    if (job.kie.submission === 'rejected' || job.kie.providerState === 'fail') throw new Error('Kie.ai rejected or failed this task. Review the provider error, then start a new generation explicitly.');
    if (!await this.canFinishLocally(job)) this.account.key();
    job.status = 'queued'; job.error = null; job.cancelRequested = false; job.cancellationConfirmed = undefined; job.kie.cancellationNotice = undefined; this.store.saveJob(job, false); return job;
  }
  async shutdown() { this.closing = true; this.controller?.abort(); await this.task; }
}
