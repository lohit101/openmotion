import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';

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
    for (const route of ['/api/jobs', '/api/images/jobs', '/api/jobs/example/resume', '/api/jobs/example/refine-face', '/api/models/download', '/api/models/delete', '/api/video-identity/gpu/setup', '/api/connection/connect', '/api/cloud/instances/777/start']) {
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
});
