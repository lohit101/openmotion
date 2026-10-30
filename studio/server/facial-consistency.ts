import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { canFinishFacialLocally, facialVersionForSettings, usesFacialConsistency, type FacialConsistencyRun } from '../shared/facial-consistency';
import type { ConnectionManager } from './comfy';
import type { Store } from './store';

export class FacialConsistencyError extends Error {
  remoteStopped = false; cancellationConfirmed = false;
}
export const faceHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const facialFingerprint = (repo: string, version: FacialConsistencyRun['version'] = 'source-face-v1') => {
  const hash = createHash('sha256')
    .update(readFileSync(path.join(repo, 'config/facial-consistency-runtime.lock.json')))
    .update(readFileSync(path.join(repo, 'config/facial-consistency-models.lock.json')));
  if (version === 'source-face-v2') hash.update(readFileSync(path.join(repo, 'config/facial-consistency-scene.lock.json')))
    .update(readFileSync(path.join(repo, 'scripts/scene_face_composite.py')));
  if (version === 'source-face-v3') hash.update(readFileSync(path.join(repo, 'config/facial-consistency-cleanup.lock.json')))
    .update(readFileSync(path.join(repo, 'config/facial-consistency-cleanup-models.lock.json')))
    .update(readFileSync(path.join(repo, 'scripts/face_feature_cleanup.py')));
  return hash.digest('hex');
};

export interface FacialBackend {
  preflight(job: Job, reference: string, signal: AbortSignal): Promise<void>;
  finish(job: Job, files: { reference: string; source: string; base: string; folder: string }, signal: AbortSignal, progress: (frame: number, frames: number, stage: string) => void): Promise<void>;
  cancel(job: Job): Promise<void>;
}

export function facialCommand(repo: string, args: string[], signal?: AbortSignal, progress?: (frame: number, frames: number, stage: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-u', path.join(repo, 'scripts/managed_facial_consistency.py'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', buffer = '', errors = '';
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-250000); buffer += chunk;
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) try {
        const row = JSON.parse(line);
        if (Number.isInteger(row.frame) && Number.isInteger(row.frames)) progress?.(row.frame, row.frames, String(row.stage || 'Matching facial performance'));
      } catch { /* Setup/status lines are not frame counts. */ }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-12000); });
    const cleanup = () => signal?.removeEventListener('abort', abort);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (code === 0 && !signal?.aborted) return resolve(output);
      const error = new FacialConsistencyError(errors.trim() || 'Facial consistency was interrupted. The rendered video and saved face frames are kept.');
      error.remoteStopped = output.includes('RECAST_FACIAL_STOPPED');
      error.cancellationConfirmed = output.includes('RECAST_FACIAL_CANCELLED');
      reject(error);
    });
    if (signal?.aborted) abort();
  });
}

export function newFacialRun(job: Pick<Job, 'settings' | 'progress'>, repo: string, instanceId: number | null): FacialConsistencyRun | undefined {
  if (!usesFacialConsistency(job.settings)) return undefined;
  if (!instanceId) throw new Error('Facial consistency requires a connected managed GPU.');
  const version = facialVersionForSettings(job.settings);
  return { version, profile: job.settings.facialConsistency as FacialConsistencyRun['profile'], blend: .6,
    instanceId, profileSHA256: facialFingerprint(repo, version), state: 'pending', processedFrames: 0, frames: job.progress.targetFrames };
}

export class ManagedFacialConsistency implements FacialBackend {
  constructor(private store: Store, private repo: string, private connection: ConnectionManager) {}
  private args(job: Job, action: string, reference?: string) {
    const run = job.facialConsistency!;
    if (this.store.value('cloud-connected-instance', null) !== run.instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188')
      throw new FacialConsistencyError('Reconnect the original GPU instance to continue this saved facial pass.');
    if (facialFingerprint(this.repo, run.version) !== run.profileSHA256) throw new FacialConsistencyError('The saved facial recipe differs from these tools. The rendered video was preserved.');
    const [width, height] = outputDimensions(job);
    return ['--instance-id', String(run.instanceId), '--action', action, '--job', job.id, '--profile', run.profile,
      '--frames', String(run.frames), '--width', String(width), '--height', String(height), ...(run.version !== 'source-face-v1' ? ['--version', run.version] : []), ...(reference ? ['--reference', reference] : [])];
  }
  async preflight(job: Job, reference: string, signal: AbortSignal) {
    const run = job.facialConsistency!;
    if (run.preflightComplete) return;
    const hash = faceHash(reference);
    if (run.referenceSHA256 && run.referenceSHA256 !== hash) throw new FacialConsistencyError('The saved facial reference changed.');
    const args = this.args(job, 'preflight', reference);
    run.referenceSHA256 = hash; run.state = 'preparing'; run.remoteActive = true; this.store.saveJob(job);
    await facialCommand(this.repo, args, signal);
    run.preflightComplete = true; run.remoteActive = false; run.state = 'pending'; this.store.saveJob(job);
  }
  async finish(job: Job, files: { reference: string; source: string; base: string; folder: string }, signal: AbortSignal, progress: (frame: number, frames: number, stage: string) => void) {
    const run = job.facialConsistency!;
    const signature = { baseSHA256: faceHash(files.base), sourceSHA256: faceHash(files.source), referenceSHA256: faceHash(files.reference) };
    for (const key of ['baseSHA256', 'sourceSHA256', 'referenceSHA256'] as const) {
      if (run[key] && run[key] !== signature[key]) throw new FacialConsistencyError('A saved facial input changed. The rendered video was kept.');
      run[key] = signature[key];
    }
    this.store.saveJob(job);
    // A fully downloaded receipt can finish offline, without another GPU call.
    const receiptFile = path.join(files.folder, 'receipt.json'), final = path.join(files.folder, 'final.mp4');
    let downloaded = false;
    try { await access(receiptFile); await access(final); await access(path.join(files.folder, 'transport.json')); downloaded = true; } catch { /* Use the same remote worker below. */ }
    if (!downloaded) {
      if (canFinishFacialLocally(job)) throw new FacialConsistencyError('A downloaded face result is missing locally; reconnect to recover its existing remote copy.');
      run.state = 'processing'; run.remoteActive = true; this.store.saveJob(job);
      await facialCommand(this.repo, [...this.args(job, 'run', files.reference), '--source', files.source, '--target', files.base, '--output', files.folder], signal,
        (frame, frames, stage) => {
          if (frames !== run.frames || frame < 0 || frame > frames) return;
          run.processedFrames = Math.max(run.processedFrames, frame); run.state = frame === frames ? 'saving' : 'processing'; this.store.saveJob(job); progress(frame, frames, stage);
        });
    }
    run.remoteActive = false; run.state = 'downloaded'; this.store.saveJob(job);
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8')), transport = JSON.parse(await readFile(path.join(files.folder, 'transport.json'), 'utf8'));
    const [width, height] = outputDimensions(job);
    if (!receipt.complete || receipt.profile !== run.profile || receipt.blend !== .6 || receipt.inputs?.version !== run.version ||
      receipt.inputs.request?.profileSHA256 !== run.profileSHA256 || receipt.inputs.request?.jobId !== job.id || receipt.inputs.request?.profile !== run.profile ||
      receipt.inputs.baseSHA256 !== signature.baseSHA256 || receipt.inputs.sourceSHA256 !== signature.sourceSHA256 || receipt.inputs.referenceSHA256 !== signature.referenceSHA256 ||
      receipt.inputs.target?.frames !== run.frames || receipt.inputs.target?.fps !== String(job.settings.fps) || receipt.inputs.target?.width !== width || receipt.inputs.target?.height !== height ||
      receipt.inputs.source?.frames !== run.frames || receipt.inputs.source?.fps !== String(job.settings.fps) ||
      transport.instanceId !== run.instanceId || transport.jobId !== job.id || transport.receiptSHA256 !== faceHash(receiptFile) ||
      receipt.outputSHA256 !== faceHash(final) || !Number.isFinite(receipt.elapsedSeconds) || receipt.elapsedSeconds < 0 ||
      !Array.isArray(receipt.records) || receipt.records.length !== run.frames || receipt.records.some((record: any, index: number) => record.frame !== index || record.protectedPixelsExact !== true || !/^[0-9a-f]{64}$/.test(record.sha256)) ||
      run.version === 'source-face-v3' && (receipt.providers?.parser?.[0] !== 'CUDAExecutionProvider' || receipt.records.some((record: any) => record.action === 'refined' &&
        (!record.cleanup || !Array.isArray(record.cleanup.sourceEyeGates) || record.cleanup.sourceEyeGates.length !== 2 || record.cleanup.sourceEyeGates.some((value: any) => !Number.isFinite(value) || value < 0 || value > 1) ||
          !Number.isInteger(record.cleanup.eyeTexturePixels) || record.cleanup.eyeTexturePixels < 0 || record.cleanup.eyeTexturePixels > 512 * 512 ||
          !Number.isInteger(record.cleanup.editablePixels) || record.cleanup.editablePixels < 1 || record.cleanup.editablePixels > width * height))) ||
      receipt.refinedFrames + receipt.skippedFrames !== run.frames || ['appearance', 'motion', 'warp', 'decode', 'identity'].some(key => receipt.providers?.[key]?.[0] !== 'CUDAExecutionProvider'))
      throw new FacialConsistencyError('The facial result failed provenance, timing or checksum validation. Existing renders and remote output remain saved.');
    Object.assign(run, { state: 'complete', processedFrames: run.frames, outputSHA256: receipt.outputSHA256, refinedFrames: receipt.refinedFrames,
      skippedFrames: receipt.skippedFrames, elapsedSeconds: receipt.elapsedSeconds, gpu: receipt.gpu });
    job.output = final;
    this.store.saveJob(job);
  }
  async cancel(job: Job) {
    const output = await facialCommand(this.repo, this.args(job, 'cancel'));
    if (!output.includes('RECAST_FACIAL_STOPPED')) throw new FacialConsistencyError('Facial cancellation has not been confirmed.');
    job.facialConsistency!.remoteActive = false; job.facialConsistency!.cancellationConfirmed = true;
  }
}
