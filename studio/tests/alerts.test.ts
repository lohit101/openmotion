import { describe, expect, it } from 'vitest';
import { ActivityAlertTracker, readAlertPreferences } from '../shared/alerts';
import type { Bootstrap, Job } from '../shared/types';
import { defaults } from '../shared/types';
import { emptyModels, type ModelsState, type ModelFileState } from '../shared/models';
import type { LocalExport } from '../shared/clip-editor';

const now = Date.parse('2026-10-28T02:00:00Z');
function job(id: string, status: Job['status'], extra: Partial<Job> = {}): Job {
  return { id, status, title: 'Private user title', sourceId: '', referenceId: '', settings: defaults, createdAt: new Date(now + 100).toISOString(), favorite: false, deleted: false, width: 704, height: 1248, progress: { stage: '', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: 0, targetFrames: 120, updatedAt: now }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null, ...extra };
}
function snapshot(jobs: Job[] = [], models: ModelsState = emptyModels()): Bootstrap {
  return { jobs, assets: [], draft: { sourceId: null, referenceId: null, settings: defaults }, connection: { state: 'online', endpoint: 'http://127.0.0.1:8188', gpu: 'GPU fixture', message: 'Ready', checkedAt: new Date(now).toISOString(), loras: [] }, cloud: { configured: false, instances: [], launches: [], refreshedAt: null, error: null, busy: false }, models };
}
const file = (id: string, status: ModelFileState['status']): ModelFileState => ({ id, status, message: '', percent: null, error: status === 'failed' ? 'Fixture checksum error' : null });
const models = (files: ModelFileState[], busy = false): ModelsState => ({ ...emptyModels(), files, busy, checkedAt: new Date(now).toISOString() });
const exported = (status: LocalExport['status'], id = 'export'): LocalExport => ({ id, status, title: 'Local edit', stage: '', percent: status === 'completed' ? 100 : 0, error: status === 'failed' ? 'Fixture error' : null, resultJobId: status === 'completed' ? 'export-job' : null, mode: 'lossless', createdAt: new Date(now + 100).toISOString() });

describe('activity alert transitions', () => {
  it('delivers one idle-pause alert only after confirmation, and a distinct error for an unconfirmed stop', () => {
    const tracker = new ActivityAlertTracker(now), data = snapshot(); tracker.collect(data);
    data.cloud.idle = { enabled: true, timeoutSeconds: 300, instanceId: 777, idleSince: null, pauseAt: null, status: 'pausing', message: '', lastPause: { id: 'idle-event', instanceId: 777, requestedAt: new Date(now).toISOString() } };
    data.connection.state = 'offline'; expect(tracker.collect(data)).toEqual([]);
    data.cloud.idle.status = 'error'; data.cloud.idle.lastPause!.error = 'Not confirmed';
    expect(tracker.collect(data).map(alert => [alert.title, alert.tone])).toEqual([['GPU pause not confirmed', 'error']]);
    expect(tracker.collect(data)).toEqual([]);
    data.cloud.idle.status = 'paused'; data.cloud.idle.lastPause!.confirmedAt = new Date(now + 5000).toISOString();
    const done = tracker.collect(data); expect(done.map(alert => [alert.title, alert.tone])).toEqual([['GPU automatically paused', 'success']]);
    expect(done[0].body).toContain('storage'); expect(tracker.collect(data)).toEqual([]);
    const reopened = new ActivityAlertTracker(now + 6000); expect(reopened.collect(data)).toEqual([]);
  });
  it('seeds existing history/inventories silently and ignores unchanged refreshes or metadata edits', () => {
    const tracker = new ActivityAlertTracker(now), data = snapshot([job('done', 'completed', { output: 'ready' }), job('failed', 'failed')], models([file('already-installed', 'installed')]));
    expect(tracker.collect(data)).toEqual([]); expect(tracker.collect(data)).toEqual([]);
    expect(tracker.collect({ ...data, jobs: data.jobs.map(row => ({ ...row, favorite: true })) })).toEqual([]);
    expect(tracker.collectExports([exported('completed')])).toEqual([]); expect(tracker.collectExports([exported('completed')])).toEqual([]);
  });
  it('waits for a locally playable output, handles photos, and does not replay ready events', () => {
    const tracker = new ActivityAlertTracker(now); tracker.collect(snapshot([job('video', 'running'), job('photo', 'running', { mediaType: 'image' })]));
    expect(tracker.collect(snapshot([job('video', 'completed'), job('photo', 'running', { mediaType: 'image' })]))).toEqual([]);
    const result = snapshot([job('video', 'completed', { output: 'ready' }), job('photo', 'completed', { output: 'ready', mediaType: 'image' })]);
    const alerts = tracker.collect(result); expect(alerts.map(row => row.title)).toEqual(['Your video is ready', 'Your image is ready']);
    expect(alerts.map(row => row.target.view)).toEqual(['create', 'image']); expect(tracker.collect(result)).toEqual([]);
    expect(JSON.stringify(alerts)).not.toContain('Private user title');
  });
  it('reports generation failures/interruption without marking the GPU offline or notifying a cancelled run', () => {
    const tracker = new ActivityAlertTracker(now); tracker.collect(snapshot([job('run', 'running')]));
    const stopped = snapshot([job('run', 'interrupted', { error: 'Output download paused' })]);
    expect(tracker.collect(stopped).map(row => [row.category, row.tone])).toEqual([['generation', 'warning']]); expect(tracker.collect(stopped)).toEqual([]);
    tracker.collect(snapshot([job('run', 'running')]));
    expect(tracker.collect(snapshot([job('run', 'failed')]))[0].title).toBe('Generation failed');
    expect(tracker.collect(snapshot([job('run', 'cancelled')]))).toEqual([]);
  });
  it('follows confirmed connection transitions and distinguishes initial connection failure from disconnection', () => {
    const tracker = new ActivityAlertTracker(now), data = snapshot(); data.connection.state = 'offline'; tracker.collect(data);
    const connecting = { ...data, connection: { ...data.connection, state: 'connecting' as const } };
    expect(tracker.collect(connecting)).toEqual([]); expect(tracker.collect(data)[0].title).toBe('GPU connection failed');
    const connected = snapshot(); expect(tracker.collect(connected)[0].title).toBe('GPU connected'); expect(tracker.collect(connected)).toEqual([]);
    expect(tracker.collect(connecting)).toEqual([]); expect(tracker.collect(data)[0].title).toBe('GPU disconnected'); expect(data.connection.state).toBe('offline');
  });
  it('groups verified download completion and ignores presence-only rescans or a different GPU inventory', () => {
    const tracker = new ActivityAlertTracker(now); tracker.collect(snapshot());
    expect(tracker.collect(snapshot([], models([file('a', 'downloading'), file('b', 'queued')], true)))).toEqual([]);
    expect(tracker.collect(snapshot([], models([file('a', 'installed'), file('b', 'downloading')], true)))).toEqual([]);
    const done = snapshot([], models([file('a', 'installed'), file('b', 'installed')]));
    expect(tracker.collect(done).map(row => row.title)).toEqual(['Models downloaded']); expect(tracker.collect(done)).toEqual([]);
    tracker.collect(snapshot([], models([file('c', 'downloading')], true)));
    const other = snapshot([], models([file('c', 'installed')])); other.connection.gpu = 'Other GPU';
    expect(tracker.collect(other).some(row => row.category === 'models')).toBe(false);
  });
  it('reports failures promptly and never calls cancelled or partially failed downloads ready', () => {
    const tracker = new ActivityAlertTracker(now); tracker.collect(snapshot());
    tracker.collect(snapshot([], models([file('a', 'downloading'), file('b', 'queued')], true)));
    const failure = tracker.collect(snapshot([], models([file('a', 'failed'), file('b', 'downloading')], true)));
    expect(failure).toHaveLength(1); expect(failure[0].tone).toBe('error');
    const finished = tracker.collect(snapshot([], models([file('a', 'failed'), file('b', 'installed')])));
    expect(finished[0].title).toBe('Model downloads finished with errors'); expect(finished[0].tone).toBe('warning');
    tracker.collect(snapshot([], models([file('c', 'downloading'), file('d', 'queued')], true)));
    expect(tracker.collect(snapshot([], models([file('c', 'installed'), file('d', 'missing')])))[0].title).toBe('Downloads stopped');
  });
  it('alerts on local export outcomes even if the editor is no longer mounted, without a duplicate render alert', () => {
    const tracker = new ActivityAlertTracker(now); tracker.collect(snapshot()); tracker.collectExports([]);
    tracker.collectExports([exported('exporting')], true);
    expect(tracker.collect(snapshot([job('export-job', 'completed', { origin: 'edit', output: 'ready' })]))).toEqual([]);
    const ready = tracker.collectExports([exported('completed')]); expect(ready[0].target.jobId).toBe('export-job'); expect(tracker.collectExports([exported('completed')])).toEqual([]);
    tracker.collectExports([exported('queued', 'bad')], true); expect(tracker.collectExports([exported('failed', 'bad')])[0].title).toBe('Video export failed');
  });
  it('accepts safe preferences and recovers invalid or partial saved data', () => {
    expect(readAlertPreferences(null).sounds).toBe(true);
    expect(readAlertPreferences({ volume: 9 }).volume).toBe(.5);
    expect(readAlertPreferences({ sounds: false, events: { models: false } })).toMatchObject({ sounds: false, events: { models: false, generation: true } });
    expect(readAlertPreferences({ desktop: true, volume: 0 })).toMatchObject({ desktop: true, volume: 0 });
  });
});
