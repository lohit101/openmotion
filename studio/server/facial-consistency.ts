import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { frameFloor } from '../shared/clip';
import { canFinishFacialLocally, facialVersionForSettings, usesFacialConsistency, type FacialConsistencyRun } from '../shared/facial-consistency';
import type { ConnectionManager } from './comfy';
import type { Store } from './store';

export class FacialConsistencyError extends Error {
  remoteStopped = false; cancellationConfirmed = false;
}
export const faceHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const facialFingerprint = (repo: string, version: FacialConsistencyRun['version'] = 'source-face-v1') => {
  if (version === 'source-face-v5') {
    const hash = createHash('sha256').update(Buffer.from(facialFingerprint(repo, 'source-face-v4'), 'hex'));
    for (const name of ['config/facial-consistency-eye-finish.lock.json', 'config/facial-consistency-eye-finish-models.lock.json', 'scripts/face_eye_finish.py', 'scripts/face_eye_motion.py', 'scripts/face_eye_placement.py', 'scripts/face_eye_temporal.py']) hash.update(readFileSync(path.join(repo, name)));
    return hash.digest('hex');
  }
  const hash = createHash('sha256')
    .update(readFileSync(path.join(repo, 'config/facial-consistency-runtime.lock.json')))
    .update(readFileSync(path.join(repo, 'config/facial-consistency-models.lock.json')));
  if (version === 'source-face-v2') hash.update(readFileSync(path.join(repo, 'config/facial-consistency-scene.lock.json')))
    .update(readFileSync(path.join(repo, 'scripts/scene_face_composite.py')));
  if (version === 'source-face-v3' || version === 'source-face-v4') hash.update(readFileSync(path.join(repo, 'config/facial-consistency-cleanup.lock.json')))
    .update(readFileSync(path.join(repo, 'config/facial-consistency-cleanup-models.lock.json')))
    .update(readFileSync(path.join(repo, 'scripts/face_feature_cleanup.py')));
  if (version === 'source-face-v4') hash.update(readFileSync(path.join(repo, 'config/facial-consistency-eye.lock.json')))
    .update(readFileSync(path.join(repo, 'scripts/face_eye_calibration.py')));
  return hash.digest('hex');
};

export interface FacialBackend {
  preflight(job: Job, reference: string, signal: AbortSignal): Promise<void>;
  finish(job: Job, files: { reference: string; source: string; base: string; folder: string }, signal: AbortSignal, progress: (frame: number, frames: number, stage: string, unit?: string) => void): Promise<void>;
  cancel(job: Job): Promise<void>;
}

export function facialCommand(repo: string, args: string[], signal?: AbortSignal, progress?: (frame: number, frames: number, stage: string, unit?: string) => void): Promise<string> {
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
  const anchorFrame = job.settings.referenceTime == null ? 0 : Math.round(job.settings.referenceTime * job.settings.fps) - frameFloor(job.settings.start, job.settings.fps);
  if (['source-face-v4', 'source-face-v5'].includes(version) && (!Number.isInteger(anchorFrame) || anchorFrame < 0 || anchorFrame >= job.progress.targetFrames))
    throw new Error('Choose the matching source reference frame inside this clip before using eye calibration.');
  return { version, profile: job.settings.facialConsistency as FacialConsistencyRun['profile'], blend: .6,
    ...(['source-face-v4', 'source-face-v5'].includes(version) ? { anchorFrame } : {}),
    instanceId, profileSHA256: facialFingerprint(repo, version), state: 'pending', processedFrames: 0, frames: job.progress.targetFrames };
}

export class ManagedFacialConsistency implements FacialBackend {
  constructor(private store: Store, private repo: string, private connection: ConnectionManager) {}
  private args(job: Job, action: string, reference?: string) {
    const run = job.facialConsistency!;
    if (this.store.value('cloud-connected-instance', null) !== run.instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188')
      throw new FacialConsistencyError('Reconnect the original GPU instance to continue this saved facial pass.');
    if (facialFingerprint(this.repo, run.version) !== run.profileSHA256) throw new FacialConsistencyError('The saved facial recipe differs from these tools. The rendered video was preserved.');
    if (['source-face-v4', 'source-face-v5'].includes(run.version) && action !== 'cancel' && (!Number.isInteger(run.anchorFrame) || run.anchorFrame! < 0 || run.anchorFrame! >= run.frames))
      throw new FacialConsistencyError('The saved eye-calibration anchor is invalid. Existing renders were preserved.');
    const [width, height] = outputDimensions(job);
    return ['--instance-id', String(run.instanceId), '--action', action, '--job', job.id, '--profile', run.profile,
      '--frames', String(run.frames), '--width', String(width), '--height', String(height), ...(run.version !== 'source-face-v1' ? ['--version', run.version] : []),
      ...(['source-face-v4', 'source-face-v5'].includes(run.version) && Number.isInteger(run.anchorFrame) ? ['--anchor-frame', String(run.anchorFrame)] : []), ...(reference ? ['--reference', reference] : [])];
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
  async finish(job: Job, files: { reference: string; source: string; base: string; folder: string }, signal: AbortSignal, progress: (frame: number, frames: number, stage: string, unit?: string) => void) {
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
    try { await access(receiptFile); await access(final); await access(path.join(files.folder, 'transport.json')); if (['source-face-v4', 'source-face-v5'].includes(run.version)) await access(path.join(files.folder, 'calibration.json')); if (run.version === 'source-face-v5') for (const name of ['native-receipt.json', 'eye-finish/request.json', 'eye-finish/restoration.json', 'eye-finish/observations.json', 'eye-finish/placement.json']) await access(path.join(files.folder, name)); downloaded = true; } catch { /* Use the same remote worker below. */ }
    if (!downloaded) {
      if (canFinishFacialLocally(job)) throw new FacialConsistencyError('A downloaded face result is missing locally; reconnect to recover its existing remote copy.');
      run.state = 'processing'; run.remoteActive = true; this.store.saveJob(job);
      await facialCommand(this.repo, [...this.args(job, 'run', files.reference), '--source', files.source, '--target', files.base, '--output', files.folder], signal,
        (frame, frames, stage) => {
          const eyeFinish = run.version === 'source-face-v5';
          if (frames !== run.frames * (eyeFinish ? 4 : 1) || frame < 0 || frame > frames) return;
          if (eyeFinish) run.workUnits = { completed: Math.max(run.workUnits?.completed || 0, frame), total: frames };
          run.processedFrames = Math.max(run.processedFrames, eyeFinish ? Math.max(0, frame - 3 * run.frames) : frame);
          run.state = frame === frames ? 'saving' : 'processing'; this.store.saveJob(job); progress(frame, frames, stage, eyeFinish ? 'work units' : 'frames');
        });
    }
    run.remoteActive = false; run.state = 'downloaded'; this.store.saveJob(job);
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8')), transport = JSON.parse(await readFile(path.join(files.folder, 'transport.json'), 'utf8'));
    if (['source-face-v4', 'source-face-v5'].includes(run.version)) {
      let saved: any;
      try { saved = JSON.parse(await readFile(path.join(files.folder, 'calibration.json'), 'utf8')); }
      catch { throw new FacialConsistencyError('The saved eye calibration is missing or invalid. Rendered output was kept.'); }
      const c = receipt.calibration, b = saved.binding, m = saved.metadata;
      const active = c?.state === 'active';
      const validActive = active && Array.isArray(c.eligibleEyes) && c.eligibleEyes.length === 2 && c.eligibleEyes.every((v: any) => typeof v === 'boolean') && c.eligibleEyes.some(Boolean) &&
        /^[0-9a-f]{64}$/.test(c.correctionSHA256) && saved.model?.correctionSHA256 === c.correctionSHA256;
      const validSkipped = c?.state === 'skipped' && ['anchor-face-uncertain', 'reference-face-uncertain', 'anchor-reference-pose-mismatch', 'anchor-eyes-not-visible'].includes(c.reason) && saved.model === null;
      if (run.profile !== 'perform-onnx60' || !Number.isInteger(run.anchorFrame) || !c || !b || !m || (!validActive && !validSkipped) ||
        c.anchorFrame !== run.anchorFrame || receipt.inputs?.request?.anchorFrame !== run.anchorFrame ||
        c.fileSHA256 !== faceHash(path.join(files.folder, 'calibration.json')) || !/^[0-9a-f]{64}$/.test(c.anchorBGRSHA256) ||
        b.jobId !== job.id || b.version !== run.version || b.profileSHA256 !== run.profileSHA256 || b.anchorFrame !== run.anchorFrame ||
        b.sourceSHA256 !== signature.sourceSHA256 || b.referenceSHA256 !== signature.referenceSHA256 ||
        Object.entries({ ...b, ...m }).some(([key, value]) => JSON.stringify(c[key]) !== JSON.stringify(value)) ||
        !Array.isArray(receipt.records) || receipt.records.some((r: any) => active && r.action === 'refined'
          ? !r.calibration || r.calibration.sourceMouthLatentUnchanged !== true || r.calibration.sourceJawLatentUnchanged !== true ||
            !Array.isArray(r.calibration.eyeCalibrationWeights) || r.calibration.eyeCalibrationWeights.length !== 2 || r.calibration.eyeCalibrationWeights.some((v: any, i: number) => !Number.isFinite(v) || v < 0 || v > 1 || !c.eligibleEyes[i] && v !== 0)
          : !!r.calibration))
        throw new FacialConsistencyError('The eye-calibration anchor or saved-state provenance failed validation. Existing output was kept.');
    }
    if (run.version === 'source-face-v5') {
      const eye = receipt.eyeFinish;
      const manifest = JSON.parse(readFileSync(path.join(this.repo, 'config/facial-consistency-eye-finish-models.lock.json'), 'utf8'));
      const paths = { 'native-receipt.json': eye?.nativeReceiptSHA256, 'eye-finish/request.json': eye?.requestSHA256,
        'eye-finish/restoration.json': eye?.restorationReceiptSHA256, 'eye-finish/observations.json': eye?.observationReceiptSHA256, 'eye-finish/placement.json': eye?.placementReceiptSHA256 };
      for (const [name, hash] of Object.entries(paths)) if (!/^[0-9a-f]{64}$/.test(String(hash)) || faceHash(path.join(files.folder, name)) !== hash)
        throw new FacialConsistencyError('The saved eye-finishing receipts failed checksum validation. Existing output was kept.');
      const native = JSON.parse(await readFile(path.join(files.folder, 'native-receipt.json'), 'utf8'));
      const request = JSON.parse(await readFile(path.join(files.folder, 'eye-finish/request.json'), 'utf8'));
      const restoration = JSON.parse(await readFile(path.join(files.folder, 'eye-finish/restoration.json'), 'utf8'));
      const observations = JSON.parse(await readFile(path.join(files.folder, 'eye-finish/observations.json'), 'utf8'));
      const placement = JSON.parse(await readFile(path.join(files.folder, 'eye-finish/placement.json'), 'utf8'));
      if (!eye?.complete || eye.version !== 'source-eye-finish-v1' || eye.sourceRGBTransferred !== false ||
        eye.restorationModelSHA256 !== manifest.files[0].sha256 || eye.observationModelSHA256 !== manifest.files[1].sha256 ||
        request.profileSHA256 !== run.profileSHA256 || request.nativeReceiptSHA256 !== eye.nativeReceiptSHA256 ||
        request.restorationModelSHA256 !== eye.restorationModelSHA256 || request.observationModelSHA256 !== eye.observationModelSHA256 ||
        !native.complete || native.outputSHA256 !== eye.nativeOutputSHA256 || JSON.stringify(native.inputs) !== JSON.stringify(receipt.inputs) ||
        !restoration.complete || restoration.inputs.nativeReceiptSHA256 !== eye.nativeReceiptSHA256 ||
        !observations.complete || observations.inputs.requestSHA256 !== eye.requestSHA256 || observations.inputs.restorationReceiptSHA256 !== eye.restorationReceiptSHA256 ||
        !placement.complete || placement.inputs.observationsSHA256 !== eye.observationReceiptSHA256 ||
        [native, restoration, observations, placement].some(r => !Array.isArray(r.records) || r.records.length !== run.frames || r.records.some((v: any, i: number) => v.frame !== i)) ||
        ['restorationSeconds', 'observationSeconds', 'placementSeconds'].some(key => !Number.isFinite(eye[key]) || eye[key] < 0) ||
        ['restorationFrames', 'placementFrames'].some(key => !Number.isInteger(eye[key]) || eye[key] < 0 || eye[key] > run.frames) ||
        receipt.providers?.eyeEnhancer?.[0] !== 'CUDAExecutionProvider' || receipt.providers?.eyeParser?.[0] !== 'CUDAExecutionProvider' ||
        receipt.records.some((r: any, i: number) => !r.eyeFinish || r.nativeSHA256 !== native.records[i].sha256 || r.sha256 !== placement.records[i].sha256 ||
          restoration.records[i].nativeSHA256 !== r.nativeSHA256 || r.eyeFinish.restoration.sha256 !== restoration.records[i].sha256 ||
          !restoration.records[i].protectedPixelsExact || !placement.records[i].protectedPixelsExact))
        throw new FacialConsistencyError('The eye-finishing source, native frames or device provenance failed validation. Output was preserved.');
      run.eyeFinish = { version: 'source-eye-finish-v1', restorationFrames: eye.restorationFrames, placementFrames: eye.placementFrames,
        restorationSeconds: eye.restorationSeconds, observationSeconds: eye.observationSeconds, placementSeconds: eye.placementSeconds,
        nativeOutputSHA256: eye.nativeOutputSHA256, sourceRGBTransferred: false };
    }
    const [width, height] = outputDimensions(job);
    if (!receipt.complete || receipt.profile !== run.profile || receipt.blend !== .6 || receipt.inputs?.version !== run.version ||
      receipt.inputs.request?.profileSHA256 !== run.profileSHA256 || receipt.inputs.request?.jobId !== job.id || receipt.inputs.request?.profile !== run.profile ||
      receipt.inputs.baseSHA256 !== signature.baseSHA256 || receipt.inputs.sourceSHA256 !== signature.sourceSHA256 || receipt.inputs.referenceSHA256 !== signature.referenceSHA256 ||
      receipt.inputs.target?.frames !== run.frames || receipt.inputs.target?.fps !== String(job.settings.fps) || receipt.inputs.target?.width !== width || receipt.inputs.target?.height !== height ||
      receipt.inputs.source?.frames !== run.frames || receipt.inputs.source?.fps !== String(job.settings.fps) ||
      transport.instanceId !== run.instanceId || transport.jobId !== job.id || transport.receiptSHA256 !== faceHash(receiptFile) ||
      receipt.outputSHA256 !== faceHash(final) || !Number.isFinite(receipt.elapsedSeconds) || receipt.elapsedSeconds < 0 ||
      !Array.isArray(receipt.records) || receipt.records.length !== run.frames || receipt.records.some((record: any, index: number) => record.frame !== index || record.protectedPixelsExact !== true || !/^[0-9a-f]{64}$/.test(record.sha256)) ||
      ['source-face-v3', 'source-face-v4', 'source-face-v5'].includes(run.version) && (receipt.providers?.parser?.[0] !== 'CUDAExecutionProvider' || receipt.records.some((record: any) => record.action === 'refined' &&
        (!record.cleanup || !Array.isArray(record.cleanup.sourceEyeGates) || record.cleanup.sourceEyeGates.length !== 2 || record.cleanup.sourceEyeGates.some((value: any) => !Number.isFinite(value) || value < 0 || value > 1) ||
          !Number.isInteger(record.cleanup.eyeTexturePixels) || record.cleanup.eyeTexturePixels < 0 || record.cleanup.eyeTexturePixels > 512 * 512 ||
          !Number.isInteger(record.cleanup.editablePixels) || record.cleanup.editablePixels < 1 || record.cleanup.editablePixels > width * height))) ||
      receipt.refinedFrames + receipt.skippedFrames !== run.frames || ['appearance', 'motion', 'warp', 'decode', 'identity'].some(key => receipt.providers?.[key]?.[0] !== 'CUDAExecutionProvider'))
      throw new FacialConsistencyError('The facial result failed provenance, timing or checksum validation. Existing renders and remote output remain saved.');
    Object.assign(run, { state: 'complete', processedFrames: run.frames, outputSHA256: receipt.outputSHA256, refinedFrames: receipt.refinedFrames,
      skippedFrames: receipt.skippedFrames, elapsedSeconds: receipt.elapsedSeconds, gpu: receipt.gpu });
    if (['source-face-v4', 'source-face-v5'].includes(run.version)) run.eyeCalibration = { state: receipt.calibration.state, anchorFrame: run.anchorFrame!,
      reason: receipt.calibration.reason, eligibleEyes: receipt.calibration.eligibleEyes, fileSHA256: receipt.calibration.fileSHA256 };
    job.output = final;
    this.store.saveJob(job);
  }
  async cancel(job: Job) {
    const output = await facialCommand(this.repo, this.args(job, 'cancel'));
    if (!output.includes('RECAST_FACIAL_STOPPED')) throw new FacialConsistencyError('Facial cancellation has not been confirmed.');
    job.facialConsistency!.remoteActive = false; job.facialConsistency!.cancellationConfirmed = true;
  }
}
