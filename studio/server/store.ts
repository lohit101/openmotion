import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Asset, Draft, Job } from '../shared/types';
import { defaults } from '../shared/types';
import { migrateDemoPrompt } from '../shared/prompts';
import { defaultImagePrompt, emptyImageDraft, imageDraftSchema, legacyImagePrompt } from '../shared/image-replacement';

export class Store extends EventEmitter {
  db: DatabaseSync;
  constructor(public root: string) {
    super(); mkdirSync(root, { recursive: true });
    for (const folder of ['assets', 'jobs', 'uploads']) mkdirSync(path.join(root, folder), { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, idem TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  value<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT data FROM settings WHERE key=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) : fallback; }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value)); }
  assets(): Asset[] { return (this.db.prepare('SELECT data FROM assets').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  asset(id: string): Asset | null { const row = this.db.prepare('SELECT data FROM assets WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  addAsset(asset: Asset) { this.db.prepare('INSERT OR REPLACE INTO assets VALUES (?,?)').run(asset.id, JSON.stringify(asset)); this.emit('event', { type: 'asset', data: { ...asset, path: '', poster: 'ready' } }); }
  jobs(): Job[] { return (this.db.prepare('SELECT data FROM jobs').all() as { data: string }[]).map(r => JSON.parse(r.data)).sort((a: Job, b: Job) => b.createdAt.localeCompare(a.createdAt)); }
  job(id: string): Job | null { const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  byKey(key: string): Job | null { const row = this.db.prepare('SELECT data FROM jobs WHERE idem=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  addJob(job: Job, key?: string) { this.db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(job.id, key || null, JSON.stringify(job)); this.emit('event', { type: 'job', data: publicJob(job) }); }
  saveJob(job: Job, preserveUserFields = true) {
    const latest = this.job(job.id);
    if (latest && preserveUserFields) Object.assign(job, { title: latest.title, favorite: latest.favorite, deleted: latest.deleted, cancelRequested: latest.cancelRequested, cancellationConfirmed: latest.cancellationConfirmed });
    this.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
    this.emit('event', { type: 'job', data: publicJob(job) });
  }
  draft(): Draft {
    const draft = this.value<Draft>('draft', { sourceId: null, referenceId: null, settings: defaults });
    draft.settings = { ...defaults, ...draft.settings };
    const prompt = migrateDemoPrompt(draft.settings.prompt, draft.settings.mode);
    if (prompt !== draft.settings.prompt) { draft.settings.prompt = prompt; this.set('draft', draft); }
    return draft;
  }
  imageDraft() { const draft = imageDraftSchema.parse(this.value('image-draft', emptyImageDraft())); if (draft.settings.prompt === legacyImagePrompt) draft.settings.prompt = defaultImagePrompt; return draft; }
  close() { this.db.close(); }
}
export function publicJob(job: Job): Job { return { ...job, workflow: null, uploads: null, context: '', keyframe: job.keyframe ? 'ready' : undefined, output: job.output ? 'ready' : null, poster: job.poster ? 'ready' : null }; }
