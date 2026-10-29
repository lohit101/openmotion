import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './store';
import { command, ingest, prepareVideo, videoFrameInfo } from './media';
import type { Job } from '../shared/types';
import type { AnchorBranch } from '../shared/anchored-video';
import { viggleWindows } from '../shared/viggle-segments';
import { overallProgressEstimate } from '../shared/generation-progress';

export class AnchorWaitError extends Error {}
export async function anchorFileHash(file: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
export async function assertAnchorChild(store: Store, child: Job, signal: AbortSignal): Promise<string> {
  const branch = child.anchorChild!, parent = store.job(branch.parentJobId), source = store.asset(child.sourceId), ref = store.asset(child.referenceId);
  if (!parent?.anchoredVideo || !source || !ref || !parent.anchoredVideo.branches.some(b => b.childJobId === child.id && b.direction === branch.direction && b.frames === branch.frames)) throw new AnchorWaitError('The saved directional source no longer belongs to this parent. Paid frames were preserved.');
  if (await anchorFileHash(source.path) !== branch.inputSHA256 || await anchorFileHash(ref.path) !== branch.referenceSHA256) throw new AnchorWaitError('A saved directional input changed. Restore its original file; nothing was resubmitted.');
  const info = await videoFrameInfo(source.path, signal);
  if (info.frames !== branch.frames || Math.abs(info.start) > .001) throw new AnchorWaitError('Directional source timing changed. No sampling was submitted.');
  return source.path;
}
interface Host {
  store: Store; repo: string; save: (job: Job) => void; stage: (job: Job, text: string) => void;
  runChild: (job: Job, signal: AbortSignal) => Promise<void>;
  resumeChild: (job: Job, retry: boolean) => Promise<void>;
}
export function projectAnchorChild(parent: Job, child: Job) {
  const a = parent.anchoredVideo, binding = child.anchorChild;
  if (!a || !binding || binding.parentJobId !== parent.id) return;
  const branch = a.branches.find(b => b.childJobId === child.id); if (!branch) return;
  branch.completedFrames = child.progress.completedFrames; branch.progress = Math.max(branch.progress, overallProgressEstimate(child));
  branch.state = child.status === 'completed' ? 'completed' : ['interrupted', 'failed', 'cancelled'].includes(child.status) ? 'interrupted' : 'running';
  parent.progress.stage = `${branch.direction === 'backward' ? 'Earlier' : 'Later'} motion · ${child.progress.stage}`;
  parent.progress.node = child.progress.node; parent.progress.value = child.progress.value; parent.progress.max = child.progress.max; parent.progress.unit = child.progress.unit;
  const priorWindows = branch.direction === 'forward' ? viggleWindows(a.branches[0].frames).length : 0;
  parent.progress.segment = priorWindows + child.progress.segment;
  parent.progress.completedFrames = Math.min(a.frames, a.branches.reduce((n, b) => n + b.completedFrames, 0) - (a.branches.every(b => b.completedFrames > 0) ? 1 : 0));
  parent.progress.updatedAt = Date.now();
}
export async function prepareAnchoredSources(host: Host, job: Job, signal: AbortSignal) {
  const a = job.anchoredVideo!, source = host.store.asset(job.sourceId)!, reference = host.store.asset(job.referenceId)!;
  const folder = path.join(host.store.root, 'jobs', job.id); await mkdir(folder, { recursive: true });
  const signature = { sourceSHA256: await anchorFileHash(source.path), referenceSHA256: await anchorFileHash(reference.path) };
  for (const key of ['sourceSHA256', 'referenceSHA256'] as const) {
    if (a[key] && a[key] !== signature[key]) throw new AnchorWaitError('An anchored input changed. Existing paid branches were kept.'); a[key] = signature[key];
  }
  host.save(job);
  const prepared = path.join(folder, 'prepared-source.mp4');
  if (a.preparedSHA256) {
    if (await anchorFileHash(prepared).catch(() => '') !== a.preparedSHA256) throw new AnchorWaitError('The prepared anchored clip changed. Restore its saved file; it will not be recreated over paid work.');
  } else { host.stage(job, 'Preparing the complete selected clip'); await prepareVideo(job, source, folder, signal); a.preparedSHA256 = await anchorFileHash(prepared); host.save(job); }
  const request = { version: a.version, jobId: job.id, anchorFrame: a.anchorFrame, frames: a.frames, width: job.width, height: job.height, fps: job.settings.fps, sourceSHA256: a.preparedSHA256 };
  const file = path.join(folder, 'anchor-media-request.json'); await writeFile(file, JSON.stringify(request));
  host.stage(job, 'Preparing earlier and later source motion');
  await command('python3', [path.join(host.repo, 'scripts/anchored_video.py'), 'prepare', '--folder', folder, '--request', file], signal, 180000);
  if (!job.keyframe) { const keyframe = path.join(folder, 'keyframe.png'); await copyFile(reference.path, keyframe); job.keyframe = keyframe; host.save(job); }
  return folder;
}
async function makeChild(host: Host, parent: Job, branch: AnchorBranch, folder: string) {
  const a = parent.anchoredVideo!, direction = branch.direction;
  const sourceFile = path.join(folder, 'anchor-media', direction + '.mkv');
  const asset = await ingest(host.store, sourceFile, 'video', `${direction} motion.mkv`, true);
  const child: Job = { ...structuredClone(parent), id: randomUUID(), title: `${parent.title.slice(0, 80)} · ${direction} branch`, sourceId: asset.id,
    settings: { ...parent.settings, referenceTime: null, start: 0, seconds: branch.frames / 24, facialConsistency: 'off', imagenRepaintEnabled: !!parent.viggleRepaint },
    anchoredVideo: undefined, anchorChild: { parentJobId: parent.id, direction, frames: branch.frames, inputSHA256: await anchorFileHash(asset.path), referenceSHA256: a.referenceSHA256! },
    facialConsistency: undefined, framingVersion: undefined, referenceFraming: undefined, framingCheck: undefined, continuationSource: undefined, videoRecovery: undefined,
    viggleSegmentation: branch.frames > 124 ? parent.settings.viggleReferenceMode === 'original' ? 'five-frame-v1' : 'last-frame-v2' : undefined,
    viggleRepaint: parent.viggleRepaint ? { ...structuredClone(parent.viggleRepaint), records: [{ segment: 1, frame: 0, status: 'provided' }], activePhotoId: undefined, photoProgress: undefined } : undefined,
    createdAt: new Date().toISOString(), startedAt: undefined, finishedAt: undefined, status: 'queued', favorite: false, deleted: false,
    progress: { stage: 'Queued directional motion', segment: 1, segments: viggleWindows(branch.frames).length, completedFrames: 0, targetFrames: branch.frames, node: null, value: null, max: null, unit: 'steps', updatedAt: Date.now() },
    segments: [], timings: [], uploads: null, context: '', output: null, poster: null, keyframe: undefined, pendingPrompt: null, workflow: null,
    cancelRequested: false, cancellationConfirmed: false, submitting: false, retryRequired: false, error: null, elapsedSeconds: null };
  host.store.addJob(child, `anchor-branch:${parent.id}:${direction}`); branch.childJobId = child.id; host.save(parent); return child;
}
export async function runAnchoredBranches(host: Host, job: Job, signal: AbortSignal) {
  const folder = await prepareAnchoredSources(host, job, signal), a = job.anchoredVideo!;
  for (const branch of a.branches) {
    signal.throwIfAborted();
    let child = branch.childJobId ? host.store.job(branch.childJobId) : host.store.byKey(`anchor-branch:${job.id}:${branch.direction}`);
    if (!child) child = await makeChild(host, job, branch, folder);
    if (child.anchorChild?.parentJobId !== job.id || child.anchorChild.direction !== branch.direction || child.progress.targetFrames !== branch.frames || child.referenceId !== job.referenceId) throw new AnchorWaitError('The saved branch binding changed. Paid output was kept.');
    branch.childJobId = child.id;
    if (child.status !== 'completed') {
      a.state = 'rendering'; a.activeChildId = child.id; host.save(job);
      if (child.status === 'interrupted') {
        await host.resumeChild(child, false); child = host.store.job(child.id)!;
        if (child.status !== 'queued') { job.retryRequired = !!child.retryRequired; throw new AnchorWaitError(`The ${branch.direction} branch needs an explicit check or paid retry: ${child.error || child.status}`); }
      }
      if (['failed', 'cancelled'].includes(child.status)) throw new AnchorWaitError(`The ${branch.direction} branch is ${child.status}. Its accepted frames are kept; start a new run or review its failure.`);
      await host.runChild(child, signal);
      child = host.store.job(child.id)!;
      if (child.status !== 'completed' || !child.output) { job.retryRequired = !!child.retryRequired; throw new AnchorWaitError(`The ${branch.direction} branch needs attention: ${child.error || child.status}. Earlier saved branches will not be sampled again.`); }
    }
    if (!child.output) throw new AnchorWaitError('A completed branch output is unavailable. Restore it before continuing.');
    const hash = await anchorFileHash(child.output);
    if (branch.outputSHA256 && branch.outputSHA256 !== hash) throw new AnchorWaitError('A completed directional video changed. It was not overwritten.');
    const info = await videoFrameInfo(child.output, signal);
    if (info.frames !== branch.frames || Math.abs(info.start) > .001) throw new AnchorWaitError('A directional video has the wrong frame count/timestamps. No frames were padded.');
    branch.outputSHA256 = hash; branch.completedFrames = branch.frames; branch.progress = 100; branch.state = 'completed'; delete a.activeChildId; host.save(job);
  }
  a.state = 'assembling'; job.progress.completedFrames = a.frames; host.stage(job, 'Joining earlier and later motion');
  const outputs = a.branches.map(b => { const child = host.store.job(b.childJobId!)!; return { direction: b.direction, frames: b.frames, file: child.output!, sha256: b.outputSHA256! }; });
  const request = { version: a.version, jobId: job.id, frames: a.frames, anchorFrame: a.anchorFrame, fps: job.settings.fps, sourceSHA256: a.preparedSHA256, branches: outputs,
    ...(job.outputSize ? { width: job.outputSize.width, height: job.outputSize.height } : {}) };
  const file = path.join(folder, 'anchor-assembly-request.json'); await writeFile(file, JSON.stringify(request));
  await command('python3', [path.join(host.repo, 'scripts/anchored_video.py'), 'assemble', '--folder', folder, '--request', file], signal, 180000);
  const receipt = JSON.parse(await readFile(path.join(folder, 'anchor-media/assembly.json'), 'utf8'));
  if (JSON.stringify(receipt.inputs) !== JSON.stringify(request) || receipt.frames !== a.frames || receipt.anchorCopies !== 1 || receipt.decodedFramesExact !== true ||
    await anchorFileHash(path.join(folder, 'final.mp4')) !== receipt.outputSHA256 || await anchorFileHash(path.join(folder, 'anchor-media/master.mkv')) !== receipt.masterSHA256) throw new AnchorWaitError('Directional assembly failed provenance/checksum verification. Both paid branches were preserved.');
  a.outputSHA256 = receipt.outputSHA256; a.masterSHA256 = receipt.masterSHA256; a.state = 'assembled'; host.save(job); return folder;
}
