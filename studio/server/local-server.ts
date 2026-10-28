import { createServer, type RequestListener } from 'node:http';

/** Reserve the loopback port before opening any database or recovering jobs. */
export async function startLocalServer<T extends { app: RequestListener }>(factory: () => Promise<T>, port: number) {
  let application: RequestListener | null = null;
  const server = createServer((request, response) => {
    if (application) { application(request, response); return; }
    response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify({ error: 'Recast is starting. Retry in a moment.' }));
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => { server.off('error', failed); resolve(); });
  });
  try { const state = await factory(); application = state.app; return { ...state, server }; }
  catch (error) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
}
