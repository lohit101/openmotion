import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Asset, Draft, Job } from '../shared/types';
import { defaults } from '../shared/types';
import { migrateDemoPrompt } from '../shared/prompts';
import { defaultImagePrompt, emptyImageDraft, imageDraftSchema, legacyImagePrompt } from '../shared/image-replacement';
import type { Character } from '../shared/characters';

// Keep safety checks independent of completed Library size. Use the same
// predicate in the partial index and query so SQLite reads only unsettled jobs.
const unsettled = `json_extract(data, '$.status') IN ('queued','running','reconnecting')
  OR json_extract(data, '$.facialConsistency.remoteActive') = 1
  OR json_extract(data, '$.upscale.remoteActive') = 1
  OR (json_extract(data, '$.status') = 'interrupted'
    AND json_extract(data, '$.faceRefinement.execution') = 'remote CUDA'
    AND json_extract(data, '$.cancellationConfirmed') IS NOT 1)`;

export class Store extends EventEmitter {
  db: DatabaseSync;
  constructor(public root: string) {
    super(); mkdirSync(root, { recursive: true });
    for (const folder of ['assets', 'jobs', 'uploads']) mkdirSync(path.join(root, folder), { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, idem TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS jobs_unsettled_v1 ON jobs(id) WHERE ${unsettled}`);
  }
  value<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT data FROM settings WHERE key=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) : fallback; }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value)); }
  assets(): Asset[] { return (this.db.prepare('SELECT data FROM assets').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  asset(id: string): Asset | null { const row = this.db.prepare('SELECT data FROM assets WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  addAsset(asset: Asset) { this.db.prepare('INSERT OR REPLACE INTO assets VALUES (?,?)').run(asset.id, JSON.stringify(asset)); this.emit('event', { type: 'asset', data: { ...asset, path: '', poster: 'ready' } }); }
  characters(): Character[] { return (this.db.prepare('SELECT data FROM characters').all() as { data: string }[]).map(row => JSON.parse(row.data)).sort((a: Character, b: Character) => b.updatedAt.localeCompare(a.updatedAt)); }
  character(id: string): Character | null { const row = this.db.prepare('SELECT data FROM characters WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  saveCharacter(character: Character) { this.db.prepare('INSERT INTO characters VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(character.id, JSON.stringify(character)); this.emit('event', { type: 'character', data: character }); }
  jobs(): Job[] { return (this.db.prepare('SELECT data FROM jobs').all() as { data: string }[]).map(r => JSON.parse(r.data)).sort((a: Job, b: Job) => b.createdAt.localeCompare(a.createdAt)); }
  unsettledJobs(): Job[] { return (this.db.prepare(`SELECT data FROM jobs WHERE ${unsettled}`).all() as { data: string }[]).map(r => JSON.parse(r.data)); }
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
    draft.settings = { ...defaults, ...draft.settings, facialOcclusionTracking: draft.settings.facialOcclusionTracking === true };
    const prompt = migrateDemoPrompt(draft.settings.prompt, draft.settings.mode);
    if (prompt !== draft.settings.prompt) { draft.settings.prompt = prompt; this.set('draft', draft); }
    return draft;
  }
  imageDraft() { const draft = imageDraftSchema.parse(this.value('image-draft', emptyImageDraft())); if (draft.settings.prompt === legacyImagePrompt) draft.settings.prompt = defaultImagePrompt; return draft; }
  close() { this.db.close(); }
}
export function publicJob(job: Job): Job { return { ...job, ...(job.anchorChild?.sharedAnchor ? { anchorChild: { ...job.anchorChild, sharedAnchor: { ...job.anchorChild.sharedAnchor, file: 'ready', proofJSON: '' } } } : {}), hasWorkflow: !!job.workflow, workflow: null, uploads: null, context: '', keyframe: job.keyframe ? 'ready' : undefined, output: job.output ? 'ready' : null, poster: job.poster ? 'ready' : null }; }
