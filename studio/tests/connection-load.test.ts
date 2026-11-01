import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import { Store } from '../server/store';
import { openEventStream } from '../server/event-stream';
import { UpscaleManager } from '../server/upscale';
import { Runner } from '../server/runner';
import { defaults, type Job } from '../shared/types';
import type { ConnectionManager } from '../server/comfy';
import type { ClipEditor } from '../server/clip-editor';

const job = (id: string, status: Job['status'] = 'completed'): Job => ({
  id, status, title: id, createdAt: new Date().toISOString(), sourceId: '', referenceId: '',
  origin: 'render', settings: { ...defaults }, favorite: false, deleted: false, width: 480, height: 800,
  progress: { stage: 'Complete', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 120, targetFrames: 120, updatedAt: 0 },
  segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null,
  cancelRequested: false, workflow: null, elapsedSeconds: 0,
});
class Client extends EventEmitter {
  writes: string[] = []; blocked = false; destroyed = false;
  write(value: string) { this.writes.push(value); return !this.blocked; }
  destroy() { this.destroyed = true; this.emit('close'); }
  response() { return this as unknown as Response; }
}

describe('GPU connection load and slow browser protection', () => {
  let root = '', store: Store | undefined;
  const streams: (() => void)[] = [];
  afterEach(async () => { streams.splice(0).forEach(close => close()); vi.restoreAllMocks(); store?.close(); store = undefined; if (root) await rm(root, { recursive: true, force: true }); });
  async function fixture() { root = await mkdtemp(path.join(os.tmpdir(), 'recast-connection-load-')); store = new Store(root); return store; }

  it('reads only unsettled jobs, including remote interruptions, and updates immediately on save', async () => {
    const s = await fixture();
    for (let i = 0; i < 400; i++) s.addJob(job(`paid-${i}`));
    const running = job('running', 'running'), queued = job('queued', 'queued'), recovering = job('recovering', 'reconnecting');
    const face = { ...job('face', 'interrupted'), facialConsistency: { remoteActive: true, instanceId: 777 } } as Job;
    const scale = { ...job('scale', 'failed'), upscale: { remoteActive: true, instanceId: 777 } } as Job;
    const swap = { ...job('swap', 'interrupted'), faceRefinement: { execution: 'remote CUDA' } } as Job;
    const cpu = { ...job('cpu', 'interrupted'), faceRefinement: { execution: 'local CPU' } } as Job;
    for (const row of [running, queued, recovering, face, scale, swap, cpu]) s.addJob(row);
    const parse = vi.spyOn(JSON, 'parse');
    expect(s.unsettledJobs().map(j => j.id).sort()).toEqual(['face', 'queued', 'recovering', 'running', 'scale', 'swap']);
    expect(parse).toHaveBeenCalledTimes(6); parse.mockRestore();
    running.status = 'completed'; s.saveJob(running);
    face.facialConsistency!.remoteActive = false; s.saveJob(face);
    scale.upscale!.remoteActive = false; s.saveJob(scale);
    swap.cancellationConfirmed = true; s.saveJob(swap, false);
    expect(s.unsettledJobs().map(j => j.id).sort()).toEqual(['queued', 'recovering']);
    const sql = (s.db.prepare("SELECT sql FROM sqlite_master WHERE name='jobs_unsettled_v1'").get() as { sql: string }).sql;
    const plan = s.db.prepare('EXPLAIN QUERY PLAN SELECT data FROM jobs WHERE ' + sql.split(' WHERE ')[1]).all();
    expect(JSON.stringify(plan)).toContain('USING INDEX jobs_unsettled_v1');
  });

  it('keeps confirmed-stop and unknown remote-work guards without decoding completed Library jobs', async () => {
    const s = await fixture(), conn = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188' } } as ConnectionManager;
    const scale = { ...job('scale', 'interrupted'), upscale: { remoteActive: true, instanceId: 777 } } as Job;
    const face = { ...job('face', 'interrupted'), facialConsistency: { remoteActive: true, instanceId: 777 } } as Job;
    s.set('cloud-connected-instance', 777); s.addJob(scale); s.addJob(face);
    const upscale = new UpscaleManager(s, root, conn, {} as ClipEditor, () => {});
    const runner = new Runner(s, conn, {}, root);
    vi.spyOn(s, 'jobs').mockImplementation(() => { throw new Error('A safety check scanned the whole Library.'); });
    expect(upscale.busy).toBe(true); expect(runner.hasUnconfirmedFaceWork()).toBe(true);
    upscale.observeProviderStop(777, Date.parse(scale.createdAt) - 1); expect(upscale.busy).toBe(true);
    upscale.observeProviderStop(778, Date.now()); expect(upscale.busy).toBe(true);
    upscale.observeProviderStop(777, Date.now()); expect(upscale.busy).toBe(false);
    expect(s.job('scale')!.upscale!.cancellationConfirmed).toBe(true);
    expect(runner.hasUnconfirmedFaceWork()).toBe(true);
  });

  it('coalesces thousands of updates while a tab is blocked and delivers final states after drain', async () => {
    const s = await fixture(), client = new Client(); client.blocked = true;
    streams.push(openEventStream(s, client.response(), { jobs: [] }));
    for (let i = 0; i < 10000; i++) {
      s.emit('event', { type: 'cloud', data: { revision: i, phase: 'installing' } });
      s.emit('event', { type: 'job', data: { id: 'video', status: 'running', progress: i } });
    }
    s.emit('event', { type: 'job', data: { id: 'video', status: 'completed' } });
    s.emit('event', { type: 'job', data: { id: 'photo', status: 'failed', error: 'Example error' } });
    s.emit('event', { type: 'models', data: { busy: false } });
    expect(client.writes).toHaveLength(1); expect(client.destroyed).toBe(false);
    client.blocked = false; client.emit('drain');
    const events = client.writes.slice(1).map(line => JSON.parse(line.slice(6)));
    expect(events).toHaveLength(4);
    expect(events.find(e => e.type === 'cloud').data.revision).toBe(9999);
    expect(events.find(e => e.data.id === 'video').data.status).toBe('completed');
    expect(events.find(e => e.data.id === 'photo').data.error).toBe('Example error');
    client.emit('close'); expect(s.listenerCount('event')).toBe(0);
    s.emit('event', { type: 'cloud', data: {} }); expect(client.writes).toHaveLength(5);
  });

  it('respects repeated backpressure and bounds distinct pending items with a clean reconnect', async () => {
    const s = await fixture(), client = new Client(); client.blocked = true;
    streams.push(openEventStream(s, client.response(), {}));
    s.emit('event', { type: 'job', data: { id: 'one' } }); s.emit('event', { type: 'job', data: { id: 'two' } });
    client.emit('drain'); expect(client.writes).toHaveLength(2);
    client.blocked = false; client.emit('drain'); expect(client.writes).toHaveLength(3);
    client.blocked = true; s.emit('event', { type: 'cloud', data: {} });
    for (let i = 0; i < 257; i++) s.emit('event', { type: 'job', data: { id: `pending-${i}` } });
    expect(client.destroyed).toBe(true); expect(s.listenerCount('event')).toBe(0);
  });
});
