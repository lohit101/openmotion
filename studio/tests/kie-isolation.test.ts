import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createKieApplication } from '../server/kie-index';
import type { KieClientLike } from '../server/kie-jobs';

const folders: string[] = [];
const applications: Awaited<ReturnType<typeof createKieApplication>>[] = [];
async function folder() { const root = await mkdtemp(path.join(os.tmpdir(), 'recast-kie-isolation-')); folders.push(root); return root; }
function client() {
  const unexpected = () => { throw new Error('An external operation was attempted during an offline isolation check.'); };
  return { getCredits: vi.fn(async () => 100), uploadFile: vi.fn(unexpected), createTask: vi.fn(unexpected), getTask: vi.fn(unexpected), downloadResult: vi.fn(unexpected) } satisfies KieClientLike;
}
afterEach(async () => { for (const app of applications.splice(0)) await app.shutdown(); for (const root of folders.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('Kie app isolation from the original GPU installation', () => {
  it('starts with an empty local Library and explicit 480P without any provider call', async () => {
    const api = client(), app = await createKieApplication({ dataRoot: await folder(), apiClient: api }); applications.push(app);
    const response = await request(app.app).get('/api/bootstrap').expect(200);
    expect(response.body.kie).toMatchObject({ provider: 'kie.ai', model: 'wan/3-0-video', draft: { resolution: '480P', seconds: 5, keepSourceAudio: true }, account: { configured: false } });
    expect(response.body.jobs).toEqual([]); expect(response.body.assets).toEqual([]);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
  it('does not register GPU setup, rental, model, image or facial routes', async () => {
    const api = client(), app = await createKieApplication({ dataRoot: await folder(), apiClient: api }); applications.push(app);
    for (const route of ['/api/cloud', '/api/models', '/api/video-identity', '/api/characters']) await request(app.app).get(route).expect(404);
    for (const route of ['/api/cloud/instances/123/start', '/api/cloud/launch', '/api/models/module', '/api/connection/connect', '/api/images/jobs', '/api/facial-consistency/prepare']) await request(app.app).post(route).send({}).expect(404);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
  it('refuses to open an existing unmarked original database', async () => {
    const root = await folder(), original = Buffer.from('original-private-database-must-stay-unchanged');
    await writeFile(path.join(root, 'studio.sqlite'), original);
    await expect(createKieApplication({ dataRoot: root, apiClient: client() })).rejects.toThrow('another Studio installation');
    expect(await readFile(path.join(root, 'studio.sqlite'))).toEqual(original);
  });
  it('checks a key only against the credit endpoint and keeps it out of bootstrap and events', async () => {
    const root = await folder(), api = client(), app = await createKieApplication({ dataRoot: root, apiClient: api }); applications.push(app);
    const events: unknown[] = []; app.store.on('event', value => events.push(value));
    const secret = 'offline-test-credential-1234';
    await request(app.app).post('/api/kie/account').send({ apiKey: secret }).expect(200);
    expect(api.getCredits).toHaveBeenCalledOnce(); expect(api.getCredits).toHaveBeenCalledWith(secret, undefined);
    expect(api.uploadFile).not.toHaveBeenCalled(); expect(api.createTask).not.toHaveBeenCalled();
    const output = await request(app.app).get('/api/bootstrap').expect(200);
    expect(JSON.stringify(output.body)).not.toContain(secret); expect(JSON.stringify(events)).not.toContain(secret);
    const keyFile = path.join(root, 'secrets/kie-api-key.json'); expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(keyFile))).mode & 0o777).toBe(0o700);
  });
  it('rejects cross-site writes before reading a credential or calling Kie', async () => {
    const api = client(), app = await createKieApplication({ dataRoot: await folder(), apiClient: api }); applications.push(app);
    await request(app.app).post('/api/kie/account').set('Origin', 'https://untrusted.example').send({ apiKey: 'offline-test-credential-1234' }).expect(403);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
