import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaults, type Bootstrap, type Job } from '../shared/types';
import { kieDefaults, kiePrompt, kieResolutions, type KiePhase } from '../shared/kie';
import { emptyModels } from '../shared/models';
import { ActivityAlertTracker } from '../shared/alerts';
import { limitedClip, trimLimitedClip } from '../shared/clip-limits';
import { jobDuration, runSummary, savedRunSettings } from '../shared/library';
import { overallProgressEstimate, retainOverallProgress } from '../shared/generation-progress';
import { KieSidebar } from '../src/KieApp';
import KieSettings from '../src/KieSettings';
import KieProgress from '../src/KieProgress';
import LibraryWorkspace from '../src/LibraryWorkspace';
import JobCard from '../src/JobCard';

const limits = { minSeconds: 2, maxSeconds: 15, wholeSeconds: true };
const now = Date.parse('2026-11-04T10:00:00Z');
function job(phase: KiePhase = 'rendering'): Job {
  const draft = { ...kieDefaults, sourceId: 'source', referenceId: 'reference' };
  return {
    id: 'kie-fixture', title: 'Character swap', sourceId: 'source', referenceId: 'reference',
    status: 'running', settings: { ...defaults }, createdAt: new Date(now + 100).toISOString(),
    width: 480, height: 832, favorite: false, deleted: false, segments: [], context: '',
    pendingPrompt: null, uploads: null, output: null, poster: null, error: null,
    cancelRequested: false, elapsedSeconds: null, origin: 'api', workflow: null,
    progress: { stage: 'Creating your video', node: null, value: null, max: null, unit: 'items', segment: 1, segments: 1, completedFrames: 0, targetFrames: 120, updatedAt: now },
    kie: { version: 'kie-wan3-v1', provider: 'kie.ai', model: 'wan/3-0-video', settings: draft,
      prompt: kiePrompt(draft.prompt), phase, submission: 'submitted', taskId: 'existing-task',
      requestFingerprint: 'fixture', sourceAudio: true, warnings: [] },
  };
}
function snapshot(jobs: Job[]): Bootstrap {
  return { jobs, assets: [], draft: { sourceId: null, referenceId: null, settings: defaults },
    connection: { state: 'offline', endpoint: '', gpu: null, message: '', checkedAt: null, loras: [] },
    cloud: { configured: false, instances: [], launches: [], refreshedAt: null, error: null, busy: false }, models: emptyModels(),
    kie: { provider: 'kie.ai', model: 'wan/3-0-video', draft: { ...kieDefaults }, account: { configured: false, keyHint: null, credits: null, checkedAt: null, error: null } },
  };
}

describe('Kie character-swap UI', () => {
  it('defaults to 480p and exposes only the character-swap workspace, videos and settings', () => {
    expect(kieDefaults.resolution).toBe('480P');
    expect(kieResolutions).toEqual(['480P', '720P', '1080P']);
    const html = renderToStaticMarkup(<KieSidebar view="create" select={() => {}} collapsed={false} toggle={() => {}} libraryCount={2} />);
    for (const name of ['Remotion', 'My library', 'Settings']) expect(html).toContain(`aria-label="${name}"`);
    for (const name of ['Imagen', 'Clarity', 'GPU cloud', 'Characters', 'Clip editor']) expect(html).not.toContain(name);
    const library = renderToStaticMarkup(<LibraryWorkspace videosOnly jobs={[]} assets={[]} patch={async () => {}} reuse={() => {}} create={() => {}} openWorkspace={() => {}} />);
    expect(library).toContain('Your videos'); expect(library).not.toContain('Connect your GPU'); expect(library).not.toContain('>Images<');
  });

  it('offers a password-only key entry and API connection settings without GPU/model controls', () => {
    const account = { configured: true, keyHint: '••••abcd', credits: 140, checkedAt: null, error: null };
    const html = renderToStaticMarkup(<KieSettings account={account} changed={() => {}} tab="account" setTab={() => {}} />);
    expect(html).toContain('type="password"'); expect(html).toContain('autoComplete="off"');
    expect(html).toContain('value=""'); expect(html).toContain('••••abcd'); expect(html).toContain('140');
    for (const name of ['Model downloads', 'SSH key', 'Vast API', 'GPU cloud']) expect(html).not.toContain(name);
  });

  it('shows a single overall loader, with stage bars and task details kept out of its simple view', () => {
    const value = job(); value.progress = { ...value.progress, value: 45, max: 100, unit: 'items' };
    const html = renderToStaticMarkup(<KieProgress job={value} />);
    expect(html).toContain('Overall generation progress'); expect(html).toContain('View generation details');
    expect(html).not.toContain('generation-stage-track'); expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('existing-task'); expect(html).not.toContain('GPU');
    expect(html).toContain('Stop watching'); expect(html).toContain('using credits');
  });

  it('recovers an ambiguous submission through a matching existing task instead of offering another generation', () => {
    const value = job('attention'); value.status = 'interrupted'; value.kie!.submission = 'unknown'; delete value.kie!.taskId;
    const html = renderToStaticMarkup(<KieProgress job={value} />);
    expect(html).toContain('Existing Kie task ID'); expect(html).toContain('Recover this task');
    expect(html).toContain('will not submit this request again automatically'); expect(html).not.toContain('>Generate<');
  });

  it('does not show playable completed cards until a local output is saved', () => {
    const value = { ...job('complete'), status: 'completed' as const };
    const render = (row: Job) => renderToStaticMarkup(<JobCard job={row} onSelect={() => {}} onPatch={() => {}} onReuse={() => {}} />);
    expect(render(value)).not.toContain('<video');
    expect(render({ ...value, output: 'output.mp4' })).toContain('<video');
  });
});

describe('Kie clip-range constraints', () => {
  it('selects only 2–15 complete seconds and retains frame-precise starts', () => {
    expect(limitedClip({ start: 2.333, seconds: 5.4 }, 30, 24, limits)).toEqual({ start: 56 / 24, seconds: 5 });
    expect(limitedClip({ start: 0, seconds: 18 }, 30, 24, limits)).toEqual({ start: 0, seconds: 15 });
    expect(limitedClip({ start: 0, seconds: .1 }, 30, 24, limits)).toEqual({ start: 0, seconds: 2 });
    expect(limitedClip({ start: 0, seconds: 5 }, 4.9, 24, limits)).toEqual({ start: 0, seconds: 4 });
    expect(limitedClip({ start: 0, seconds: 5 }, 1.99, 24, limits)).toBeNull();
    expect(limitedClip({ start: NaN, seconds: 5 }, 10, 24, limits)).toBeNull();
  });

  it('allows moving a previously trimmed selection back to zero and to the available end', () => {
    const initial = { start: 4.25, seconds: 5 };
    const zero = trimLimitedClip(initial, 'move', -3, 12.25, 24, limits);
    expect(zero).toEqual({ start: 0, seconds: 5 });
    expect(trimLimitedClip(zero, 'move', 100, 12.25, 24, limits)).toEqual({ start: 7.25, seconds: 5 });
    expect(trimLimitedClip(initial, 'start', -3, 12.25, 24, limits).start).toBe(0);
  });

  it('snaps duration while preserving the opposite edge and immediate reversal', () => {
    const initial = { start: 1.25, seconds: 5 };
    const forward = trimLimitedClip(initial, 'start', 2.4, 20, 24, limits);
    expect(forward).toEqual({ start: 2.25, seconds: 4 });
    expect(forward.start + forward.seconds).toBe(6.25);
    expect(trimLimitedClip(forward, 'start', 1.25, 20, 24, limits)).toEqual(initial);
    expect(trimLimitedClip(initial, 'end', 4.8, 20, 24, limits)).toEqual({ start: 1.25, seconds: 4 });
  });

  it('keeps all extreme trim gestures within source and provider limits', () => {
    for (const duration of [2, 2.1, 4.75, 15, 16.1, 100]) for (const action of ['start', 'end', 'move'] as const) for (const point of [-100, 0, .125, 2, 3.6, 15.5, 1000]) {
      const result = trimLimitedClip({ start: .25, seconds: 5 }, action, point, duration, 24, limits);
      expect(result.start).toBeGreaterThanOrEqual(0); expect(result.seconds).toBeGreaterThanOrEqual(2);
      expect(result.seconds).toBeLessThanOrEqual(15); expect(Number.isInteger(result.seconds)).toBe(true);
      expect(result.start + result.seconds).toBeLessThanOrEqual(Math.floor(duration * 24 + 1e-7) / 24 + 1e-12);
    }
  });
});

describe('Kie lifecycle and saved metadata', () => {
  it('uses earned milestones, holds on unknown provider progress and saves 100 for local completion', () => {
    const value = job('preparing'); expect(overallProgressEstimate({ ...value, status: 'queued' })).toBe(0);
    let high = 0;
    const phases: KiePhase[] = ['preparing', 'uploading', 'submitting', 'waiting', 'rendering', 'downloading', 'saving', 'complete'];
    for (const phase of phases) {
      value.kie!.phase = phase; const next = retainOverallProgress(high, value);
      expect(next).toBeGreaterThanOrEqual(high); expect(next).toBeLessThan(100); high = next;
    }
    value.kie!.phase = 'waiting'; expect(retainOverallProgress(high, value)).toBe(high);
    expect(retainOverallProgress(high, { ...value, status: 'reconnecting' })).toBe(high);
    expect(overallProgressEstimate({ ...value, status: 'completed' })).toBeLessThan(100);
    expect(retainOverallProgress(high, { ...value, status: 'completed', output: 'saved.mp4' })).toBe(100);
    value.kie!.phase = 'rendering'; value.progress.value = 50; value.progress.max = 100;
    expect(overallProgressEstimate(value)).toBe(54);
  });

  it('reports actual duration and fractional FPS, and never labels API jobs as Viggle graphs', () => {
    const value = job('complete'); value.status = 'completed'; value.output = 'saved.mp4';
    value.kie!.settings.keepSourceAudio = false;
    value.kie!.output = { width: 1080, height: 1920, fps: 29.97, duration: 4.972, frames: 149, sha256: 'fixture', audio: 'generated', warnings: [] };
    expect(jobDuration(value)).toBe(4.972);
    const summary = Object.fromEntries(runSummary(value));
    expect(summary['Frame rate']).toBe('29.97 fps'); expect(summary.Duration).toBe('4.97s'); expect(summary.Audio).toBe('Wan-generated audio');
    const settings = savedRunSettings(value); expect(settings.model).toBe('wan/3-0-video'); expect(settings).not.toHaveProperty('viggleQuality');
    value.kie!.output.audio = 'none'; expect(Object.fromEntries(runSummary(value)).Audio).toBe('No audio track');
  });

  it('notifies API generations exactly once only when the downloaded video is ready', () => {
    const tracker = new ActivityAlertTracker(now), value = job(); tracker.collect(snapshot([value]));
    expect(tracker.collect(snapshot([{ ...value, status: 'completed' }]))).toEqual([]);
    const completed = snapshot([{ ...value, status: 'completed', output: 'saved.mp4' }]);
    expect(tracker.collect(completed).map(alert => [alert.category, alert.title, alert.target.view])).toEqual([['generation', 'Your video is ready', 'create']]);
    expect(tracker.collect(completed)).toEqual([]);
  });
});
