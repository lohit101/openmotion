import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { faceHash, facialFingerprint, validateFacialOcclusionReceipt } from '../server/facial-consistency';
import { command } from '../server/media';

const repo = path.resolve(import.meta.dirname, '../..');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'recast-occlusion-receipt-')); roots.push(root);
  for (const directory of ['config', 'scripts']) mkdirSync(path.join(root, directory));
  for (const name of ['facial-consistency-occlusion.lock.json', 'facial-consistency-occlusion-models.lock.json'])
    copyFileSync(path.join(repo, 'config', name), path.join(root, 'config', name));
  writeFileSync(path.join(root, 'scripts/face_occlusion_tracking.py'), '# fixture controller; never executed\n');
  const expected = { jobId: '11111111-1111-4111-8111-111111111111', sourceSHA256: 'a'.repeat(64), baseSHA256: 'b'.repeat(64), referenceSHA256: 'c'.repeat(64),
    profileSHA256: 'd'.repeat(64), trackingReceiptSHA256: 'e'.repeat(64), frames: 3, width: 128, height: 128, fps: 24 };
  const policy = JSON.parse(requireFile(path.join(root, 'config/facial-consistency-occlusion.lock.json')));
  const manifest = JSON.parse(requireFile(path.join(root, 'config/facial-consistency-occlusion-models.lock.json')));
  const modelKeys = ['landmark203', 'palm', 'hand', 'sam2'];
  const providers = ['CUDAExecutionProvider', 'OpenCV DNN CPU', 'OpenCV DNN CPU', 'Torch CUDA FP32'];
  const fields = { jobId: expected.jobId, requestVersion: 'source-face-v11', sourceSHA256: expected.sourceSHA256, rawSHA256: expected.baseSHA256, referenceSHA256: expected.referenceSHA256,
    profileSHA256: expected.profileSHA256, frames: 3, width: 128, height: 128, fps: '24/1',
    policySHA256: faceHash(path.join(root, 'config/facial-consistency-occlusion.lock.json')),
    controllerSHA256: faceHash(path.join(root, 'scripts/face_occlusion_tracking.py')),
    modelManifestSHA256: faceHash(path.join(root, 'config/facial-consistency-occlusion-models.lock.json')) };
  const trackHash = 'f'.repeat(64);
  const tracking: any = { version: 'source-occlusion-v1', complete: true, sourceRGBTransferred: false, ...fields, binding: { ...fields },
    models: Object.fromEntries(manifest.files.map((f: any, i: number) => [modelKeys[i], { sha256: f.sha256, size: f.size, providers: [providers[i]], used: true, providerVerified: true }])),
    trackBindings: [{ version: policy.version, policySHA256: fields.policySHA256, sourceSHA256: expected.sourceSHA256,
      frameCount: 3, anchorFrame: 2, trackId: 'track-A', shotId: 'shot-A', sha256: trackHash }],
    records: Array.from({ length: 3 }, (_, frame) => ({ frame, file: `frames/${String(frame).padStart(6, '0')}.npz`, sha256: String(frame + 1).repeat(64),
      sourceMaskState: 'segmented', targetMaskState: 'segmented', trackValid: true, trackBindingSHA256: trackHash,
      sourceDecodedSHA256: '4'.repeat(64), targetDecodedSHA256: '5'.repeat(64) })) };
  const receipt: any = { refinedFrames: 2, skippedFrames: 1, occlusion: { version: 'source-occlusion-v1', receiptSHA256: expected.trackingReceiptSHA256,
    sourceRGBTransferred: false, protectedByTargetMask: true, partialEyeFrames: 1, primaryFrames: 1, preservedFrames: 1 },
    records: ['primary', 'partial-eye', 'preserved'].map((route, frame) => ({ frame,
      action: route === 'primary' ? 'refined' : route,
      occlusion: { route, trackingFrameSHA256: tracking.records[frame].sha256, sourceMaskState: 'segmented', targetMaskState: 'segmented',
        targetProtectedPixelsExact: true, sourceRGBTransferred: false } })) };
  receipt.records[1].partialEyeAdmission = { admitted: true, selectedImageEye: 'image-left', manualLabelsUsed: false,
    trackedROIBounded: true, rawHandCoverageEyesMouth: [0, .8, 0], dilatedHandCoverageEyesMouth: [0, 1, .1],
    sourceEyeOutside: [false, false], sourceEyeWidths: [20, 20], sourceCropScale: 1 };
  receipt.records[1].partialEye = { edited: true, selectedImageEye: 'image-left', rawPredictedBrowMouthAndOutsideSupportExact: true,
    targetVetoZeroExact: true, sourceRGBTransferred: false, changedPixels: 50 };
  return { root, expected, tracking, receipt };
}

import { readFileSync } from 'node:fs';
const requireFile = (name: string) => readFileSync(name, 'utf8');

describe('v11 foreground-tracking provenance', () => {
  it('accepts bound primary, partial-eye and preserved records without inventing jaw receipts for the eye-only route', () => {
    const f = fixture();
    expect(validateFacialOcclusionReceipt(f.root, f.receipt, f.tracking, f.expected)).toMatchObject({
      version: 'source-occlusion-v1', partialEyeFrames: 1, primaryFrames: 1, preservedFrames: 1, protectedByTargetMask: true });
  });

  it('accepts unused CUDA trackers on an all-primary no-hand clip without claiming they ran', () => {
    const f = fixture();
    for (const name of ['landmark203', 'sam2']) Object.assign(f.tracking.models[name], { used: false, providerVerified: false });
    f.tracking.trackBindings = [];
    for (const r of f.tracking.records) Object.assign(r, { trackValid: false, trackBindingSHA256: null, sourceMaskState: 'known-none', targetMaskState: 'known-none' });
    f.receipt.records = f.tracking.records.map((r: any) => ({ frame: r.frame, action: 'refined', occlusion: {
      route: 'primary', trackingFrameSHA256: r.sha256, sourceMaskState: r.sourceMaskState, targetMaskState: r.targetMaskState,
      targetProtectedPixelsExact: true, sourceRGBTransferred: false } }));
    Object.assign(f.receipt, { refinedFrames: 3, skippedFrames: 0 });
    Object.assign(f.receipt.occlusion, { partialEyeFrames: 0, primaryFrames: 3, preservedFrames: 0 });
    expect(validateFacialOcclusionReceipt(f.root, f.receipt, f.tracking, f.expected).primaryFrames).toBe(3);
  });

  it.each([
    'incomplete', 'version', 'job', 'request-version', 'source', 'raw', 'reference', 'profile', 'fps', 'binding', 'controller', 'policy', 'models',
    'cpu-landmark', 'cpu-sam', 'unverified-use', 'cpu-runtime', 'record-count', 'record-order', 'frame-file', 'decoded-hash', 'tracking-link',
    'mask-state', 'target-unknown', 'unbound-track', 'wrong-source-track', 'manual-admission', 'two-clear-eyes',
    'covered-selected-eye', 'invalid-target-veto', 'source-rgb', 'route-action', 'summary-counts', 'receipt-link',
  ])('rejects altered %s evidence offline', variant => {
    const f = fixture(), { tracking: t, receipt: r } = f;
    switch (variant) {
      case 'incomplete': t.complete = false; break;
      case 'version': t.version = 'other'; break;
      case 'job': t.jobId = '22222222-2222-4222-8222-222222222222'; break;
      case 'request-version': t.requestVersion = 'source-face-v10'; break;
      case 'source': t.sourceSHA256 = '0'.repeat(64); break;
      case 'raw': t.rawSHA256 = '0'.repeat(64); break;
      case 'reference': t.referenceSHA256 = '0'.repeat(64); break;
      case 'profile': t.profileSHA256 = '0'.repeat(64); break;
      case 'fps': t.fps = '30/1'; break;
      case 'binding': t.binding.rawSHA256 = '0'.repeat(64); break;
      case 'controller': t.controllerSHA256 = '0'.repeat(64); break;
      case 'policy': t.policySHA256 = '0'.repeat(64); break;
      case 'models': t.models.hand.sha256 = '0'.repeat(64); break;
      case 'cpu-landmark': t.models.landmark203.providers = ['CPUExecutionProvider']; break;
      case 'cpu-sam': t.models.sam2.providers = ['CPUExecutionProvider']; break;
      case 'unverified-use': t.models.landmark203.providerVerified = false; break;
      case 'cpu-runtime': t.models.landmark203.runtimeProviders = ['CPUExecutionProvider']; break;
      case 'record-count': t.records.pop(); break;
      case 'record-order': t.records[1].frame = 0; break;
      case 'frame-file': t.records[1].file = '../outside.npz'; break;
      case 'decoded-hash': delete t.records[1].sourceDecodedSHA256; break;
      case 'tracking-link': r.records[1].occlusion.trackingFrameSHA256 = '0'.repeat(64); break;
      case 'mask-state': t.records[1].sourceMaskState = 'guess'; r.records[1].occlusion.sourceMaskState = 'guess'; break;
      case 'target-unknown': t.records[1].targetMaskState = 'unavailable'; r.records[1].occlusion.targetMaskState = 'unavailable'; break;
      case 'unbound-track': t.trackBindings = []; break;
      case 'wrong-source-track': t.trackBindings[0].sourceSHA256 = '0'.repeat(64); break;
      case 'manual-admission': r.records[1].partialEyeAdmission.manualLabelsUsed = true; break;
      case 'two-clear-eyes': r.records[1].partialEyeAdmission.dilatedHandCoverageEyesMouth = [0, 0, 1]; break;
      case 'covered-selected-eye': r.records[1].partialEyeAdmission.dilatedHandCoverageEyesMouth[0] = .1; break;
      case 'invalid-target-veto': r.records[1].partialEye.targetVetoZeroExact = false; break;
      case 'source-rgb': r.records[1].occlusion.sourceRGBTransferred = true; break;
      case 'route-action': r.records[1].action = 'refined'; break;
      case 'summary-counts': r.occlusion.partialEyeFrames = 0; r.occlusion.primaryFrames = 2; break;
      case 'receipt-link': r.occlusion.receiptSHA256 = '0'.repeat(64); break;
    }
    expect(() => validateFacialOcclusionReceipt(f.root, r, t, f.expected)).toThrow('foreground-tracking');
  });

  it('keeps the established v10 fingerprint frozen', () => {
    expect(facialFingerprint(repo, 'source-face-v10')).toBe('8fac005e7ff5af989a819570abe31ab28c9b4e4ce5c8410ce4b745274bb18927');
  });

  it('matches the Python v11 fingerprint with its new files in the exact same order', async () => {
    const output = await command('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from facial_runtime import profile_hash;print(profile_hash("source-face-v11"))', path.join(repo, 'scripts')]);
    expect(facialFingerprint(repo, 'source-face-v11')).toBe(output.trim());
  });
});
