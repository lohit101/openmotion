import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job, Progress } from '../shared/types';
import { defaults } from '../shared/types';
import { imageDefaults } from '../shared/image-replacement';
import { nativeProgress, overallProgressEstimate, retainOverallProgress } from '../shared/generation-progress';
import GenerationProgress, { RenderProgressInsights } from '../src/GenerationProgress';

function video(): Job {
  return { id: 'progress-fixture', title: 'Progress fixture', status: 'running', settings: { ...defaults, engine: 'viggle', referencePreparation: 'prepared' }, sourceId: 'source', referenceId: 'reference', createdAt: '2026-10-28', width: 704, height: 1248, favorite: false, deleted: false, progress: { stage: 'Preparing your clip', node: null, value: null, max: null, unit: 'items', segment: 1, segments: 3, completedFrames: 0, targetFrames: 356, updatedAt: 0 }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}
function snapshot(job: Job, progress: Partial<Progress>): Job { return { ...job, progress: { ...job.progress, ...progress } }; }

describe('one full-lifecycle progress indicator', () => {
  it('starts at zero and reserves 100 for the finished output, including after final inference and assembly', () => {
    const job = video();
    expect(overallProgressEstimate({ ...job, status: 'queued' })).toBe(0);
    const inferred = snapshot(job, { segment: 3, node: '43', value: 5, max: 5 });
    expect(overallProgressEstimate(inferred)).toBeLessThan(100);
    const assembled = snapshot(inferred, { node: null, stage: 'Assembling final video', completedFrames: 356 });
    expect(overallProgressEstimate(assembled)).toBeGreaterThan(overallProgressEstimate(inferred));
    expect(overallProgressEstimate({ ...assembled, status: 'completed' })).toBeLessThan(100);
    expect(overallProgressEstimate({ ...assembled, status: 'completed', output: 'ready' })).toBe(100);
  });
  it('never resets as the sampler, two transfers and next segment restart their native counters', () => {
    let job = video(), high = 0;
    const snapshots: Job[] = [
      snapshot(job, { node: '43', value: 1, max: 5 }), snapshot(job, { node: '43', value: 5, max: 5 }),
      snapshot(job, { node: '44', value: null, max: null }),
      snapshot(job, { node: null, stage: 'Downloading completed segment', unit: 'bytes', value: 100, max: 100 }),
      snapshot(job, { node: null, stage: 'Backing up continuity · completed segment is saved', unit: 'bytes', value: 0, max: 100 }),
    ];
    job = { ...job, segments: [{ file: 'segment', frames: 124, seconds: 5.17, promptId: 'saved' }] };
    snapshots.push(snapshot(job, { segment: 1, completedFrames: 124 }), snapshot(job, { segment: 2, completedFrames: 124, node: '20', value: null, max: null }), snapshot(job, { segment: 2, completedFrames: 124, node: '43', value: 0, max: 5 }));
    for (const current of snapshots) { const next = retainOverallProgress(high, current); expect(next).toBeGreaterThanOrEqual(high); expect(next).toBeLessThan(100); high = next; }
    const unknown = snapshot(job, { node: null, stage: 'Waiting for GPU', value: null, max: null });
    expect(retainOverallProgress(high, unknown)).toBe(high);
    expect(retainOverallProgress(high, { ...unknown, status: 'reconnecting' })).toBe(high);
    expect(retainOverallProgress(high, { ...unknown, status: 'interrupted' })).toBe(high);
  });
  it('counts the image identity-first pass before its later outfit and lighting passes', () => {
    const job: Job = { ...video(), mediaType: 'image', image: { settings: { ...imageDefaults, model: 'qwen21', qwenRecipe: 'identity-first', qwenRelight: true }, faceId: null, maskId: null, geometry: { width: 704, height: 1248, contentWidth: 704, contentHeight: 1248, x: 0, y: 0, outputWidth: 704, outputHeight: 1248 } } };
    const face = overallProgressEstimate(snapshot(job, { node: '218', value: 20, max: 20 }));
    const outfit = overallProgressEstimate(snapshot(job, { node: '118', value: 25, max: 25 }));
    const lighting = overallProgressEstimate(snapshot(job, { node: '318', value: 25, max: 25 }));
    expect(face).toBeLessThan(outfit); expect(outfit).toBeLessThan(lighting); expect(lighting).toBeLessThan(100);
  });
  it('keeps the stage bar out of the simple view and renders technical details as an inline view', () => {
    const job = snapshot(video(), { stage: 'Downloading completed segment', node: null, unit: 'bytes', value: 8 * 1048576, max: 32 * 1048576 });
    const html = renderToStaticMarkup(<GenerationProgress job={job} kind="video" online onCancel={() => undefined} onResume={() => undefined} />);
    expect(html).toContain('Overall generation progress'); expect(html).toContain('View render details');
    expect(html).not.toContain('generation-stage-track'); expect(html).not.toContain('role="dialog"'); expect(html).not.toContain('Frames saved locally');
    const details = renderToStaticMarkup(<RenderProgressInsights job={job} kind="video" elapsed={65} />);
    expect(details).toContain('generation-stage-track'); expect(details).toContain('8.0 / 32.0 MB'); expect(details).toContain('1:05'); expect(details).not.toContain('role="dialog"');
    expect(nativeProgress(snapshot(job, { value: NaN, max: 100 }))).toBeNull();
  });
});
