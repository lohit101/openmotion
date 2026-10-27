import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { downloadOutput, DownloadError } from '../server/download';

let root: string;
const servers: ReturnType<typeof createServer>[] = [];
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'recast-output-')); });
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await rm(root, { recursive: true, force: true });
});
async function serve(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handle); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/view?filename=anchor.safetensors`;
}
function ranged(req: IncomingMessage, res: ServerResponse, data: Buffer) {
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : data.length - 1;
  res.writeHead(range ? 206 : 200, { 'Content-Length': end - start + 1, ETag: '"immutable-output"', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) });
  res.end(data.subarray(start, end + 1));
}

it('resumes a pre-fix partial anchor after checking its prefix, transferring only the missing tail', async () => {
  const data = Buffer.alloc(256 * 1024, 91), requests: string[] = [], destination = path.join(root, 'anchor.safetensors');
  data.write('saved-five-frame-context'); await writeFile(destination + '.part', data.subarray(0, 100_000));
  const url = await serve((req, res) => { requests.push(req.headers.range || 'full'); ranged(req, res, data); });
  const progress: number[] = [];
  await downloadOutput(url, destination, new AbortController().signal, received => progress.push(received));
  expect(requests).toEqual(['bytes=0-65535', 'bytes=100000-']);
  expect(progress[0]).toBe(100_000); expect(await readFile(destination)).toEqual(data);
  await expect(stat(destination + '.part')).rejects.toThrow();
});

it('continues a healthy streaming download past its timeout interval while bytes keep arriving', async () => {
  const destination = path.join(root, 'slow.bin'), data = Buffer.from('continuity');
  const url = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Length': data.length }); res.flushHeaders(); let i = 0;
    const timer = setInterval(() => { res.write(data.subarray(i, ++i)); if (i === data.length) { clearInterval(timer); res.end(); } }, 20);
    res.on('close', () => clearInterval(timer));
  });
  const start = Date.now();
  await downloadOutput(url, destination, new AbortController().signal, undefined, { idleMs: 90, attempts: 1 });
  expect(Date.now() - start).toBeGreaterThan(90); expect(await readFile(destination)).toEqual(data);
});

it('automatically resumes an interrupted body using Range and If-Range without repeating a render', async () => {
  const data = Buffer.alloc(256 * 1024, 67), requests: IncomingMessage['headers'][] = [], destination = path.join(root, 'retry.bin');
  const url = await serve((req, res) => {
    requests.push(req.headers);
    if (requests.length === 1) {
      res.writeHead(200, { 'Content-Length': data.length, ETag: '"immutable-output"' }); res.write(data.subarray(0, 131072));
      setTimeout(() => res.destroy(), 30);
    } else ranged(req, res, data);
  });
  await downloadOutput(url, destination, new AbortController().signal, undefined, { backoffMs: 1 });
  expect(requests).toHaveLength(2); expect(requests[1].range).toBe('bytes=131072-'); expect(requests[1]['if-range']).toBe('"immutable-output"');
  expect(await readFile(destination)).toEqual(data);
});

it('reports actual inactivity as a transfer error and keeps partial bytes and existing completed media', async () => {
  const destination = path.join(root, 'output.bin'); await writeFile(destination, 'previous-approved-output');
  const url = await serve((_req, res) => { res.writeHead(200, { 'Content-Length': 8192 }); res.write(Buffer.alloc(4096, 10)); });
  await expect(downloadOutput(url, destination, new AbortController().signal, undefined, { idleMs: 50, attempts: 1 })).rejects.toBeInstanceOf(DownloadError);
  expect((await stat(destination + '.part')).size).toBe(4096); expect((await readFile(destination)).toString()).toBe('previous-approved-output');
});

it('preserves user cancellation and does not retry it', async () => {
  const destination = path.join(root, 'cancel.bin'), controller = new AbortController(), reason = new Error('Cancelled by user'); let requests = 0;
  const url = await serve((_req, res) => { requests++; res.writeHead(200, { 'Content-Length': 8192 }); res.write(Buffer.alloc(4096)); setTimeout(() => controller.abort(reason), 30); });
  await expect(downloadOutput(url, destination, controller.signal)).rejects.toBe(reason);
  expect(requests).toBe(1); expect((await stat(destination + '.part')).size).toBe(4096);
});

it('restarts cleanly when If-Range returns a changed full object, without appending stale bytes', async () => {
  const destination = path.join(root, 'changed.bin'), data = Buffer.from('new-output'); let range: string | undefined;
  const url = await serve((req, res) => { range = req.headers.range; res.writeHead(200, { ETag: '"new"', 'Content-Length': data.length }); res.end(data); });
  await writeFile(destination + '.part', 'old-prefix');
  await writeFile(destination + '.part.json', JSON.stringify({ source: url, etag: '"old"', total: 200 }));
  await downloadOutput(url, destination, new AbortController().signal);
  expect(range).toBe('bytes=10-'); expect(await readFile(destination)).toEqual(data);
});

it('refuses inconsistent range offsets without corrupting the partial file', async () => {
  const destination = path.join(root, 'wrong-range.bin');
  const url = await serve((_req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-9/20', 'Content-Length': 10 }); res.end('0123456789'); });
  await writeFile(destination + '.part', 'existing'); await writeFile(destination + '.part.json', JSON.stringify({ source: url }));
  await expect(downloadOutput(url, destination, new AbortController().signal)).rejects.toThrow('inconsistent');
  expect((await readFile(destination + '.part')).toString()).toBe('existing');
});

it('finishes an already complete partial file without downloading it again', async () => {
  const destination = path.join(root, 'complete.bin');
  const url = await serve((_req, res) => { res.writeHead(416, { 'Content-Range': 'bytes */8', ETag: '"same"' }); res.end(); });
  await writeFile(destination + '.part', 'complete'); await writeFile(destination + '.part.json', JSON.stringify({ source: url, etag: '"same"', total: 8 }));
  await downloadOutput(url, destination, new AbortController().signal); expect((await readFile(destination)).toString()).toBe('complete');
});
