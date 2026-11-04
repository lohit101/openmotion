import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createKieApplication } from '../server/kie-index';
import type { KieClientLike } from '../server/kie-jobs';

it('rejects foreign matching Host/Origin before provider activity while preserving the local dev proxy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kie-host-test-')); let credits = 0;
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected provider activity'); };
  const apiClient: KieClientLike = { getCredits: async () => { credits++; return 100; }, uploadFile: unexpected, createTask: unexpected, getTask: unexpected, downloadResult: unexpected };
  const app = await createKieApplication({ dataRoot: root, apiClient });
  try {
    await request(app.app).post('/api/kie/account').set('Host', 'attacker.example:3001').set('Origin', 'http://attacker.example:3001').set('sec-fetch-site', 'same-origin').send({ apiKey: 'fixture-kie-key-host-test' }).expect(403);
    for (const host of ['attacker.example:3001', 'localhost:3001/path', 'user@localhost:3001', 'localhost:3001?query=1']) await request(app.app).get('/api/bootstrap').set('Host', host).expect(403);
    expect(credits).toBe(0);
    await request(app.app).get('/api/bootstrap').set('Host', '[::1]:3001').expect(200);
    await request(app.app).post('/api/kie/account').set('Host', 'localhost:5174').set('Origin', 'http://localhost:5174').send({ apiKey: 'fixture-kie-key-host-test' }).expect(200);
    expect(credits).toBe(1);
  } finally { await app.shutdown(); await rm(root, { recursive: true, force: true }); }
});
