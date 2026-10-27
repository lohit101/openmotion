import { describe, expect, it } from 'vitest';
import express from 'express';
import { startLocalServer } from '../server/local-server';

describe('local server startup ownership', () => {
  it('rejects a second start before its database/job factory can run', async () => {
    const app = express(); app.get('/health', (_request, response) => response.json({ healthy: true }));
    const owner = await startLocalServer(async () => ({ app }), 0);
    const port = (owner.server.address() as { port: number }).port;
    let openedData = false;
    try {
      await expect(startLocalServer(async () => { openedData = true; return { app: express() }; }, port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(openedData).toBe(false);
      expect(await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json())).toEqual({ healthy: true });
    } finally { owner.server.closeAllConnections(); await new Promise<void>(resolve => owner.server.close(() => resolve())); }
  });
  it('releases the reserved port when initialization fails', async () => {
    const first = await startLocalServer(async () => ({ app: express() }), 0), port = (first.server.address() as { port: number }).port;
    await new Promise<void>(resolve => first.server.close(() => resolve()));
    await expect(startLocalServer(async () => { throw new Error('Fixture initialization failure'); }, port)).rejects.toThrow('Fixture initialization failure');
    const recovered = await startLocalServer(async () => ({ app: express() }), port);
    await new Promise<void>(resolve => recovered.server.close(() => resolve()));
  });
});
