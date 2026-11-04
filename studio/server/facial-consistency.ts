import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { frameFloor } from '../shared/clip';
import { canFinishFacialLocally, facialVersionForSettings, facialProgressForRun, usesFacialConsistency, isCalibratedFacialVersion, isCleanupFacialVersion, isEyeFinishedFacialVersion, isGeometryFacialVersion, isBoundaryFacialVersion, isOcclusionTrackedFacialVersion, type FacialConsistencyRun } from '../shared/facial-consistency';
import type { ConnectionManager } from './comfy';
import type { Store } from './store';

export class FacialConsistencyError extends Error {
  remoteStopped = false; cancellationConfirmed = false;
}
export const faceHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const occlusionFingerprintFiles = [
  'config/facial-consistency-occlusion.lock.json',
  'config/facial-consistency-occlusion-models.lock.json',
  'config/facial-consistency-occlusion-runtime.lock.json',
  'scripts/face_partial_source.py', 'scripts/face_occlusion_tracking.py',
  'scripts/face_occlusion_finish.py',
  'scripts/facial_occlusion_runtime.py',
  'scripts/face_occlusion_vendor/__init__.py',
  'scripts/face_occlusion_vendor/mp_palmdet.py',
  'scripts/face_occlusion_vendor/mp_handpose.py',
  'scripts/face_occlusion_vendor/crop.py',
  'scripts/face_occlusion_vendor/LICENSE.opencv-zoo',
  'scripts/face_occlusion_vendor/LICENSE.performrecast',
  'scripts/face_occlusion_vendor/provenance.json',
];
export const facialFingerprint = (repo: string, version: FacialConsistencyRun['version'] = 'source-face-v1') => {
  if (isOcclusionTrackedFacialVersion(version)) {
    const hash = createHash('sha256').update(Buffer.from(facialFingerprint(repo, 'source-face-v10'), 'hex'));
    for (const name of occlusionFingerprintFiles) hash.update(readFileSync(path.join(repo, name)));
    return hash.digest('hex');
  }
  if (isBoundaryFacialVersion(version)) {
    const hash = createHash('sha256').update(Buffer.from(facialFingerprint(repo, version === 'source-face-v9' ? 'source-face-v6' : 'source-face-v7'), 'hex'));
    for (const name of ['config/facial-consistency-boundary.lock.json', 'scripts/face_boundary_blend.py']) hash.update(readFileSync(path.join(repo, name)));
    return hash.digest('hex');
  }
  const bases = { 'source-face-v6': 'source-face-v3', 'source-face-v7': 'source-face-v4', 'source-face-v8': 'source-face-v5' } as const;
  if (version in bases) {
    const base = bases[version as keyof typeof bases];
    const hash = createHash('sha256').update(Buffer.from(facialFingerprint(repo, base), 'hex'));
    for (const name of ['config/facial-consistency-geometry.lock.json', 'scripts/face_jaw_geometry.py',
      ...(version === 'source-face-v8' ? ['scripts/face_geometry_eye_finish.py', 'scripts/face_geometry_eye_motion.py'] : [])]) hash.update(readFileSync(path.join(repo, name)));
    return hash.digest('hex');
  }
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
  if (isCalibratedFacialVersion(version) && (!Number.isInteger(anchorFrame) || anchorFrame < 0 || anchorFrame >= job.progress.targetFrames))
    throw new Error('Choose the matching source reference frame inside this clip before using eye calibration.');
  return { version, profile: job.settings.facialConsistency as FacialConsistencyRun['profile'], blend: .6,
    ...(isCalibratedFacialVersion(version) ? { anchorFrame } : {}),
    instanceId, profileSHA256: facialFingerprint(repo, version), state: 'pending', processedFrames: 0, frames: job.progress.targetFrames };
}

export function validateFacialOcclusionReceipt(repo: string, receipt: any, tracking: any, expected: {
  jobId: string;
  sourceSHA256: string; baseSHA256: string; referenceSHA256: string; profileSHA256: string;
  frames: number; width: number; height: number; fps: number; trackingReceiptSHA256: string;
}): NonNullable<FacialConsistencyRun['occlusion']> {
  const invalid = () => { throw new FacialConsistencyError('The foreground-tracking input, model or frame provenance failed validation. Existing output was preserved.'); };
  const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const count = (v: unknown, max: number) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;
  const policyFile = path.join(repo, 'config/facial-consistency-occlusion.lock.json');
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  const manifestFile = path.join(repo, 'config/facial-consistency-occlusion-models.lock.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const o = receipt?.occlusion;
  const fps = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d+(?:\/\d+)?$/.test(value)) return false;
    const [n, d = 1] = value.split('/').map(Number);
    return n > 0 && d > 0 && n / d === expected.fps;
  };
  if (!o || o.version !== 'source-occlusion-v1' || o.sourceRGBTransferred !== false || o.protectedByTargetMask !== true ||
    o.receiptSHA256 !== expected.trackingReceiptSHA256 || !hash(o.receiptSHA256) ||
    ['partialEyeFrames', 'primaryFrames', 'preservedFrames'].some(k => !count(o[k], expected.frames)) ||
    o.partialEyeFrames + o.primaryFrames + o.preservedFrames !== expected.frames ||
    tracking?.complete !== true || tracking.version !== 'source-occlusion-v1' || tracking.sourceRGBTransferred !== false ||
    tracking.jobId !== expected.jobId || tracking.requestVersion !== 'source-face-v11' ||
    tracking.sourceSHA256 !== expected.sourceSHA256 || tracking.rawSHA256 !== expected.baseSHA256 ||
    tracking.referenceSHA256 !== expected.referenceSHA256 || tracking.profileSHA256 !== expected.profileSHA256 ||
    tracking.frames !== expected.frames || tracking.width !== expected.width || tracking.height !== expected.height || !fps(tracking.fps) ||
    tracking.policySHA256 !== faceHash(policyFile) || tracking.modelManifestSHA256 !== faceHash(manifestFile) ||
    tracking.controllerSHA256 !== faceHash(path.join(repo, 'scripts/face_occlusion_tracking.py')) ||
    !tracking.binding || ['jobId', 'requestVersion', 'sourceSHA256', 'rawSHA256', 'referenceSHA256', 'profileSHA256', 'frames', 'width', 'height', 'fps', 'policySHA256', 'controllerSHA256', 'modelManifestSHA256']
      .some(k => tracking.binding[k] !== tracking[k]) ||
    !Array.isArray(tracking.records) || tracking.records.length !== expected.frames ||
    !Array.isArray(receipt.records) || receipt.records.length !== expected.frames || !Array.isArray(tracking.trackBindings)) invalid();
  const models: Record<string, { filename: string; provider: string }> = {
    landmark203: { filename: 'landmark203.onnx', provider: 'CUDAExecutionProvider' },
    palm: { filename: 'palm_detection_mediapipe_2023feb.onnx', provider: 'OpenCV DNN CPU' },
    hand: { filename: 'handpose_estimation_mediapipe_2023feb.onnx', provider: 'OpenCV DNN CPU' },
    sam2: { filename: 'sam2.1_hiera_tiny.pt', provider: 'Torch CUDA FP32' },
  };
  for (const [key, model] of Object.entries(models)) {
    const file = manifest.files.find((v: any) => path.basename(v.destination) === model.filename), actual = tracking.models?.[key];
    if (!file || !actual || actual.sha256 !== file.sha256 || actual.size !== file.size ||
      !Array.isArray(actual.providers) || actual.providers.length !== 1 || actual.providers[0] !== model.provider ||
      typeof actual.used !== 'boolean' || typeof actual.providerVerified !== 'boolean' || actual.used && !actual.providerVerified ||
      actual.used && actual.runtimeProviders !== undefined && (!Array.isArray(actual.runtimeProviders) || !actual.runtimeProviders.length ||
        key === 'landmark203' && actual.runtimeProviders[0] !== 'CUDAExecutionProvider' || key === 'sam2' && !/cuda/i.test(String(actual.runtimeProviders[0])))) invalid();
  }
  const bindings = new Map<string, any>();
  for (const b of tracking.trackBindings) {
    if (!b || !hash(b.sha256) || bindings.has(b.sha256) || b.version !== policy.version || b.policySHA256 !== tracking.policySHA256 ||
      b.sourceSHA256 !== expected.sourceSHA256 || b.frameCount !== expected.frames || !count(b.anchorFrame, expected.frames - 1) ||
      typeof b.trackId !== 'string' || !b.trackId || typeof b.shotId !== 'string' || !b.shotId) invalid();
    bindings.set(b.sha256, b);
  }
  const states = ['segmented', 'known-none', 'unavailable'];
  const routes = { primary: 0, 'partial-eye': 0, preserved: 0 };
  for (let i = 0; i < expected.frames; i++) {
    const t = tracking.records[i], r = receipt.records[i], c = r?.occlusion;
    if (!t || t.frame !== i || t.file !== `frames/${String(i).padStart(6, '0')}.npz` || !hash(t.sha256) ||
      !hash(t.sourceDecodedSHA256) || !hash(t.targetDecodedSHA256) || !states.includes(t.sourceMaskState) || !states.includes(t.targetMaskState) ||
      typeof t.trackValid !== 'boolean' || t.trackBindingSHA256 !== null && !hash(t.trackBindingSHA256) ||
      t.trackValid && !bindings.has(t.trackBindingSHA256) ||
      !r || r.frame !== i || !c || c.trackingFrameSHA256 !== t.sha256 || c.sourceMaskState !== t.sourceMaskState || c.targetMaskState !== t.targetMaskState ||
      c.targetProtectedPixelsExact !== true || c.sourceRGBTransferred !== false || !Object.hasOwn(routes, c.route) ||
      c.route === 'primary' && r.action !== 'refined' || c.route === 'partial-eye' && r.action !== 'partial-eye' ||
      c.route === 'preserved' && !['preserved', 'skipped'].includes(r.action) ||
      t.targetMaskState === 'unavailable' && c.route !== 'preserved') invalid();
    routes[c.route as keyof typeof routes]++;
    if (c.route === 'partial-eye') {
      const a = r.partialEyeAdmission, p = r.partialEye;
      const selected = a?.selectedImageEye === 'image-left' ? 0 : a?.selectedImageEye === 'image-right' ? 1 : -1;
      const vector = (value: any, size: number) => Array.isArray(value) && value.length === size && value.every((v: any) => Number.isFinite(v) && v >= 0 && v <= 1);
      if (!t.trackValid || t.sourceMaskState !== 'segmented' || !bindings.has(t.trackBindingSHA256) ||
        !a?.admitted || selected < 0 || a.manualLabelsUsed !== false || a.trackedROIBounded !== true ||
        !vector(a.rawHandCoverageEyesMouth, 3) || !vector(a.dilatedHandCoverageEyesMouth, 3) ||
        !a.dilatedHandCoverageEyesMouth.some((v: number) => v > 0) || a.dilatedHandCoverageEyesMouth[selected] !== 0 ||
        !Array.isArray(a.sourceEyeOutside) || a.sourceEyeOutside.length !== 2 || a.sourceEyeOutside.some((v: any) => typeof v !== 'boolean') || a.sourceEyeOutside[selected] ||
        !Array.isArray(a.sourceEyeWidths) || a.sourceEyeWidths.length !== 2 || a.sourceEyeWidths.some((v: any) => !Number.isFinite(v)) ||
        a.sourceEyeWidths[selected] < policy.partial_eye.source_minimum_eye_width ||
        !Number.isFinite(a.sourceCropScale) || a.sourceCropScale < policy.partial_eye.source_crop_min_scale || a.sourceCropScale > policy.partial_eye.source_crop_max_scale ||
        !p?.edited || p.selectedImageEye !== a.selectedImageEye || p.rawPredictedBrowMouthAndOutsideSupportExact !== true || p.targetVetoZeroExact !== true ||
        p.sourceRGBTransferred !== false || !count(p.changedPixels, expected.width * expected.height)) invalid();
      const clear = a.dilatedHandCoverageEyesMouth.slice(0, 2).filter((v: number, eye: number) => v === 0 && !a.sourceEyeOutside[eye] && a.sourceEyeWidths[eye] >= policy.partial_eye.source_minimum_eye_width);
      if (clear.length !== 1) invalid();
    }
  }
  if (routes.primary !== o.primaryFrames || routes['partial-eye'] !== o.partialEyeFrames || routes.preserved !== o.preservedFrames ||
    receipt.refinedFrames !== routes.primary + routes['partial-eye'] || receipt.skippedFrames !== routes.preserved) invalid();
  return { version: 'source-occlusion-v1', receiptSHA256: o.receiptSHA256, partialEyeFrames: o.partialEyeFrames,
    primaryFrames: o.primaryFrames, preservedFrames: o.preservedFrames, sourceRGBTransferred: false, protectedByTargetMask: true };
}

export class ManagedFacialConsistency implements FacialBackend {
  constructor(private store: Store, private repo: string, private connection: ConnectionManager) {}
  private args(job: Job, action: string, reference?: string) {
    const run = job.facialConsistency!;
    if (this.store.value('cloud-connected-instance', null) !== run.instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188')
      throw new FacialConsistencyError('Reconnect the original GPU instance to continue this saved facial pass.');
    if (facialFingerprint(this.repo, run.version) !== run.profileSHA256) throw new FacialConsistencyError('The saved facial recipe differs from these tools. The rendered video was preserved.');
    if (isCalibratedFacialVersion(run.version) && action !== 'cancel' && (!Number.isInteger(run.anchorFrame) || run.anchorFrame! < 0 || run.anchorFrame! >= run.frames))
      throw new FacialConsistencyError('The saved eye-calibration anchor is invalid. Existing renders were preserved.');
    const [width, height] = outputDimensions(job);
    return ['--instance-id', String(run.instanceId), '--action', action, '--job', job.id, '--profile', run.profile,
      '--frames', String(run.frames), '--width', String(width), '--height', String(height), ...(run.version !== 'source-face-v1' ? ['--version', run.version] : []),
      ...(isCalibratedFacialVersion(run.version) && Number.isInteger(run.anchorFrame) ? ['--anchor-frame', String(run.anchorFrame)] : []), ...(reference ? ['--reference', reference] : [])];
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
    try { await access(receiptFile); await access(final); await access(path.join(files.folder, 'transport.json')); if (isCalibratedFacialVersion(run.version)) await access(path.join(files.folder, 'calibration.json')); if (isOcclusionTrackedFacialVersion(run.version)) await access(path.join(files.folder, 'occlusion-receipt.json')); if (isEyeFinishedFacialVersion(run.version)) for (const name of ['native-receipt.json', 'eye-finish/request.json', 'eye-finish/restoration.json', 'eye-finish/observations.json', 'eye-finish/placement.json']) await access(path.join(files.folder, name)); downloaded = true; } catch { /* Use the same remote worker below. */ }
    if (!downloaded) {
      if (canFinishFacialLocally(job)) throw new FacialConsistencyError('A downloaded face result is missing locally; reconnect to recover its existing remote copy.');
      run.state = 'processing'; run.remoteActive = true; this.store.saveJob(job);
      await facialCommand(this.repo, [...this.args(job, 'run', files.reference), '--source', files.source, '--target', files.base, '--output', files.folder], signal,
        (frame, frames, stage) => {
          const work = facialProgressForRun(run.version, run.frames, frame, frames);
          if (!work) return;
          if (work.multistage) run.workUnits = { completed: Math.max(run.workUnits?.completed || 0, work.completed), total: work.total };
          run.processedFrames = Math.max(run.processedFrames, work.processedFrames);
          const completed = work.multistage ? run.workUnits!.completed : work.completed;
          run.state = completed === work.total ? 'saving' : 'processing'; this.store.saveJob(job); progress(completed, work.total, stage, work.multistage ? 'work units' : 'frames');
        });
    }
    run.remoteActive = false; run.state = 'downloaded'; this.store.saveJob(job);
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8')), transport = JSON.parse(await readFile(path.join(files.folder, 'transport.json'), 'utf8'));
    if (isCalibratedFacialVersion(run.version)) {
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
        !Array.isArray(receipt.records) || receipt.records.some((r: any) => active && (r.action === 'refined' || isOcclusionTrackedFacialVersion(run.version) && r.action === 'partial-eye')
          ? !r.calibration || r.calibration.sourceMouthLatentUnchanged !== true || r.calibration.sourceJawLatentUnchanged !== true ||
            !Array.isArray(r.calibration.eyeCalibrationWeights) || r.calibration.eyeCalibrationWeights.length !== 2 || r.calibration.eyeCalibrationWeights.some((v: any, i: number) => !Number.isFinite(v) || v < 0 || v > 1 || !c.eligibleEyes[i] && v !== 0)
          : !!r.calibration))
        throw new FacialConsistencyError('The eye-calibration anchor or saved-state provenance failed validation. Existing output was kept.');
    }
    if (isEyeFinishedFacialVersion(run.version)) {
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
    if (isOcclusionTrackedFacialVersion(run.version)) {
      const trackingFile = path.join(files.folder, 'occlusion-receipt.json');
      let tracking: any;
      try { tracking = JSON.parse(await readFile(trackingFile, 'utf8')); }
      catch { throw new FacialConsistencyError('The saved foreground-tracking receipt is missing or invalid. Existing output was preserved.'); }
      run.occlusion = validateFacialOcclusionReceipt(this.repo, receipt, tracking, { ...signature, jobId: job.id, profileSHA256: run.profileSHA256,
        frames: run.frames, width, height, fps: job.settings.fps, trackingReceiptSHA256: faceHash(trackingFile) });
    }
    if (isBoundaryFacialVersion(run.version)) {
      const boundary = JSON.parse(readFileSync(path.join(this.repo, 'config/facial-consistency-boundary.lock.json'), 'utf8'));
      if (!Array.isArray(receipt.records) || receipt.records.some((record: any) => {
        if (record.action !== 'refined') return false;
        const b = record.cleanup?.boundaryBlend;
        return !b || b.version !== boundary.version || b.strength !== boundary.strength || b.outwardGrowth !== false || b.sourceRGBTransferred !== false ||
          !Number.isInteger(b.boundaryPixels) || b.boundaryPixels < 0 || b.boundaryPixels > 512 * 512;
      })) throw new FacialConsistencyError('The face-boundary receipt failed validation. Existing rendered video was preserved.');
    }
    if (isGeometryFacialVersion(run.version)) {
      const geometry = JSON.parse(readFileSync(path.join(this.repo, 'config/facial-consistency-geometry.lock.json'), 'utf8'));
      const reasons = ['source-jaw-not-visible', 'source-jaw-outside-crop', 'jaw-geometry-uncertain', 'no-outward-jaw-motion'];
      if (!Array.isArray(receipt.records) || receipt.records.some((record: any) => {
        if (record.action !== 'refined') return false;
        const jaw = record.cleanup?.jawGeometry;
        return !jaw || jaw.version !== geometry.version || !Number.isFinite(jaw.sourceJawVisibility) || jaw.sourceJawVisibility < 0 || jaw.sourceJawVisibility > 1 ||
          ['extensionPixels', 'bridgePixels', 'supportPixels'].some(key => !Number.isInteger(jaw[key]) || jaw[key] < 0 || jaw[key] > 512 * 512) ||
          (jaw.reason === null ? jaw.extensionPixels < 1 || jaw.supportPixels < jaw.extensionPixels || jaw.sourceJawVisibility < geometry.source_jaw_minimum_visible_fraction :
            !reasons.includes(jaw.reason) || jaw.extensionPixels !== 0 || jaw.bridgePixels !== 0 || jaw.supportPixels !== 0);
      })) throw new FacialConsistencyError('The jaw-geometry receipt failed validation. Existing rendered video was preserved.');
    }
    if (!receipt.complete || receipt.profile !== run.profile || receipt.blend !== .6 || receipt.inputs?.version !== run.version ||
      receipt.inputs.request?.profileSHA256 !== run.profileSHA256 || receipt.inputs.request?.jobId !== job.id || receipt.inputs.request?.profile !== run.profile ||
      receipt.inputs.baseSHA256 !== signature.baseSHA256 || receipt.inputs.sourceSHA256 !== signature.sourceSHA256 || receipt.inputs.referenceSHA256 !== signature.referenceSHA256 ||
      receipt.inputs.target?.frames !== run.frames || receipt.inputs.target?.fps !== String(job.settings.fps) || receipt.inputs.target?.width !== width || receipt.inputs.target?.height !== height ||
      receipt.inputs.source?.frames !== run.frames || receipt.inputs.source?.fps !== String(job.settings.fps) ||
      transport.instanceId !== run.instanceId || transport.jobId !== job.id || transport.receiptSHA256 !== faceHash(receiptFile) ||
      receipt.outputSHA256 !== faceHash(final) || !Number.isFinite(receipt.elapsedSeconds) || receipt.elapsedSeconds < 0 ||
      !Array.isArray(receipt.records) || receipt.records.length !== run.frames || receipt.records.some((record: any, index: number) => record.frame !== index || record.protectedPixelsExact !== true || !/^[0-9a-f]{64}$/.test(record.sha256)) ||
      isCleanupFacialVersion(run.version) && (receipt.providers?.parser?.[0] !== 'CUDAExecutionProvider' || receipt.records.some((record: any) => record.action === 'refined' &&
        (!record.cleanup || !Array.isArray(record.cleanup.sourceEyeGates) || record.cleanup.sourceEyeGates.length !== 2 || record.cleanup.sourceEyeGates.some((value: any) => !Number.isFinite(value) || value < 0 || value > 1) ||
          !Number.isInteger(record.cleanup.eyeTexturePixels) || record.cleanup.eyeTexturePixels < 0 || record.cleanup.eyeTexturePixels > 512 * 512 ||
          !Number.isInteger(record.cleanup.editablePixels) || record.cleanup.editablePixels < 1 || record.cleanup.editablePixels > width * height))) ||
      receipt.refinedFrames + receipt.skippedFrames !== run.frames || ['appearance', 'motion', 'warp', 'decode', 'identity'].some(key => receipt.providers?.[key]?.[0] !== 'CUDAExecutionProvider'))
      throw new FacialConsistencyError('The facial result failed provenance, timing or checksum validation. Existing renders and remote output remain saved.');
    Object.assign(run, { state: 'complete', processedFrames: run.frames, outputSHA256: receipt.outputSHA256, refinedFrames: receipt.refinedFrames,
      skippedFrames: receipt.skippedFrames, elapsedSeconds: receipt.elapsedSeconds, gpu: receipt.gpu });
    if (isCalibratedFacialVersion(run.version)) run.eyeCalibration = { state: receipt.calibration.state, anchorFrame: run.anchorFrame!,
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
