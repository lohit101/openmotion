import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Runner } from './runner';
import type { Job } from '../shared/types';
import type { Store } from './store';
import { applyProgress, OfflineError } from './comfy';
import { validateGraph } from './workflow';
import { poster, command } from './media';
import { openjutsuGraphHash } from './openjutsu-workflow';
import { automaticSmoothMotion } from './smooth-motion';

const nativeRun = (job: Job) => job.smoothMotion || job.openjutsu;
const receiptName = (job: Job, kind: string) => (job.smoothMotion ? 'smooth-motion-' : 'openjutsu-') + kind + '.json';

export async function fileSHA256(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
class NativeExecutionError extends Error {}
function executionError(history: any) {
  const failure = history.status?.messages?.find((item: any[]) => item[0] === 'execution_error')?.[1];
  const reason = String(failure?.exception_message || history.error || 'The GPU reported a terminal execution error.').trim();
  return new NativeExecutionError(/H3 run_name must be 1-96 characters/.test(reason)
    ? 'The internal run name exceeded OpenJutsu’s limit. This is fixed for new runs. Reuse these settings and generate again.'
    : `OpenJutsu failed${failure?.node_type ? ' at ' + failure.node_type : ''}: ${reason.slice(0, 800)}`);
}
async function failedReceipt(ctx: Pick<Runner, 'store'>, job: Job) {
  try {
    const value = JSON.parse(await readFile(path.join(ctx.store.root, 'jobs', job.id, receiptName(job, 'failure')), 'utf8'));
    return value.jobId === job.id && value.graphSHA256 === nativeRun(job)?.graphSHA256 && (!job.pendingPrompt || value.promptId === job.pendingPrompt) && value.history?.status?.status_str === 'error' ? value.history : null;
  } catch { return null; }
}
export async function canRecoverOpenjutsuLocally(store: Store, job: Job) {
  return !!nativeRun(job) && (!!nativeRun(job)?.nativeFile || !!await failedReceipt({ store }, job));
}
async function retainFailure(ctx: Runner, job: Job, history: any) {
  const folder = path.join(ctx.store.root, 'jobs', job.id); await mkdir(folder, { recursive: true });
  const file = path.join(folder, receiptName(job, 'failure'));
  await writeFile(file + '.part', JSON.stringify({ jobId: job.id, promptId: job.pendingPrompt, graphSHA256: nativeRun(job)?.graphSHA256, history }));
  await rename(file + '.part', file);
}
function markFailed(ctx: Runner, job: Job, error: NativeExecutionError) {
  if (job.smoothMotion) {
    job.status = 'interrupted'; job.error = 'Smooth Motion failed. The original video is saved. Review the error and explicitly retry finishing: ' + error.message;
    job.retryRequired = true; job.submitting = false; ctx.stage(job, 'Finishing needs attention · original saved'); return;
  }
  job.status = 'failed'; job.error = error.message; job.pendingPrompt = null; job.submitting = false; job.retryRequired = false;
  job.finishedAt ||= new Date().toISOString(); ctx.stage(job, 'Generation failed');
}
const owned = (job: Job, entry: any[]) => entry?.[3]?.recast_openjutsu === job.id && entry?.[3]?.graph_sha256 === nativeRun(job)?.graphSHA256;
function assertScope(ctx: Runner, job: Job) {
  if (ctx.connection.status.state !== 'online' || ctx.connection.status.endpoint !== nativeRun(job)?.endpoint || ctx.store.value('cloud-connected-instance', null) !== nativeRun(job)?.instanceId) throw new Error('Reconnect the original GPU for this saved OpenJutsu run. Nothing new was submitted.');
}
export async function recoverOpenjutsuPending(ctx: Runner, job: Job) {
  assertScope(ctx, job);
  const client = ctx.connection.client(), queue = await client.json('/queue'), histories = await client.json('/history?max_items=100');
  const matches = [...queue.queue_running, ...queue.queue_pending, ...Object.values(histories).map((h: any) => h.prompt)].filter(entry => owned(job, entry));
  const unique = [...new Set(matches.map(entry => entry[1]))];
  if (unique.length > 1) throw new Error('More than one matching GPU request exists. Check the GPU queue before continuing.');
  if (unique.length === 1) { job.pendingPrompt = unique[0]; job.submitting = false; ctx.save(job); }
}
async function receipt(ctx: Runner, job: Job) {
  try { const value = JSON.parse(await readFile(path.join(ctx.store.root, 'jobs', job.id, receiptName(job, 'history')), 'utf8'));
    return value.jobId === job.id && value.promptId === job.pendingPrompt && value.graphSHA256 === nativeRun(job)?.graphSHA256 && value.history?.status?.status_str === 'success' ? value.history : null;
  } catch { return null; }
}
export async function resumeOpenjutsu(ctx: Runner, job: Job, retryMissing: boolean) {
  const failed = await failedReceipt(ctx, job);
  if (failed) {
    if (!job.smoothMotion || !retryMissing) { markFailed(ctx, job, executionError(failed)); return; }
    // An explicit finishing retry preserves its failed receipt and never reruns
    // the already-saved H3 generation.
    const file = path.join(ctx.store.root, 'jobs', job.id, receiptName(job, 'failure'));
    await rename(file, file.replace('.json', `-${job.pendingPrompt || Date.now()}.json`));
    job.pendingPrompt = null; job.submitting = false;
  }
  if (nativeRun(job)?.nativeFile) {
    if (!await stat(nativeRun(job)!.nativeFile!).catch(() => null)) throw new Error('The saved video is missing. Reconnect to recover its existing render.');
  } else {
    assertScope(ctx, job);
    if (ctx.connection.status.state !== 'online') throw new Error('Reconnect to check the existing OpenJutsu render.');
    if (job.submitting && !job.pendingPrompt) await recoverOpenjutsuPending(ctx, job);
    const client = ctx.connection.client();
    if (job.pendingPrompt && !await receipt(ctx, job)) {
      const history = await client.json('/history/' + job.pendingPrompt), queue = await client.json('/queue');
      if (history[job.pendingPrompt]?.status?.status_str === 'error') {
        const failed = history[job.pendingPrompt]; await retainFailure(ctx, job, failed); markFailed(ctx, job, executionError(failed)); return;
      }
      if (!history[job.pendingPrompt] && ![...queue.queue_running, ...queue.queue_pending].some((entry: any[]) => entry[1] === job.pendingPrompt)) {
        if (!retryMissing) { job.retryRequired = true; job.status = 'interrupted'; job.error = 'The GPU no longer has this request. Rendering it again uses compute; no new request was submitted.'; ctx.save(job); return; }
        job.pendingPrompt = null; job.submitting = false;
      }
    } else if (job.submitting && !job.pendingPrompt && !retryMissing) { job.retryRequired = true; ctx.save(job); return; }
    else if (retryMissing) job.submitting = false;
  }
  job.status = 'queued'; job.retryRequired = false; job.cancelRequested = false; job.cancellationConfirmed = false; job.error = null; ctx.save(job); void ctx.kick();
}
export async function runOpenjutsu(ctx: Runner, job: Job, signal: AbortSignal) {
  const run = nativeRun(job)!, smooth = job.smoothMotion, graph = smooth ? smooth.graph : job.workflow!, folder = path.join(ctx.store.root, 'jobs', job.id); await mkdir(folder, { recursive: true });
  let socket: { close: () => void } | undefined;
  const save = () => ctx.save(job), stage = (text: string) => ctx.stage(job, text);
  try {
    ctx.checkCancelled(job); job.status = 'running'; job.startedAt ||= new Date().toISOString(); save();
    const failed = await failedReceipt(ctx, job); if (failed) throw executionError(failed);
    if (!run.nativeFile) {
      assertScope(ctx, job);
      const client = ctx.connection.client();
      if (job.submitting && !job.pendingPrompt) { await recoverOpenjutsuPending(ctx, job); if (!job.pendingPrompt) throw new Error('Submission acknowledgement is missing. Check & resume the same request before rendering again.'); }
      if (!job.pendingPrompt) {
        const source = smooth ? { path: smooth.sourceFile } : ctx.store.asset(job.sourceId), reference = ctx.store.asset(job.referenceId);
        if (!source || (!smooth && !reference)) throw new Error('An input is no longer in the library.');
        stage('Preparing your OpenJutsu inputs');
        if (await fileSHA256(source.path) !== run.sourceSHA256 || !smooth && await fileSHA256(reference!.path) !== job.openjutsu!.referenceSHA256) throw new Error('An input changed after this run was saved. Create a new run.');
        if (!job.uploads) {
          const sourceName = await client.upload(source.path, job.id + (smooth ? '-finish' : '-motion'), signal), referenceName = smooth ? '' : await client.upload(reference!.path, job.id + '-character', signal);
          job.uploads = { source: sourceName, reference: referenceName };
          graph[smooth || run.face ? '1' : '5'].inputs.video = sourceName; if (!smooth) graph['2'].inputs.image = referenceName;
          run.graphSHA256 = openjutsuGraphHash(graph); save();
        }
        assertScope(ctx, job);
        const issues = validateGraph(graph, await client.json('/object_info', undefined, signal));
        if (issues.length) throw new Error('OpenJutsu tools or models need attention: ' + issues.slice(0, 4).join(' '));
        await writeFile(path.join(folder, smooth ? 'workflow_smooth.json' : 'workflow_0.json'), JSON.stringify(graph, null, 2));
        ctx.checkCancelled(job); assertScope(ctx, job); job.submitting = true; save(); stage('Queued on GPU');
        const response = await client.json('/prompt', { prompt: graph, client_id: 'recast-' + job.id, extra_data: { recast_openjutsu: job.id, graph_sha256: run.graphSHA256 } });
        if (response.node_errors && Object.keys(response.node_errors).length) { job.submitting = false; throw new Error(JSON.stringify(response.node_errors).slice(0, 1200)); }
        if (!response.prompt_id) throw new Error('The GPU did not acknowledge submission. Check & resume before retrying.');
        job.pendingPrompt = response.prompt_id; job.submitting = false; save();
        if (ctx.store.job(job.id)?.cancelRequested) { await client.cancel(job.pendingPrompt!); job.cancellationConfirmed = true; throw new Error('Cancelled.'); }
      }
      let history = await receipt(ctx, job), missing = 0;
      socket = await client.watch('recast-' + job.id, event => { if (!signal.aborted && applyProgress(job, event)) save(); }).catch(() => undefined);
      while (!history) {
        ctx.checkCancelled(job); signal.throwIfAborted();
        const result = await client.json('/history/' + job.pendingPrompt, undefined, signal); history = result[job.pendingPrompt!];
        if (history) break;
        const queue = await client.json('/queue', undefined, signal);
        missing = [...queue.queue_running, ...queue.queue_pending].some((entry: any[]) => entry[1] === job.pendingPrompt) ? 0 : missing + 1;
        if (missing >= 5) { job.retryRequired = true; throw new OfflineError('The GPU no longer reports this request. Check & resume; nothing new was queued.'); }
        await new Promise<void>((resolve, reject) => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); }; const abort = () => { done(); reject(signal.reason || new Error('Cancelled.')); }; const timer = setTimeout(() => { done(); resolve(); }, 1500); signal.addEventListener('abort', abort, { once: true }); });
      }
      socket?.close(); socket = undefined;
      if (history.status?.status_str === 'error') { await retainFailure(ctx, job, history); throw executionError(history); }
      if (history.status?.status_str !== 'success') throw new Error('OpenJutsu did not return a completed execution status. Check & resume the existing request.');
      const saved = { jobId: job.id, promptId: job.pendingPrompt, graphSHA256: run.graphSHA256, history };
      await writeFile(path.join(folder, receiptName(job, 'history') + '.part'), JSON.stringify(saved)); await rename(path.join(folder, receiptName(job, 'history') + '.part'), path.join(folder, receiptName(job, 'history')));
      // Only the assembled final output, never a segment preview.
      const result = history.outputs?.[smooth ? '1' : run.face ? '30' : '67'];
      const output = [...(result?.videos || []), ...(result?.gifs || []), ...(result?.images || [])].find(item => /\.(mp4|mov|webm|mkv)$/i.test(item.filename || ''));
      if (!output) throw new Error('The paid render is saved but its final assembled video was not listed. Check & resume to recover it.');
      stage('Saving your completed video'); const native = path.join(folder, smooth ? 'smoothed.mp4' : 'native.mp4');
      await client.download(output, native, signal, ctx.transferProgress(job, 'Saving your completed video'));
      run.nativeFile = native; run.nativeSHA256 = await fileSHA256(native); save();
    }
    if (await fileSHA256(run.nativeFile!) !== run.nativeSHA256) throw new Error('The saved native video changed. Restore it before finishing; no new video was rendered.');
    stage('Preparing playback');
    // Our finishing encoder always writes MP4 frame-count tables. Read those
    // directly instead of decoding a five-minute 1080p/60 export on the laptop.
    const info = JSON.parse(await command('ffprobe', ['-v', 'error', ...(!smooth ? ['-count_frames'] : []), '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,nb_read_frames,duration,avg_frame_rate:format=duration', '-of', 'json', run.nativeFile!], signal, 30000));
    const video = info.streams[0]; run.actualFrames = Number(video.nb_read_frames || video.nb_frames); run.actualSeconds = Number(video.duration || info.format?.duration);
    if (!Number.isFinite(run.actualFrames) || run.actualFrames! < 1 || !Number.isFinite(run.actualSeconds)) throw new Error('The saved output needs a playback check. No new render was queued.');
    if (smooth && (video.avg_frame_rate !== `${smooth.targetFPS}/1` || run.actualFrames !== Math.ceil(smooth.sourceSeconds * smooth.targetFPS - .000001) || Math.abs(run.actualSeconds! - smooth.sourceSeconds) > 1 / smooth.targetFPS + .01)) throw new Error('The finished frame rate or duration differs from the saved request.');
    job.width = video.width; job.height = video.height; job.output = run.nativeFile!; job.poster = path.join(folder, 'poster.jpg'); await poster(job.output, job.poster);
    ctx.checkCancelled(job); job.segments = [{ promptId: job.pendingPrompt!, frames: run.actualFrames!, seconds: run.actualSeconds!, file: run.nativeFile! }];
    job.progress.completedFrames = run.actualFrames!; job.progress.targetFrames = run.actualFrames!; job.progress.segment = 1; job.progress.segments = 1;
    if (!smooth && job.openjutsu?.outputFPS && job.openjutsu.outputFPS !== 24) {
      job.pendingPrompt = null; job.submitting = false; job.uploads = null; job.smoothMotion = automaticSmoothMotion(job);
      Object.assign(job.progress, { stage: 'Smoothing motion', node: null, value: 0, max: Math.ceil(run.actualSeconds! * job.smoothMotion.targetFPS), completedFrames: 0, targetFrames: Math.ceil(run.actualSeconds! * job.smoothMotion.targetFPS), unit: 'frames' }); save();
      await runOpenjutsu(ctx, job, signal); return;
    }
    job.pendingPrompt = null; job.status = 'completed'; job.finishedAt = new Date().toISOString(); job.elapsedSeconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt!)) / 1000; stage('Video ready');
  } catch (error) {
    const cancelled = !!ctx.store.job(job.id)?.cancelRequested;
    if (!cancelled && error instanceof NativeExecutionError) { markFailed(ctx, job, error); return; }
    job.status = cancelled && job.cancellationConfirmed ? 'cancelled' : job.pendingPrompt || job.submitting || run.nativeFile ? 'interrupted' : 'failed';
    job.error = (error as Error).message; stage(job.status === 'cancelled' ? 'Cancelled' : job.status === 'interrupted' ? 'Generation needs attention · saved work kept' : 'Generation failed');
  } finally { socket?.close(); }
}
