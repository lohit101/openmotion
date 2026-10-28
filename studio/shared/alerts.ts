import { z } from 'zod';
import type { Bootstrap, Connection, Job } from './types';
import type { ModelsState } from './models';
import { modelDefinitions } from './models';
import type { LocalExport } from './clip-editor';
import { setupNotice } from './cloud-status';

export const alertCategories = ['connection', 'models', 'generation', 'exports'] as const;
export type AlertCategory = typeof alertCategories[number];
const events = z.object({ connection: z.boolean().default(true), models: z.boolean().default(true), generation: z.boolean().default(true), exports: z.boolean().default(true) });
export const alertPreferencesSchema = z.object({
  sounds: z.boolean().default(true), desktop: z.boolean().default(false), volume: z.number().min(0).max(1).default(.5),
  events: events.default({ connection: true, models: true, generation: true, exports: true }),
});
export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;
export function readAlertPreferences(value: unknown): AlertPreferences { const parsed = alertPreferencesSchema.safeParse(value); return parsed.success ? parsed.data : alertPreferencesSchema.parse({}); }
export interface AlertTarget { view: 'gpu' | 'create' | 'image' | 'editor' | 'downloads' | 'alerts'; jobId?: string; }
export interface ActivityAlert {
  id: string; category: AlertCategory; tone: 'success' | 'warning' | 'error'; title: string; body: string;
  detail?: string; target: AlertTarget; toast?: boolean;
}
type Snapshot = Pick<Bootstrap, 'connection' | 'jobs' | 'models' | 'cloud'>;
const pending = (status: string) => ['queued', 'downloading'].includes(status);
const label = (id: string) => modelDefinitions.find(file => file.id === id)?.label || 'Model file';

/** Observes transitions, not inventory presence. Startup history is a baseline. */
export class ActivityAlertTracker {
  private initialized = false;
  private connection: Connection | null = null;
  private settledConnection: 'online' | 'offline' | null = null;
  private jobs = new Map<string, { status: Job['status']; output: boolean }>();
  private scope = '';
  private batch: { id: string; files: Set<string>; failed: Set<string> } | null = null;
  private setup = new Map<string, string | null>();
  private exportStates = new Map<string, LocalExport['status']>();
  private exportsInitialized = false;
  constructor(private startedAt = Date.now()) {}

  collect(snapshot: Snapshot): ActivityAlert[] {
    const alerts: ActivityAlert[] = [], { connection, cloud } = snapshot;
    const before = this.connection;
    if (this.initialized && before && (before.state !== connection.state || before.endpoint !== connection.endpoint || (connection.state === 'online' && before.gpu !== connection.gpu))) {
      const id = `connection:${connection.endpoint}:${connection.checkedAt}:${connection.state}:${connection.message}`;
      if (connection.state === 'online') alerts.push({ id, category: 'connection', tone: 'success', title: 'GPU connected', body: `${connection.gpu || 'Your GPU'} is connected to Recast.`, target: { view: 'gpu' } });
      else if (connection.state === 'offline' && before.state !== 'offline') alerts.push({ id, category: 'connection', tone: this.settledConnection === 'online' ? 'warning' : 'error', title: this.settledConnection === 'online' ? 'GPU disconnected' : 'GPU connection failed', body: 'Open GPU cloud to check the connection. Your saved media is kept.', detail: connection.message, target: { view: 'gpu' } });
    }
    if (connection.state !== 'connecting') this.settledConnection = connection.state;
    this.connection = { ...connection };
    for (const job of snapshot.jobs) {
      const old = this.jobs.get(job.id), changed = old?.status !== job.status;
      const recent = old || Date.parse(job.createdAt) >= this.startedAt;
      if (this.initialized && recent && !job.deleted && (job.origin === 'render' || !!job.faceRefinement)) {
        const base = { id: `generation:${job.id}:${job.status}:${job.finishedAt || job.progress.updatedAt}`, category: 'generation' as const, target: { view: job.mediaType === 'image' ? 'image' as const : 'create' as const, jobId: job.id } };
        if (job.status === 'completed' && job.output && (changed || !old?.output)) alerts.push({ ...base, tone: 'success', title: job.mediaType === 'image' ? 'Your image is ready' : 'Your video is ready', body: 'Saved to your library. Open it to view the result.' });
        else if (changed && ['failed', 'interrupted'].includes(job.status)) alerts.push({ ...base, tone: job.status === 'failed' ? 'error' : 'warning', title: job.status === 'failed' ? 'Generation failed' : 'Generation needs attention', body: 'Open the run to review what happened. Completed files are kept.', detail: job.error || undefined });
      }
      this.jobs.set(job.id, { status: job.status, output: !!job.output });
    }
    const connectedId = cloud.instances.find(instance => instance.connected)?.id;
    const scope = connection.state === 'online' ? `${connection.endpoint}:${connectedId || connection.gpu || ''}` : this.scope;
    if (scope !== this.scope) { this.scope = scope; this.batch = null; }
    alerts.push(...this.models(snapshot.models));
    for (const launch of cloud.launches) {
      const notice = setupNotice(launch), key = notice?.key || null, old = this.setup.get(launch.id);
      // Existing setup toasts own their in-app presentation. Add attention cues once per attempt.
      if (this.initialized && old !== undefined && old !== key && notice && notice.tone !== 'success') {
        alerts.push({ id: `setup:${key}`, category: 'connection', tone: notice.tone, title: notice.title, body: 'GPU setup needs attention. Open GPU cloud for details.', detail: notice.message, target: { view: 'gpu' }, toast: false });
      }
      this.setup.set(launch.id, key);
    }
    this.initialized = true;
    return alerts;
  }

  private models(state: ModelsState): ActivityAlert[] {
    const alerts: ActivityAlert[] = [], active = state.files.filter(file => pending(file.status));
    if (active.length && !this.batch) this.batch = { id: `${this.scope}:${state.checkedAt || this.connection?.checkedAt || 'transfer'}:${active.map(file => file.id).sort().join('|')}`, files: new Set(), failed: new Set() };
    if (!this.batch) return alerts;
    for (const file of active) { this.batch.files.add(file.id); this.batch.failed.delete(file.id); }
    for (const file of state.files) if (file.status === 'installed') this.batch.failed.delete(file.id);
    const failures = state.files.filter(file => this.batch!.files.has(file.id) && file.status === 'failed' && !this.batch!.failed.has(file.id));
    if (failures.length) {
      for (const file of failures) this.batch.failed.add(file.id);
      alerts.push({ id: `models:${this.batch.id}:failed:${failures.map(file => file.id).sort().join('|')}`, category: 'models', tone: 'error', title: failures.length === 1 ? `${label(failures[0].id)} download failed` : `${failures.length} model downloads failed`, body: 'Partial files are kept. Open Downloads to review and retry.', detail: failures.map(file => file.error).filter(Boolean).join(' ') || undefined, target: { view: 'downloads' } });
    }
    if (!active.length && !state.busy && !state.refreshing) {
      const installed = state.files.filter(file => this.batch!.files.has(file.id) && file.status === 'installed');
      const incomplete = this.batch.files.size - installed.length;
      if (installed.length) alerts.push({ id: `models:${this.batch.id}:complete`, category: 'models', tone: incomplete ? 'warning' : 'success', title: this.batch.failed.size ? 'Model downloads finished with errors' : incomplete ? 'Downloads stopped' : 'Models downloaded', body: `${installed.length} ${installed.length === 1 ? 'file is' : 'files are'} available on this GPU.${incomplete ? ' Review the remaining files in Downloads.' : ''}`, target: { view: 'downloads' } });
      this.batch = null;
    }
    return alerts;
  }

  collectExports(rows: LocalExport[], explicit = false): ActivityAlert[] {
    const alerts: ActivityAlert[] = [];
    for (const row of rows) {
      const old = this.exportStates.get(row.id), changed = old !== row.status;
      const recent = old || Date.parse(row.createdAt) >= this.startedAt;
      if ((this.exportsInitialized || explicit) && recent && changed) {
        const base = { id: `export:${row.id}:${row.status}`, category: 'exports' as const };
        if (row.status === 'completed' && row.resultJobId) alerts.push({ ...base, tone: 'success', title: 'Your export is ready', body: 'Saved to your library. Open the export to download it.', target: { view: 'create', jobId: row.resultJobId } });
        else if (row.status === 'failed') alerts.push({ ...base, tone: 'error', title: 'Video export failed', body: 'Open the clip editor for details. Your source clips are unchanged.', detail: row.error || undefined, target: { view: 'editor' } });
      }
      this.exportStates.set(row.id, row.status);
    }
    this.exportsInitialized = true;
    return alerts;
  }
}
