import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';
import { defaults, type Job } from '../shared/types';
import type { CloudLaunch } from '../shared/cloud';

describe('idle pause settings and workload gate', () => {
  let application: Awaited<ReturnType<typeof createApplication>>, root = '';
  afterEach(async () => { application?.idle.dispose(); application?.cloud.dispose(); application?.store.close(); if (root) await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
  async function fixture() { root = await mkdtemp(path.join(os.tmpdir(), 'recast-idle-api-')); application = await createApplication({ dataRoot: root, seed: false }); return application; }
  it('enables five-minute auto-pause by default and saves an explicit off preference without touching compute', async () => {
    const { app, store, idle } = await fixture();
    const initial = await request(app).get('/api/bootstrap'); expect(initial.body.cloud.idle).toMatchObject({ enabled: true, timeoutSeconds: 300 });
    await request(app).post('/api/cloud/idle').send({ enabled: false }).expect(200);
    expect(store.value('gpu-idle-auto-pause', true)).toBe(false); expect(idle.state.enabled).toBe(false);
    await request(app).post('/api/cloud/idle').send({ enabled: 'yes' }).expect(422);
    expect(idle.state.enabled).toBe(false);
  });
  it('blocks new GPU work during automatic pause while leaving drafts and manual stop controls reachable', async () => {
    const { app, idle, cloud } = await fixture(); idle.state.status = 'pausing';
    for (const route of ['/api/jobs', '/api/jobs/example/resume', '/api/models/download', '/api/models/delete', '/api/connection/connect', '/api/cloud/instances/777/start']) {
      const response = await request(app).post(route).send({}); expect(response.status).toBe(409); expect(response.body.error).toContain('idle pause');
    }
    const draft = await request(app).post('/api/draft').send({}); expect(draft.status).toBe(422);
    // The manual stop route is not swallowed by the idle gate. A non-existent
    // launch is rejected by its normal handler, without a real provider call.
    vi.spyOn(cloud, 'refresh').mockResolvedValue(cloud.state);
    const stopped = await request(app).post('/api/cloud/instances/777/stop').send({}); expect(stopped.status).toBe(400); expect(stopped.body.error).toContain('outside Recast');
    const status = await request(app).get('/api/cloud'); expect(status.status).toBe(200);
    await request(app).post('/api/cloud/idle').send({ enabled: false }).expect(200);
  });
  it('never arms the idle timer during video or photo generation, saving, or queued work', async () => {
    const { idle, store, cloud, connection, runner, models } = await fixture();
    store.set('cloud-connected-instance', 777); cloud.state.configured = true;
    cloud.state.launches.push({ instanceId: 777, phase: 'ready', safetyStatus: 'armed' } as CloudLaunch);
    connection.status.state = 'online'; connection.status.endpoint = 'http://127.0.0.1:8188';
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const job: Job = { id: 'test-job', status: 'running', title: 'Fixture', sourceId: '', referenceId: '', settings: defaults, createdAt: new Date().toISOString(), favorite: false, deleted: false,
      width: 704, height: 1248, progress: { stage: 'Saving output', node: null, value: null, max: null, unit: 'bytes', segment: 1, segments: 1, completedFrames: 0, targetFrames: 120, updatedAt: Date.now() },
      segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
    store.addJob(job);
    for (const mediaType of [undefined, 'image'] as const) for (const status of ['queued', 'running', 'reconnecting'] as const) {
      job.mediaType = mediaType; job.status = status; store.saveJob(job); await idle.tick();
      expect(idle.state.status).toBe('busy'); expect(idle.state.pauseAt).toBeNull(); expect(idle.state.idleSince).toBeNull();
    }
    job.status = 'completed'; store.saveJob(job); runner.busy = true; await idle.tick(); expect(idle.state.status).toBe('busy');
    runner.busy = false; models.state.busy = true; await idle.tick(); expect(idle.state.status).toBe('busy');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
