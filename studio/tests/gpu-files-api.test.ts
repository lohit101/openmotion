import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';

let folder = '', local: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => { local?.idle.dispose(); local?.models.dispose(); local?.cloud.dispose(); local?.store.close(); if (folder) await rm(folder, { recursive: true, force: true }); });
async function fixture() {
  folder = await mkdtemp(path.join(os.tmpdir(), 'gpu-files-api-'));
  local = await createApplication({ dataRoot: folder, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false } });
  return local;
}
it('requires a live managed rental and rejects unsafe file requests before invoking storage', async () => {
  const f = await fixture();
  const response = await request(f.app).post('/api/gpu-files/list').send({ instanceId: 123, root: 'models', path: '' }).expect(400);
  expect(response.body.error).toContain('Reconnect');
  for (const value of [{ path: '../outside' }, { root: '/etc' }, { instanceId: 0 }]) {
    await request(f.app).post('/api/gpu-files/list').send({ instanceId: 123, root: 'models', path: '', ...value }).expect(422);
  }
  await request(f.app).post('/api/gpu-files/delete').send({ instanceId: 123, root: 'models', path: 'file', token: 'wrong' }).expect(422);
  expect(f.store.jobs()).toEqual([]);
});
it('blocks deletion during setup and idle-pause, without blocking read-only listing', async () => {
  const f = await fixture(), body = { instanceId: 123, root: 'models', path: 'file.bin', token: 'a'.repeat(64) };
  const remove = vi.spyOn(f.models, 'removeGpuFile');
  f.cloud.state.busy = true;
  await request(f.app).post('/api/gpu-files/delete').send(body).expect(409);
  expect(remove).not.toHaveBeenCalled(); f.cloud.state.busy = false; f.idle.state.status = 'pausing';
  const response = await request(f.app).post('/api/gpu-files/delete').send(body).expect(409);
  expect(response.body.error).toContain('idle pause'); expect(remove).not.toHaveBeenCalled();
  const list = vi.spyOn(f.models, 'listGpuFiles').mockResolvedValue({ instanceId: 123, root: 'models', path: '', entries: [], total: 0, nextOffset: null, absolutePath: '/workspace/character-swap/models', checkedAt: new Date().toISOString(), freeBytes: 20, usedBytes: 10, totalBytes: 30 });
  await request(f.app).post('/api/gpu-files/list').send({ instanceId: 123, root: 'models', path: '' }).expect(200);
  expect(list).toHaveBeenCalledOnce();
});
