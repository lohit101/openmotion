import type { Express, Response } from 'express';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { canFinishRepairLocally, faceRepairEligibilityReason, faceRepairRequestSchema, normalizeRepairRanges, repairFrameWeight, type FaceRepairBinding, type FaceRepairEligibility, type FaceRepairGoal } from '../shared/face-repair';
import { isEyeFinishedFacialVersion } from '../shared/facial-consistency';
import { command, poster, probe, videoFrameInfo } from './media';
import { faceHash, facialFingerprint } from './facial-consistency';
import type { ConnectionManager } from './comfy';
import { publicJob, type Store } from './store';

const hash = faceHash;
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>; return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(key => Object.hasOwn(bb, key) && same(aa[key], bb[key])); }
  return false;
};
// Match the Python transport's canonical JSON numbers exactly (including tiny strengths).
// This bounded, local stdlib-only check runs only on explicit recovery, never bootstrap.
const canonicalHash = (value: unknown): string => execFileSync('python3', ['-c', 'import sys,json,hashlib;v=json.load(sys.stdin);print(hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest())'], { input: JSON.stringify(value), encoding: 'utf8', timeout: 2000, maxBuffer: 4096 }).trim();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema = z.object({
  id: z.enum(['boundary', 'identity80']), recipe: z.string().min(1).max(120), qualified: z.boolean(),
  preview: z.string(), master: z.string(), previewSHA256: sha, masterSHA256: sha,
  changedFrames: z.number().int().nonnegative(), protectedFramesExact: z.literal(true), protectedPixelsExact: z.literal(true),
  warnings: z.array(z.string().max(1000)).max(100),
  losslessDecodedPixelsVerified: z.literal(true), audioPacketsExact: z.literal(true), masterAudioPCMExact: z.literal(true), mp4Recompressed: z.literal(true),
});
const receiptSchema = z.object({
  version: z.literal('face-repair-v1'), complete: z.literal(true), profileSHA256: sha, request: z.unknown(),
  frames: z.number().int().positive(), fps: z.number().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
  candidates: z.array(candidateSchema).min(1).max(2),
  parent: z.unknown(), inheritance: z.unknown(),
  providers: z.record(z.string(), z.array(z.string())),
  tracking: z.object({ receiptSHA256: sha, target: z.literal('finished-parent'), recomputedForRepair: z.literal(true) }),
  optionalEyeFinish: z.object({ inherited: z.boolean(), recomputed: z.literal(false), eyeInteriorsProtected: z.boolean() }),
  records: z.array(z.object({ frame: z.number().int().nonnegative(), parentDecodedSHA256: sha, weight: z.number().min(0).max(1), outputs: z.record(z.string(), z.object({ sha256: sha, decodedSHA256: sha, changedPixels: z.number().int().nonnegative(), editablePixels: z.number().int().nonnegative(), protectedPixelsExact: z.literal(true) })) })),
}).passthrough();
export interface FaceRepairRequest {
  version: 'face-repair-v1'; jobId: string; parentJobId: string; rootJobId: string; instanceId: number;
  goal: FaceRepairGoal; frames: number; fps: number; width: number; height: number;
  ranges: ReturnType<typeof normalizeRepairRanges>; inputs: { finished: string; raw: string; source: string; reference: string; receipt: string; calibration: string };
  binding: FaceRepairBinding;
  inheritance: { parentJobId: string; parentReceiptSHA256: string; parentCalibrationSHA256: string };
  parent: { version: NonNullable<Job['facialConsistency']>['version']; profile: 'perform-onnx60'; anchorFrame: number; settings: Job['settings']; eyeFinishRetained: boolean };
}
export class FaceRepairError extends Error { remoteStopped = false; cancellationConfirmed = false; notStarted = false; localFramesReady = false; }
type RepairProgress = (frame: number, frames: number, stage: string) => void;
export interface FaceRepairExecutor {
  run(request: FaceRepairRequest, requestFile: string, output: string, signal: AbortSignal, progress: RepairProgress): Promise<void>;
  cancel(job: Job, requestFile: string, output: string): Promise<void>;
}
async function managedCommand(repo: string, args: string[], signal?: AbortSignal, progress?: RepairProgress) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-u', path.join(repo, 'scripts/managed_face_repair.py'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', errorText = '', buffer = '';
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      out = (out + chunk).slice(-64000); buffer = (buffer + chunk).slice(-64000);
      const rows = buffer.split('\n'); buffer = rows.pop() || '';
      for (const line of rows) try {
        const row = JSON.parse(line.replace(/^RECAST_FACE_REPAIR_PROGRESS\s+/, ''));
        if (Number.isInteger(row.frame) && Number.isInteger(row.frames)) progress?.(row.frame, row.frames, String(row.stage || 'Repairing selected facial frames'));
      } catch { /* Setup and transport logs are not progress. */ }
    });
    child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-12000); });
    const cleanup = () => signal?.removeEventListener('abort', abort);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup(); if (code === 0 && !signal?.aborted) return resolve();
      const error = new FaceRepairError(errorText.trim() || 'Face repair was interrupted. Its saved frames and the original video are preserved.');
      error.remoteStopped = out.includes('RECAST_FACE_REPAIR_STOPPED'); error.cancellationConfirmed = out.includes('RECAST_FACE_REPAIR_CANCELLED'); error.notStarted = out.includes('RECAST_FACE_REPAIR_NOT_STARTED'); error.localFramesReady = out.includes('RECAST_FACE_REPAIR_LOCAL_READY'); reject(error);
    });
    if (signal?.aborted) abort();
  });
}
export class FaceRepairManager {
  private creating = new Map<string, Promise<Job>>();
  private accepting = new Map<string, Promise<Job>>();
  public availableGoals: FaceRepairGoal[] = ['auto', 'identity', 'boundary'];
  constructor(public store: Store, public repo: string, private connection: ConnectionManager,
    private ready: (root: Job) => void, private execute: FaceRepairExecutor = {
      run: (request, requestFile, output, signal, progress) => managedCommand(repo, ['--action', 'run', '--instance-id', String(request.instanceId), '--job', request.jobId, '--request', requestFile, '--output', output], signal, progress),
      cancel: (job, requestFile, output) => managedCommand(repo, ['--action', 'cancel', '--instance-id', String(job.faceRepair!.instanceId), '--job', job.id, '--request', requestFile, '--output', output]),
    }, private fingerprint = async (version: string) => (await command('python3', [path.join(repo, 'scripts/face_repair.py'), 'fingerprint', '--parent-version', version], undefined, 20000)).trim()) {}
  private folder(job: Job) { return path.join(this.store.root, 'jobs', job.id, 'face-repair'); }
  private original(parent: Job): Job {
    if (!parent.faceRepair) return parent;
    const root = this.store.job(parent.faceRepair.rootJobId);
    if (!root || faceRepairEligibilityReason(root)) throw new Error('The original Remotion inputs for this repaired revision are unavailable.');
    return root;
  }
  async eligibility(parentId: string): Promise<FaceRepairEligibility> {
    const parent = this.store.job(parentId);
    if (!parent) throw new Error('This saved video is unavailable.');
    // An unaccepted attempt reopens its original video and previous comparisons.
    if (parent.faceRepair && parent.faceRepair.state !== 'accepted') return this.eligibility(parent.faceRepair.parentJobId);
    let reason = faceRepairEligibilityReason(parent);
    const root = !reason ? this.original(parent) : parent;
    if (!reason) for (const file of [parent.output!, path.join(this.store.root, 'jobs', root.id, 'final.mp4'), path.join(this.store.root, 'jobs', root.id, 'prepared-source.mp4'), path.join(this.store.root, 'jobs', root.id, 'facial-consistency/receipt.json'), path.join(this.store.root, 'jobs', root.id, 'facial-consistency/calibration.json'), this.store.asset(root.referenceId)?.path || ''])
      if (!file || !existsSync(file)) { reason = 'A saved source, raw animation, calibration or character reference is missing. Restore the original files before repair.'; break; }
    return { eligible: !reason, reason, parentJobId: parent.id, frames: parent.faceRepair?.frames || parent.progress.targetFrames, fps: parent.settings.fps, maxHandleSeconds: .25, availableGoals: [...this.availableGoals], attempts: this.store.jobs().filter(j => j.faceRepair?.parentJobId === parent.id && !j.deleted).map(publicJob) };
  }
  async create(parentId: string, input: unknown): Promise<Job> {
    const value = faceRepairRequestSchema.parse(input), key = `face-repair-v1:${parentId}:${value.requestId}`;
    const existing = this.store.byKey(key);
    if (existing) { this.assertSameRequest(existing, value); return existing; }
    const pending = this.creating.get(key); if (pending) { const job = await pending; this.assertSameRequest(job, value); return job; }
    const task = this.createChecked(parentId, value, key); this.creating.set(key, task);
    try { return await task; } finally { this.creating.delete(key); }
  }
  private assertSameRequest(job: Job, value: z.infer<typeof faceRepairRequestSchema>) {
    const run = job.faceRepair!;
    if (run.goal !== value.goal || !same(run.ranges, normalizeRepairRanges(value.ranges, run.frames, run.fps))) throw new Error('This repair request ID already belongs to different selections. Start a new attempt.');
  }
  private async createChecked(parentId: string, value: z.infer<typeof faceRepairRequestSchema>, key: string) {
    const eligibility = await this.eligibility(parentId);
    if (!eligibility.eligible) throw new Error(eligibility.reason!);
    if (eligibility.parentJobId !== parentId) throw new Error('Open the original video or accept this repair revision before creating another repair.');
    if (!this.availableGoals.includes(value.goal)) throw new Error('This repair goal has not passed validation yet. Choose one of the available face repairs.');
    const parent = this.store.job(parentId)!, root = this.original(parent), run = root.facialConsistency!;
    this.ready(root); const instanceId = this.store.value<number | null>('cloud-connected-instance', null);
    if (!instanceId || this.connection.status.state !== 'online') throw new Error('Reconnect your GPU to prepare a face repair. Nothing was queued or downloaded.');
    if (run.profileSHA256 !== facialFingerprint(this.repo, run.version)) throw new Error('The original facial recipe cannot be reproduced by these installed tools. Existing footage is kept.');
    const folder = path.join(this.store.root, 'jobs', root.id), reference = this.store.asset(root.referenceId)!;
    const inputs = { finished: parent.output!, raw: path.join(folder, 'final.mp4'), source: path.join(folder, 'prepared-source.mp4'), reference: reference.path, receipt: path.join(folder, 'facial-consistency/receipt.json'), calibration: path.join(folder, 'facial-consistency/calibration.json') };
    const binding: FaceRepairBinding = { finishedSHA256: hash(inputs.finished), rawSHA256: hash(inputs.raw), sourceSHA256: hash(inputs.source), referenceSHA256: hash(inputs.reference), parentProfileSHA256: run.profileSHA256, profileSHA256: await this.fingerprint(run.version), parentReceiptSHA256: hash(inputs.receipt), parentCalibrationSHA256: hash(inputs.calibration) };
    if (!/^[a-f0-9]{64}$/.test(binding.profileSHA256)) throw new Error('The selected face repair tools could not be fingerprinted.');
    if (run.baseSHA256 !== binding.rawSHA256 || run.sourceSHA256 !== binding.sourceSHA256 || run.referenceSHA256 !== binding.referenceSHA256 || !parent.faceRepair && run.outputSHA256 !== binding.finishedSHA256) throw new Error('The saved Remotion inputs changed since generation. The original video remains untouched.');
    if (parent.faceRepair && parent.faceRepair.candidates.find(candidate => candidate.id === parent.faceRepair!.acceptedCandidateId)?.previewSHA256 !== binding.finishedSHA256) throw new Error('The accepted parent revision changed after review. Restore its verified video before repairing again.');
    const originalReceipt = JSON.parse(await readFile(inputs.receipt, 'utf8')), calibration = JSON.parse(await readFile(inputs.calibration, 'utf8'));
    if (!originalReceipt.complete || originalReceipt.inputs?.request?.jobId !== root.id || originalReceipt.inputs?.request?.profileSHA256 !== run.profileSHA256 || originalReceipt.outputSHA256 !== run.outputSHA256 || originalReceipt.calibration?.fileSHA256 !== binding.parentCalibrationSHA256 || calibration.binding?.jobId !== root.id || calibration.binding?.profileSHA256 !== run.profileSHA256) throw new Error('The original facial receipt or calibration no longer matches this video.');
    const [width, height] = outputDimensions(parent), frames = parent.faceRepair?.frames || parent.progress.targetFrames;
    const sourceWidth = originalReceipt.inputs?.source?.width, sourceHeight = originalReceipt.inputs?.source?.height;
    if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 64 || sourceHeight < 64) throw new Error('The original source-size receipt is unavailable. Keep this saved video unchanged.');
    await this.checkMedia([inputs.finished, inputs.raw], frames, parent.settings.fps, width, height);
    // Native 720 exports may have a 736px prepared driving stream. Keep its
    // exact original size/clock; the frozen face route resizes only its crop input.
    await this.checkMedia([inputs.source], frames, parent.settings.fps, sourceWidth, sourceHeight);
    const ranges = normalizeRepairRanges(value.ranges, frames, parent.settings.fps), space = await statfs(this.store.root);
    const needed = frames * width * height * 3 * 2 + 1024 ** 3;
    if (space.bavail * space.bsize < needed) throw new Error('Free local storage for two lossless repair masters and review previews before starting. Nothing was queued.');
    const duplicate = this.store.byKey(key); if (duplicate) return duplicate;
    this.ready(root);
    if (instanceId !== this.store.value('cloud-connected-instance', null) || this.connection.status.state !== 'online') throw new Error('The GPU changed during repair checks. Reconnect before starting.');
    const id = randomUUID(), now = new Date().toISOString();
    const request: FaceRepairRequest = { version: 'face-repair-v1', jobId: id, parentJobId: parent.id, rootJobId: root.id, instanceId, goal: value.goal, frames, fps: parent.settings.fps, width, height, ranges, inputs, binding,
      inheritance: { parentJobId: root.id, parentReceiptSHA256: binding.parentReceiptSHA256, parentCalibrationSHA256: binding.parentCalibrationSHA256 },
      parent: { version: run.version, profile: 'perform-onnx60', anchorFrame: run.anchorFrame!, settings: structuredClone(root.settings), eyeFinishRetained: isEyeFinishedFacialVersion(run.version) } };
    const job: Job = { ...structuredClone(parent), id, title: `${parent.title.slice(0, 85)} / face repair`, status: 'queued', createdAt: now, startedAt: undefined, finishedAt: undefined,
      origin: 'repair', favorite: false, deleted: false, output: null, poster: parent.poster, elapsedSeconds: null, workflow: null, hasWorkflow: false, segments: [], timings: [], context: '', uploads: null,
      pendingPrompt: null, keyframe: undefined, error: null, cancelRequested: false, cancellationConfirmed: undefined, submitting: false, retryRequired: false,
      facialConsistency: undefined, anchoredVideo: undefined, anchorChild: undefined, faceRefinement: undefined, continuationSource: undefined, viggleRepaint: undefined, referenceFraming: undefined, framingCheck: undefined,
      faceRepair: { version: 'face-repair-v1', parentJobId: parent.id, rootJobId: root.id, requestId: value.requestId, instanceId, goal: value.goal, ranges, frames, fps: request.fps, width, height, binding, state: 'queued', processedFrames: 0, remoteActive: false, candidates: [] },
      progress: { stage: 'Queued for face repair', node: null, value: 0, max: frames, unit: 'frames', segment: 1, segments: 1, completedFrames: 0, targetFrames: frames, updatedAt: Date.now() } };
    const work = this.folder(job); await mkdir(work, { recursive: true }); await this.writeJSON(path.join(work, 'request.json'), request);
    this.store.addJob(job, key); return this.store.job(id)!;
  }
  private async writeJSON(file: string, value: unknown) { const temporary = file + '.tmp'; await writeFile(temporary, JSON.stringify(value)); await rename(temporary, file); }
  private async checkMedia(files: string[], frames: number, fps: number, width: number, height: number, signal?: AbortSignal) {
    for (const file of files) {
      const [timing, meta] = await Promise.all([videoFrameInfo(file, signal), probe(file)]);
      if (timing.frames !== frames || Math.abs(timing.start) > .001 || meta.width !== width || meta.height !== height || Math.abs(meta.fps - fps) > 1e-6 || Math.abs(meta.duration - frames / fps) > .01)
        throw new Error('A face repair input has different frame count, size or timing. No padding, resampling or offset was introduced.');
    }
  }
  private async request(job: Job) {
    const request: FaceRepairRequest = JSON.parse(await readFile(path.join(this.folder(job), 'request.json'), 'utf8')), run = job.faceRepair!;
    if (request.version !== run.version || request.jobId !== job.id || request.parentJobId !== run.parentJobId || request.rootJobId !== run.rootJobId || request.instanceId !== run.instanceId || request.goal !== run.goal || !same(request.binding, run.binding) || !same(request.ranges, run.ranges) || request.frames !== run.frames || request.fps !== run.fps || request.width !== run.width || request.height !== run.height) throw new Error('The saved face repair request changed. Existing frames are preserved.');
    for (const [name, file] of Object.entries(request.inputs)) {
      const key = name === 'receipt' ? 'parentReceiptSHA256' : name === 'calibration' ? 'parentCalibrationSHA256' : `${name}SHA256`;
      if (!existsSync(file) || hash(file) !== (run.binding as unknown as Record<string, string>)[key]) throw new Error('A saved repair input changed or is missing. Existing footage is preserved.');
    }
    return request;
  }
  async run(job: Job, signal: AbortSignal, progress: RepairProgress) {
    const run = job.faceRepair!, work = this.folder(job), wasRemoteActive = run.remoteActive;
    try {
      const request = await this.request(job);
      job.startedAt ||= new Date().toISOString(); job.status = 'running'; this.store.saveJob(job);
      if (!this.downloaded(job)) {
        const local = this.localRecoveryReady(job, request);
        if (!local) {
          if (run.binding.profileSHA256 !== await this.fingerprint(request.parent.version)) throw new Error('The saved repair recipe differs from these tools. Keep the current attempt and its saved frames.');
          if (this.connection.status.state !== 'online' || run.instanceId !== this.store.value('cloud-connected-instance', null)) throw new Error('Reconnect the same GPU instance to recover this saved repair.');
        }
        run.state = 'processing'; run.remoteActive = !local; this.store.saveJob(job);
        await this.execute.run(request, path.join(work, 'request.json'), work, signal, (frame, frames, stage) => {
          if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(frames) || frames < 1 || frame < 0 || frame > frames) return;
          // Tracking has several independent N-frame scans. Only the actual
          // chronological composition prefix counts as processed face frames.
          if (frames === run.frames && /^(Repairing selected facial frames|Preserving accepted frames)$/.test(stage)) run.processedFrames = Math.max(run.processedFrames, frame);
          progress(frame, frames, stage);
        });
        run.remoteActive = false; run.state = 'downloaded'; this.store.saveJob(job);
      }
      signal.throwIfAborted(); await this.finish(job, request, signal);
    } catch (error) {
      if (error instanceof FaceRepairError) { if (error.remoteStopped || error.notStarted && !wasRemoteActive) run.remoteActive = false; if (error.cancellationConfirmed) { run.remoteActive = false; run.cancellationConfirmed = true; job.cancellationConfirmed = true; } }
      const local = this.localRecoveryReady(job); if (local) run.remoteActive = false;
      const cancelled = this.store.job(job.id)?.cancelRequested && !run.remoteActive;
      job.status = cancelled ? 'cancelled' : 'interrupted'; run.state = run.state === 'downloaded' || local ? 'downloaded' : 'interrupted';
      job.cancellationConfirmed = !!cancelled; run.cancellationConfirmed = !!cancelled;
      job.error = cancelled ? null : String((error as Error).message).slice(0, 1800); job.progress.stage = cancelled ? 'Face repair cancelled' : 'Face repair needs attention';
      const latest = this.store.job(job.id); if (latest) Object.assign(job, { title: latest.title, favorite: latest.favorite, deleted: latest.deleted, cancelRequested: latest.cancelRequested });
      this.store.saveJob(job, false);
    }
  }
  downloaded(job: Job) {
    const folder = this.folder(job);
    try {
      const file = path.join(folder, 'receipt.json'), receipt = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8'))), transport = JSON.parse(readFileSync(path.join(folder, 'transport.json'), 'utf8'));
      return transport.jobId === job.id && transport.instanceId === job.faceRepair!.instanceId && transport.receiptSHA256 === hash(file) && receipt.candidates.every(c => c.preview === `candidate-${c.id}.mp4` && c.master === `candidate-${c.id}.mkv` && existsSync(path.join(folder, c.preview)) && existsSync(path.join(folder, c.master)));
    } catch { return false; }
  }
  localRecoveryReady(job: Job, request?: FaceRepairRequest): boolean {
    try {
      const folder = this.folder(job), run = job.faceRepair!;
      request ||= JSON.parse(readFileSync(path.join(folder, 'request.json'), 'utf8')) as FaceRepairRequest;
      if (!same(request.binding, run.binding) || request.jobId !== job.id) return false;
      const requestHash = canonicalHash(request);
      const marker = JSON.parse(readFileSync(path.join(folder, 'remote-stopped.json'), 'utf8'));
      if (!same(marker, { jobId: job.id, instanceId: run.instanceId, requestSHA256: requestHash, stopped: true })) return false;
      const ready = JSON.parse(readFileSync(path.join(folder, 'checkpoint-ready.json'), 'utf8')), receiptFile = path.join(folder, 'receipt.json'), receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
      if (ready.version !== 'face-repair-checkpoints-v1' || ready.jobId !== job.id || ready.instanceId !== run.instanceId || ready.requestSHA256 !== requestHash || ready.receiptSHA256 !== hash(receiptFile) || ready.frames !== run.frames || ready.complete !== true || !same(receipt.request, request) || !Array.isArray(receipt.records) || receipt.records.length !== run.frames || !Array.isArray(ready.files)) return false;
      const expected = new Map<string, { sha256: string; decodedSHA256: string }>();
      for (const [index, row] of receipt.records.entries()) {
        if (row.frame !== index || !row.outputs) return false;
        for (const [candidate, output] of Object.entries(row.outputs) as [string, { changedPixels: number; sha256: string; decodedSHA256: string }][]) {
          if (!['boundary', 'identity80'].includes(candidate)) return false;
          if (output.changedPixels > 0) expected.set(`${candidate}:${index}`, output);
        }
      }
      if (ready.files.length !== expected.size) return false;
      for (const file of ready.files) {
        if (!Number.isSafeInteger(file.frame) || !['boundary', 'identity80'].includes(file.candidate)) return false;
        const key = `${file.candidate}:${file.frame}`, output = expected.get(key);
        if (!output || output.sha256 !== file.sha256 || output.decodedSHA256 !== file.decodedSHA256 || hash(path.join(folder, 'frames', file.candidate, `frame-${String(file.frame).padStart(6, '0')}.png`)) !== file.sha256) return false;
        expected.delete(key);
      }
      return !expected.size;
    } catch { return false; }
  }
  async finish(job: Job, request?: FaceRepairRequest, signal?: AbortSignal) {
    request ||= await this.request(job);
    const run = job.faceRepair!, folder = this.folder(job), receiptFile = path.join(folder, 'receipt.json');
    const receipt = receiptSchema.parse(JSON.parse(await readFile(receiptFile, 'utf8'))), transport = JSON.parse(await readFile(path.join(folder, 'transport.json'), 'utf8'));
    if (!same(receipt.request, request) || receipt.profileSHA256 !== run.binding.profileSHA256 || receipt.frames !== run.frames || receipt.fps !== run.fps || receipt.width !== run.width || receipt.height !== run.height || transport.jobId !== job.id || transport.instanceId !== run.instanceId || transport.receiptSHA256 !== hash(receiptFile)) throw new Error('The saved face repair result failed request, timing or transport verification. Original footage remains intact.');
    if (new Set(receipt.candidates.map(c => c.id)).size !== receipt.candidates.length) throw new Error('Duplicate repair candidates were rejected.');
    if (!same(receipt.parent, run.binding) || !same(receipt.inheritance, request.inheritance) || receipt.records.length !== run.frames ||
      ['appearance', 'motion', 'warp', 'decode', 'identity', 'parser'].some(key => receipt.providers[key]?.[0] !== 'CUDAExecutionProvider') ||
      receipt.optionalEyeFinish.inherited !== request.parent.eyeFinishRetained || receipt.optionalEyeFinish.eyeInteriorsProtected !== request.parent.eyeFinishRetained)
      throw new Error('Repair device, frame coverage or inherited facial-stage verification failed.');
    for (const [index, record] of receipt.records.entries()) {
      const expectedWeight = repairFrameWeight(index, run.ranges);
      if (record.frame !== index || Math.abs(record.weight - expectedWeight) > 1e-8 || Object.keys(record.outputs).length !== receipt.candidates.length) throw new Error('Repair frame ranges or checkpoint coverage changed.');
      for (const candidate of receipt.candidates) {
        const output = record.outputs[candidate.id];
        if (!output || output.changedPixels > run.width * run.height || output.editablePixels > run.width * run.height || output.changedPixels > output.editablePixels || expectedWeight === 0 && (output.changedPixels !== 0 || output.decodedSHA256 !== record.parentDecodedSHA256)) throw new Error('Repair changed a protected frame or exceeded its face permission.');
      }
    }
    for (const candidate of receipt.candidates) if (candidate.changedFrames !== receipt.records.filter(record => record.outputs[candidate.id].changedPixels > 0).length || candidate.qualified !== (candidate.changedFrames > 0)) throw new Error('Repair candidate change counts do not match its verified frames.');
    for (const candidate of receipt.candidates) {
      if (candidate.preview !== `candidate-${candidate.id}.mp4` || candidate.master !== `candidate-${candidate.id}.mkv` || candidate.changedFrames > run.frames || hash(path.join(folder, candidate.preview)) !== candidate.previewSHA256 || hash(path.join(folder, candidate.master)) !== candidate.masterSHA256) throw new Error('A repair candidate or lossless master changed. The original video is unchanged.');
      await this.checkMedia([path.join(folder, candidate.preview), path.join(folder, candidate.master)], run.frames, run.fps, run.width, run.height, signal);
    }
    run.candidates = receipt.candidates.map(({ preview: _preview, master: _master, ...candidate }) => candidate); run.receiptSHA256 = hash(receiptFile); run.remoteActive = false; run.processedFrames = run.frames; run.state = 'review';
    job.status = 'completed'; job.finishedAt = new Date().toISOString(); job.output = null; job.elapsedSeconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt || job.createdAt)) / 1000; job.error = null;
    job.progress = { ...job.progress, stage: run.candidates.some(c => c.qualified && c.changedFrames > 0) ? 'Ready to compare · choose a repair' : 'No safe improvement · original kept', value: run.frames, max: run.frames, completedFrames: run.frames, updatedAt: Date.now() }; this.store.saveJob(job);
  }
  async resume(job: Job) {
    if (!job.faceRepair || !['interrupted', 'cancelled', 'failed'].includes(job.status)) throw new Error('Choose an interrupted face repair to resume.');
    const request = await this.request(job);
    if (this.downloaded(job)) { await this.finish(job); return; }
    const local = this.localRecoveryReady(job, request);
    if (!local && (this.connection.status.state !== 'online' || this.store.value('cloud-connected-instance', null) !== job.faceRepair.instanceId)) throw new Error('Reconnect the same GPU instance to resume its saved repair frames.');
    job.cancelRequested = false; job.cancellationConfirmed = undefined; job.status = 'queued'; job.error = null; job.faceRepair.state = local ? 'downloaded' : 'queued'; if (local) job.faceRepair.remoteActive = false; this.store.saveJob(job, false);
  }
  async cancel(job: Job) {
    const run = job.faceRepair!;
    if (run.remoteActive) {
      if (this.connection.status.state !== 'online' || this.store.value('cloud-connected-instance', null) !== run.instanceId) throw new Error('Reconnect the same GPU to confirm face repair cancellation. It remains protected as active work.');
      await this.execute.cancel(job, path.join(this.folder(job), 'request.json'), this.folder(job)); run.remoteActive = false;
    }
    job.status = 'cancelled'; job.cancelRequested = true; job.cancellationConfirmed = true; run.cancellationConfirmed = true; run.state = 'interrupted'; job.error = null; job.progress.stage = 'Face repair cancelled'; this.store.saveJob(job, false);
  }
  async accept(jobId: string, candidateId: string): Promise<Job> {
    const pending = this.accepting.get(jobId);
    if (pending) { const done = await pending; if (done.faceRepair?.acceptedCandidateId !== candidateId) throw new Error('This revision already has an accepted candidate.'); return done; }
    const task = this.acceptChecked(jobId, candidateId); this.accepting.set(jobId, task);
    try { return await task; } finally { this.accepting.delete(jobId); }
  }
  private async acceptChecked(jobId: string, candidateId: string) {
    const job = this.store.job(jobId), run = job?.faceRepair;
    if (!job || !run || job.deleted || !['review', 'accepted'].includes(run.state)) throw new Error('Wait for this repair comparison to finish.');
    if (run.state === 'accepted') { if (run.acceptedCandidateId === candidateId) return job; throw new Error('This revision already has an accepted candidate. Start a new attempt to choose a different result.'); }
    await this.request(job); await this.finish(job);
    const candidate = job.faceRepair!.candidates.find(c => c.id === candidateId);
    if (!candidate?.qualified || candidate.changedFrames < 1) throw new Error('This candidate did not pass the safe-edit checks. The original video is kept.');
    const file = path.join(this.folder(job), `candidate-${candidate.id}.mp4`), thumb = path.join(this.folder(job), 'poster.jpg');
    await poster(file, thumb); run.acceptedCandidateId = candidate.id; run.acceptedAt = new Date().toISOString(); run.state = 'accepted'; job.output = file; job.poster = thumb; job.progress.stage = 'Face repair accepted'; this.store.saveJob(job); return job;
  }
  observeProviderStop(instanceId: number, confirmedAt: number) {
    if (!Number.isFinite(confirmedAt)) return;
    for (const job of this.store.unsettledJobs()) {
      const run = job.faceRepair;
      if (!run?.remoteActive || run.instanceId !== instanceId || confirmedAt < Date.parse(job.startedAt || job.createdAt)) continue;
      run.remoteActive = false; run.cancellationConfirmed = true; run.state = 'interrupted'; job.cancellationConfirmed = true;
      job.status = job.cancelRequested ? 'cancelled' : 'interrupted'; job.error = job.cancelRequested ? null : 'GPU compute stopped. Reconnect the same instance to recover saved repair frames.';
      this.store.saveJob(job, false);
    }
  }
  candidateFile(jobId: string, candidateId: string, type: 'video' | 'master') {
    const job = this.store.job(jobId), candidate = job?.faceRepair?.candidates.find(c => c.id === candidateId);
    if (!job || job.deleted || !candidate || !/^(boundary|identity80)$/.test(candidateId)) throw new Error('This repair candidate is unavailable.');
    const file = path.join(this.folder(job), `candidate-${candidateId}.${type === 'video' ? 'mp4' : 'mkv'}`);
    if (!existsSync(file)) throw new Error('Restore this saved repair candidate before opening it.');
    return file;
  }
}
// The root may legitimately be RECAST_DATA under .local or another hidden
// directory. Only callers' server-selected known media basenames are served.
export function sendFaceRepairFile(res: Response, file: string) {
  return res.sendFile(path.basename(file), { root: path.dirname(file) });
}
export function registerFaceRepairRoutes(app: Express, manager: FaceRepairManager, store: Store, kick: () => void) {
  app.get('/api/jobs/:id/face-repairs', async (req, res) => res.json(await manager.eligibility(String(req.params.id))));
  app.post('/api/jobs/:id/face-repairs', async (req, res) => { const job = await manager.create(String(req.params.id), req.body); res.status(202).json(publicJob(job)); kick(); });
  app.post('/api/jobs/:id/face-repairs/accept', async (req, res) => { const value = z.object({ candidateId: z.string().min(1).max(100) }).strict().parse(req.body); res.json(publicJob(await manager.accept(String(req.params.id), value.candidateId))); });
  app.get('/api/jobs/:id/face-repairs/:candidateId/:type', (req, res) => {
    const type = z.enum(['video', 'master']).parse(req.params.type), file = manager.candidateFile(String(req.params.id), String(req.params.candidateId), type);
    if (type === 'master' || req.query.download) res.attachment(`recast-repair-${String(req.params.id)}-${String(req.params.candidateId)}.${type === 'master' ? 'mkv' : 'mp4'}`);
    sendFaceRepairFile(res, file);
  });
}
