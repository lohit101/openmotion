import { describe, expect, it } from 'vitest';
import { addRepairSelection, moveRepairEdge, parseRepairTime, repairEditableFrames, repairLoopFrames, repairPointerFrame } from '../shared/face-repair-ui';
import { normalizeRepairRanges } from '../shared/face-repair';
import { ActivityAlertTracker } from '../shared/alerts';
import { emptyModels } from '../shared/models';
import { defaults, type Bootstrap, type Job } from '../shared/types';
import { jobDuration, runSummary, savedRunSettings } from '../shared/library';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepairTimeline } from '../src/FaceRepairDialog';
import JobCard from '../src/JobCard';
import { overallProgressEstimate, retainOverallProgress } from '../shared/generation-progress';

describe('repair timeline permission and frame gestures', () => {
  it('commits entered times to real frames without interpreting an empty draft as zero', () => {
    expect(parseRepairTime('', 24, 0, 240)).toBeNull(); expect(parseRepairTime('bad', 24, 0, 240)).toBeNull();
    expect(parseRepairTime('2.3', 24, 0, 78)).toBe(55); expect(parseRepairTime('3.3', 24, 56, 240)).toBe(79);
    expect(parseRepairTime('-5', 24, 0, 78)).toBe(0); expect(parseRepairTime('50', 24, 56, 240)).toBe(240);
  });
  it('keeps the original pointer grab offset reversible at both frame boundaries', () => {
    const original = { id: 'range', startFrame: 55, endFrame: 79 };
    expect(moveRepairEdge(original, 'start', -200, 240).startFrame).toBe(0);
    expect(moveRepairEdge(original, 'start', 55, 240)).toEqual(original);
    expect(moveRepairEdge(original, 'end', 600, 240).endFrame).toBe(240);
    expect(moveRepairEdge(original, 'end', 79, 240)).toEqual(original);
    expect(moveRepairEdge(original, 'start', 100, 240).startFrame).toBe(78);
    expect(moveRepairEdge(original, 'end', -5, 240).endFrame).toBe(56);
  });
  it('uses rounded real frames and handles the final timeline boundary', () => {
    expect(repairPointerFrame(329, 100, 1000, 240)).toBe(55);
    expect(repairPointerFrame(1101, 100, 1000, 240)).toBe(240);
    expect(repairPointerFrame(-100, 100, 1000, 240)).toBe(0);
    expect(repairPointerFrame(100, 100, 0, 240)).toBe(0);
    expect(addRepairSelection(240, 240, 24, 'end')).toEqual({ id: 'end', startFrame: 239, endFrame: 240 });
  });
  it('shows .25-second edit handles independently of the read-only join loop', () => {
    const ranges = normalizeRepairRanges([{ startFrame: 55, endFrame: 79 }, { startFrame: 110, endFrame: 134 }], 240, 24);
    expect(ranges[0]).toEqual({ startFrame: 55, endFrame: 79, editableStartFrame: 49, editableEndFrame: 85 });
    expect(repairLoopFrames(ranges[0], 240, 24)).toEqual([37, 97]);
    expect(repairEditableFrames(ranges)).toBe(72);
  });
  it('counts overlapping handles once and clamps context at clip edges', () => {
    const ranges = normalizeRepairRanges([{ startFrame: 0, endFrame: 1 }, { startFrame: 5, endFrame: 8 }, { startFrame: 239, endFrame: 240 }], 240, 24);
    expect(repairEditableFrames(ranges)).toBe(21);
    expect(repairLoopFrames(ranges[0], 240, 24)[0]).toBe(0);
    expect(repairLoopFrames(ranges[2], 240, 24)[1]).toBe(240);
  });
});

const repairJob = (state: 'processing' | 'review' | 'accepted'): Job => ({
  id: 'repair', title: 'Private title', origin: 'repair', status: state === 'processing' ? 'running' : 'completed',
  sourceId: 'source', referenceId: 'reference', createdAt: '2026-11-04T12:00:00Z', settings: defaults,
  width: 480, height: 832, favorite: false, deleted: false, context: '', segments: [], workflow: null, uploads: null,
  pendingPrompt: null, cancelRequested: false, output: state === 'accepted' ? 'ready' : null, poster: null, elapsedSeconds: null, error: null,
  progress: { stage: 'Repairing selected frames', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: 30, targetFrames: 72, updatedAt: 1 },
  faceRepair: { version: 'face-repair-v1', parentJobId: 'parent', rootJobId: 'parent', requestId: 'once', instanceId: 1, goal: 'auto', ranges: normalizeRepairRanges([{ startFrame: 55, endFrame: 79 }], 240, 24), frames: 240, fps: 24, width: 480, height: 832, binding: { finishedSHA256: '', rawSHA256: '', sourceSHA256: '', referenceSHA256: '', parentProfileSHA256: '', profileSHA256: '', parentReceiptSHA256: '', parentCalibrationSHA256: '' }, state, processedFrames: 30, remoteActive: state === 'processing', candidates: [] },
});
it('announces review before acceptance, then the saved revision, once each', () => {
  const snapshot = (job: Job): Bootstrap => ({ jobs: [job], assets: [], draft: { sourceId: null, referenceId: null, settings: defaults }, connection: { state: 'offline', gpu: null, endpoint: '', message: '', checkedAt: '', loras: [] }, models: emptyModels(), cloud: { configured: false, instances: [], launches: [], refreshedAt: null, error: null, busy: false } });
  const tracker = new ActivityAlertTracker(Date.parse('2026-11-04T11:59:00Z'));
  expect(tracker.collect(snapshot(repairJob('processing')))).toEqual([]);
  const review = snapshot(repairJob('review'));
  expect(tracker.collect(review).map(a => a.title)).toEqual(['Face repair is ready to compare']);
  const notification = new ActivityAlertTracker(Date.parse('2026-11-04T11:59:00Z')); notification.collect(snapshot(repairJob('processing')));
  expect(notification.collect(review)[0].target).toMatchObject({ jobId: 'repair', repair: true });
  expect(tracker.collect(review)).toEqual([]);
  const saved = snapshot(repairJob('accepted'));
  expect(tracker.collect(saved).map(a => a.title)).toEqual(['Repaired revision saved']);
  expect(tracker.collect(saved)).toEqual([]);
  expect(new ActivityAlertTracker().collect(review)).toEqual([]);
});
it('holds one earned progress estimate across tracking, sparse correction, export and review', () => {
  const job = repairJob('processing'); let high = 0;
  const stages: [string, number, number][] = [
    ['Checking installed face repair tools', 0, 240], ['Transferring frozen repair inputs', 0, 240],
    ['Inspecting source hands and faces for selected repair', 240, 240], ['Tracking source foreground for selected repair', 240, 240],
    ['Inspecting target hands and faces for selected repair', 1, 240], ['Tracking target foreground for selected repair', 240, 240],
    ['Tracking partial source face for selected repair', 240, 240], ['Preserving accepted frames', 1, 240], ['Repairing selected facial frames', 134, 240],
    ['Verifying lossless repair and original audio', 240, 241], ['Downloading verified repair candidates', 0, 240],
  ];
  for (const [stage, value, max] of stages) { const current = { ...job, progress: { ...job.progress, stage, value, max } }; const next = retainOverallProgress(high, current); expect(next).toBeGreaterThanOrEqual(high); expect(next).toBeLessThan(100); high = next; }
  expect(overallProgressEstimate(repairJob('review'))).toBe(99);
  expect(overallProgressEstimate(repairJob('accepted'))).toBe(100);
});
it('presents an unaccepted repair for review without a broken output-video URL', () => {
  const job = repairJob('review');
  const html = renderToStaticMarkup(<JobCard job={job} onSelect={() => undefined} onPatch={() => undefined} onReuse={() => undefined} />);
  expect(html).toContain('Ready to compare'); expect(html).not.toContain('<video'); expect(html).not.toContain('>Download video<');
  expect(jobDuration(job)).toBe(10);
  expect(savedRunSettings(job)).not.toHaveProperty('seed');
  expect(runSummary(job)).toContainEqual(['New video generation', 'None']);
});
it('renders independently accessible frame handles and the protected-footage legend', () => {
  const html = renderToStaticMarkup(<RepairTimeline selections={[{ id: 'a', startFrame: 55, endFrame: 79 }]} change={() => undefined} frames={240} fps={24} time={0} seek={() => undefined} />);
  expect(html).toContain('aria-label="Repair 1 start"'); expect(html).toContain('aria-label="Repair 1 end"');
  expect(html).toContain('aria-valuenow="55"'); expect(html).toContain('Protected footage'); expect(html).toContain('up to 0.25s');
});
