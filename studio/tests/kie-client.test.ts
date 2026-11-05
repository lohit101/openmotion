import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { KieApiError, KieClient, isPublicAddress, writeAll, type KieHttpRequest, type KieHttpResponse, type KieTransport, type KieVideoInput } from '../server/kie-client';

const key = 'test-secret-private-key-123';
const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
const sleep = async () => undefined;
const input: KieVideoInput = { prompt: 'Replace the person in Video1 with Image1. Preserve source motion.',
  reference_video_urls: ['https://tempfile.redpandaai.co/source.mp4'], reference_image_urls: ['https://tempfile.redpandaai.co/reference.png'],
  resolution: '480P', duration: 5, aspect_ratio: 'adaptive', audio: false };
function response(status: number, value: unknown, headers: Record<string, string> = {}): KieHttpResponse {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return { status, headers, body: (async function* () { yield bytes; })() };
}
async function body(request: KieHttpRequest) {
  if (!request.body) return Buffer.alloc(0);
  if (request.body instanceof Uint8Array) return Buffer.from(request.body);
  const parts = []; for await (const value of request.body) parts.push(Buffer.from(value)); return Buffer.concat(parts);
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'recast-kie-client-'));
  try { await run(directory); } finally { await rm(directory, { force: true, recursive: true }); }
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Kie authenticated API', () => {
  it('does no constructor I/O and checks HTTP-200 application failures without leaking credentials', async () => {
    const transport = vi.fn<KieTransport>(async () => response(200, { code: 401, msg: `Unauthorized Bearer ${key} https://example.com/?key=${key}` }));
    const client = new KieClient({ transport, lookup, sleep }); expect(transport).not.toHaveBeenCalled();
    const error = await client.getCredits(key).catch(error => error);
    expect(error).toMatchObject({ kind: 'rejected', code: 401, submissionUnknown: false });
    expect(error.message).not.toContain(key); expect(error.message).not.toContain('https:');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('retries only idempotent credit/status reads, including HTML 5xx and Retry-After', async () => {
    const waits: number[] = [];
    const transport = vi.fn<KieTransport>().mockResolvedValueOnce(response(502, '<html>bad gateway</html>'))
      .mockResolvedValueOnce(response(429, { code: 429, msg: 'limited' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(200, { code: 200, data: 100.5 }));
    const client = new KieClient({ transport, lookup, sleep: async ms => { waits.push(ms); } });
    expect(await client.getCredits(key)).toBe(100.5); expect(waits).toEqual([500, 2000]);
    for (const [request] of transport.mock.calls) {
      expect(request.url.href).toBe('https://api.kie.ai/api/v1/chat/credit');
      expect(request.headers.Authorization).toBe(`Bearer ${key}`); expect(request.address.address).toBe('8.8.8.8');
    }
  });
  it('sends exactly one paid request with an explicit selected resolution and approved reference fields', async () => {
    const transport = vi.fn<KieTransport>(async request => {
      const payload = JSON.parse((await body(request)).toString());
      expect(payload).toEqual({ model: 'wan/3-0-video', input: { ...input, audio: true, aspect_ratio: '16:9' } });
      expect(request.url.href).toBe('https://api.kie.ai/api/v1/jobs/createTask');
      return response(200, { code: 200, data: { taskId: 'task_wan_12345' } });
    });
    const client = new KieClient({ transport, lookup, sleep });
    expect(await client.createTask(key, { ...input, audio: true, aspect_ratio: '16:9', first_frame_url: 'not sent', nsfw_checker: true } as KieVideoInput)).toEqual({ taskId: 'task_wan_12345' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('keeps character then facial reference ordering in the provider payload', async () => {
    const reference_image_urls = [...input.reference_image_urls, 'https://tempfile.redpandaai.co/face-reference.png'];
    const transport=vi.fn<KieTransport>(async request => {
      expect(JSON.parse((await body(request)).toString()).input.reference_image_urls).toEqual(reference_image_urls);
      return response(200,{code:200,data:{taskId:'two_reference_task'}});
    });
    await new KieClient({transport,lookup,sleep}).createTask(key,{...input,reference_image_urls});
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    ['socket', async () => { throw new Error('socket closed after accepting bytes'); }, 'ambiguous'],
    ['unreadable', async () => response(200, 'broken JSON'), 'ambiguous'],
    ['missing ID', async () => response(200, { code: 200, data: null }), 'ambiguous'],
    ['server error', async () => response(500, { code: 500, msg: 'unavailable' }), 'ambiguous'],
    ['rate limit', async () => response(200, { code: 429, msg: 'limited' }), 'rejected'],
    ['no credits', async () => response(200, { code: 402, msg: 'insufficient' }), 'rejected'],
  ] as const)('never retries a paid POST after %s', async (_label, handler, kind) => {
    const transport = vi.fn<KieTransport>(handler), client = new KieClient({ transport, lookup, sleep });
    const error = await client.createTask(key, input).catch(error => error);
    expect(error).toBeInstanceOf(KieApiError); expect(error.kind).toBe(kind); expect(error.submissionUnknown).toBe(kind === 'ambiguous');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not follow authenticated redirects or send credentials to another host', async () => {
    const transport = vi.fn<KieTransport>(async () => response(302, '', { location: 'https://evil.example/capture' }));
    const client = new KieClient({ transport, lookup, sleep });
    await expect(client.getCredits(key)).rejects.toMatchObject({ kind: 'security' });
    await expect(client.createTask(key, input)).rejects.toMatchObject({ submissionUnknown: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid clip options before submitting paid work', async () => {
    const transport = vi.fn<KieTransport>(); const client = new KieClient({ transport, lookup, sleep });
    for (const change of [{ duration: 1 }, { duration: 15.1 }, { resolution: 'default' }, { reference_video_urls: [] }, { aspect_ratio: 'wide' }])
      await expect(client.createTask(key, { ...input, ...change } as KieVideoInput)).rejects.toMatchObject({ kind: 'rejected' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('bounds reference DNS preflight and distinguishes cancellation before any paid submission', async () => {
    const transport = vi.fn<KieTransport>(), controller = new AbortController();
    const client = new KieClient({ transport, lookup: async () => new Promise(() => undefined), sleep, inactivityTimeoutMs: 20 });
    await expect(client.createTask(key, input)).rejects.toMatchObject({ kind: 'transient', submissionUnknown: false });
    controller.abort();
    await expect(client.createTask(key, input, controller.signal)).rejects.toMatchObject({ kind: 'rejected', submissionUnknown: false });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('Kie task receipts', () => {
  it.each([['waiting', 'waiting'], ['queuing', 'waiting'], ['generating', 'running'], ['success', 'succeeded'], ['fail', 'failed']] as const)
  ('normalizes %s and parses double-encoded input and source-reported counters', async (providerState, normalized) => {
    const transport = vi.fn<KieTransport>(async () => response(200, { code: 200, data: { taskId: 'task_123', state: providerState,
      model: 'wan/3-0-video', param: JSON.stringify({ model: 'wan/3-0-video', input: JSON.stringify(input) }),
      resultJson: JSON.stringify({ resultUrls: ['https://cdn.example/video.mp4?signature=abc'] }), failMsg: `failed Bearer ${key}`,
      progress: 48, creditsConsumed: 100, costTime: 45, createTime: 123, completeTime: 456 } }));
    const result = await new KieClient({ transport, lookup, sleep }).getTask(key, 'task_123');
    expect(result).toMatchObject({ state: normalized, providerState, model: 'wan/3-0-video', input,
      progress: 48, creditsConsumed: 100, costTime: 45, createdAt: 123, completedAt: 456 });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result.urls).toEqual(providerState === 'success' ? ['https://cdn.example/video.mp4?signature=abc'] : undefined);
  });
  it('does not invent progress, accept another task or accept malformed completed media', async () => {
    const transport = vi.fn<KieTransport>().mockResolvedValueOnce(response(200, { code: 200, data: { taskId: 'task_123', state: 'generating' } }))
      .mockResolvedValueOnce(response(200, { code: 200, data: { taskId: 'another', state: 'success' } }))
      .mockResolvedValueOnce(response(200, { code: 200, data: { taskId: 'task_123', state: 'success', resultJson: '{broken' } }));
    const client = new KieClient({ transport, lookup, sleep });
    expect((await client.getTask(key, 'task_123')).progress).toBeUndefined();
    await expect(client.getTask(key, 'task_123')).rejects.toMatchObject({ kind: 'protocol' });
    await expect(client.getTask(key, 'task_123')).rejects.toMatchObject({ kind: 'protocol' });
  });
});

describe('Kie file upload', () => {
  it('streams multipart through an explicitly injected loopback HTTP mock with private-safe names', async () => temporary(async directory => {
    const original = path.join(directory, 'private-person-holiday.mp4'); await writeFile(original, 'video-fixture');
    const observed: { body?: string; authorization?: string; path?: string } = {};
    const server = createServer((request, response) => { const chunks: Buffer[] = []; request.on('data', value => chunks.push(value)); request.on('end', () => {
      observed.body = Buffer.concat(chunks).toString(); observed.authorization = request.headers.authorization; observed.path = request.url;
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ success: true, code: 200, data: { success: true,
        downloadUrl: 'https://tempfile.redpandaai.co/kieai/source.mp4', uploadedAt: '2026-11-04T00:00:00.000Z' } }));
    }); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No mock port');
    // Production never bypasses DNS/public-IP rules. This explicit test-only
    // transport routes requests to a controlled local server without TLS/API.
    const transport: KieTransport = request => new Promise((resolve, reject) => {
      const client = httpRequest({ hostname: '127.0.0.1', port: address.port, path: request.url.pathname,
        method: request.method, headers: request.headers }, response => resolve({ status: response.statusCode!,
          headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])), body: response }));
      client.on('error', reject); void (async () => { if (request.body instanceof Uint8Array) client.end(request.body);
        else { if (request.body) for await (const chunk of request.body) client.write(chunk); client.end(); } })();
    });
    try {
      const result = await new KieClient({ transport, lookup, sleep }).uploadFile(original, key, 'video', undefined, { jobId: '00000000-0000-0000-0000-000000000001' });
      expect(result).toMatchObject({ bytes: 13, fileName: 'source.mp4', expiresAt: '2026-11-05T00:00:00.000Z' });
      expect(observed.path).toBe('/api/file-stream-upload'); expect(observed.authorization).toBe(`Bearer ${key}`);
      expect(observed.body).toContain('recast/00000000-0000-0000-0000-000000000001'); expect(observed.body).toContain('filename="source.mp4"');
      expect(observed.body).not.toContain('private-person-holiday'); expect(observed.body).toContain('video-fixture');
    } finally { server.close(); await once(server, 'close'); }
  }));
  it('uses distinct anonymous names for the two image roles in the same job', async () => temporary(async directory => {
    const original=path.join(directory,'private-person-face.png'); await writeFile(original,'image-fixture');
    const names:string[]=[];
    const transport=vi.fn<KieTransport>(async request=>{
      const bytes=(await body(request)).toString(); expect(bytes).not.toContain('private-person-face');
      const name=bytes.match(/name="fileName"\r\n\r\n([^\r]+)/)?.[1]; names.push(name!);
      return response(200,{code:200,success:true,data:{downloadUrl:`https://tempfile.redpandaai.co/${name}`}});
    });
    const client=new KieClient({transport,lookup,sleep}), jobId='00000000-0000-0000-0000-000000000001';
    await client.uploadFile(original,key,'image',undefined,{jobId});
    await client.uploadFile(original,key,'image',undefined,{jobId,imageRole:'face'});
    expect(names).toEqual(['reference.png','face-reference.png']);
  }));
  it('rejects oversized files and symlinks before an upload POST', async () => temporary(async directory => {
    const file = path.join(directory, 'oversize.mp4'), linked = path.join(directory, 'linked.mp4');
    const handle = await open(file, 'w'); await handle.truncate(100_000_001); await handle.close(); await symlink(file, linked);
    const transport = vi.fn<KieTransport>(), client = new KieClient({ transport, lookup, sleep });
    await expect(client.uploadFile(file, key, 'video')).rejects.toMatchObject({ kind: 'rejected' });
    await expect(client.uploadFile(linked, key, 'video')).rejects.toBeDefined(); expect(transport).not.toHaveBeenCalled();
  }));
});

describe('Kie public download transport', () => {
  it('loops partial filesystem writes without reporting unwritten bytes', async () => {
    const chunks: Buffer[] = [];
    const writer = { write: vi.fn(async (bytes: Uint8Array) => { const count = Math.min(bytes.length, 3); chunks.push(Buffer.from(bytes.subarray(0, count))); return { bytesWritten: count }; }) };
    await writeAll(writer, Buffer.from('ABCDEFGH'));
    expect(Buffer.concat(chunks).toString()).toBe('ABCDEFGH'); expect(writer.write).toHaveBeenCalledTimes(3);
    await expect(writeAll({ write: async () => ({ bytesWritten: 0 }) }, Buffer.from('x'))).rejects.toMatchObject({ kind: 'protocol' });
  });
  it.each([false, true])('recovers a receipt-commit crash with an existing output and identical partial=%s without HTTP', async keepPart => temporary(async directory => {
    const destination = path.join(directory, 'out.mp4'), url = 'https://cdn.example/out';
    await writeFile(destination, 'ABCDEFGH');
    if (keepPart) await writeFile(destination + '.part', 'ABCDEFGH');
    await writeFile(destination + '.part.json', JSON.stringify({ sourceHash: sha(url), total: 8,
      verifiedBytes: 8, verifiedSHA256: sha('ABCDEFGH'), complete: true }));
    const transport = vi.fn<KieTransport>(), client = new KieClient({ transport, lookup, sleep });
    expect(await client.downloadResult(url, destination)).toMatchObject({ bytes: 8, sha256: sha('ABCDEFGH') });
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(destination + '.download.json', 'utf8')).sourceHash).toBe(sha(url));
    if (keepPart) await expect(stat(destination + '.part')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(destination + '.download.json')).mode & 0o077).toBe(0);
  }));
  it('preserves contradictory partial/output files after an incomplete receipt commit', async () => temporary(async directory => {
    const destination = path.join(directory, 'out.mp4'), url = 'https://cdn.example/out';
    await writeFile(destination, 'ABCDEFGH'); await writeFile(destination + '.part', 'WRONG!!!');
    await writeFile(destination + '.part.json', JSON.stringify({ sourceHash: sha(url), total: 8,
      verifiedBytes: 8, verifiedSHA256: sha('ABCDEFGH'), complete: true }));
    const transport = vi.fn<KieTransport>();
    await expect(new KieClient({ transport, lookup, sleep }).downloadResult(url, destination)).rejects.toMatchObject({ kind: 'protocol' });
    expect((await readFile(destination)).toString()).toBe('ABCDEFGH'); expect((await readFile(destination + '.part')).toString()).toBe('WRONG!!!');
    expect(transport).not.toHaveBeenCalled();
  }));
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '198.18.0.1', '::1', 'fc00::1',
    'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2002:7f00:1::', '2001:db8::1', '64:ff9b::7f00:1'])('rejects private/reserved address %s', address => expect(isPublicAddress(address)).toBe(false));
  it('accepts public IPv4/IPv6 and rejects mixed public/private DNS without making an HTTP request', async () => temporary(async directory => {
    expect(isPublicAddress('8.8.8.8')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    const transport = vi.fn<KieTransport>(), client = new KieClient({ transport,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], sleep });
    await expect(client.downloadResult('https://cdn.example/video.mp4', path.join(directory, 'out.mp4'))).rejects.toMatchObject({ kind: 'security' });
    expect(transport).not.toHaveBeenCalled();
  }));
  it('validates every redirect and never sends bearer credentials to CDN hosts', async () => temporary(async directory => {
    const transport = vi.fn<KieTransport>().mockResolvedValueOnce(response(302, '', { location: 'https://cdn2.example/video.mp4' }))
      .mockResolvedValueOnce(response(200, Buffer.from('video'), { 'content-length': '5' }));
    const client = new KieClient({ transport, lookup, sleep }); const result = await client.downloadResult('https://cdn.example/video.mp4', path.join(directory, 'out.mp4'));
    expect(result).toMatchObject({ bytes: 5, sha256: sha('video') });
    for (const [request] of transport.mock.calls) { expect(request.headers.Authorization).toBeUndefined(); expect(request.address.address).toBe('8.8.8.8'); }
    const bad = vi.fn<KieTransport>(async () => response(302, '', { location: 'https://127.0.0.1/private' }));
    await expect(new KieClient({ transport: bad, lookup, sleep }).downloadResult('https://cdn.example/video.mp4', path.join(directory, 'other.mp4'))).rejects.toMatchObject({ kind: 'security' });
    expect(bad).toHaveBeenCalledTimes(1);
  }));
  it('resumes a broken transfer with Range/If-Range and exact original bytes', async () => temporary(async directory => {
    let count = 0;
    const transport = vi.fn<KieTransport>(async request => {
      expect(request.headers.Authorization).toBeUndefined(); count++;
      if (count === 1) return { status: 200, headers: { 'content-length': '8', etag: '"v1"' }, body: (async function* () { yield Buffer.from('ABCD'); throw new Error('network lost'); })() };
      expect(request.headers.Range).toBe('bytes=4-'); expect(request.headers['If-Range']).toBe('"v1"');
      return response(206, Buffer.from('EFGH'), { 'content-length': '4', 'content-range': 'bytes 4-7/8', etag: '"v1"' });
    });
    const destination = path.join(directory, 'out.mp4'), client = new KieClient({ transport, lookup, sleep });
    expect(await client.downloadResult('https://cdn.example/video.mp4', destination)).toMatchObject({ bytes: 8, sha256: sha('ABCDEFGH') });
    expect((await readFile(destination)).toString()).toBe('ABCDEFGH'); expect((await stat(destination)).mode & 0o077).toBe(0);
  }));
  it('prefix-checks the entire existing partial if the server ignores Range', async () => temporary(async directory => {
    let count = 0; const destination = path.join(directory, 'out.mp4');
    const transport = vi.fn<KieTransport>(async () => ++count === 1 ? { status: 200, headers: { 'content-length': '8' }, body: (async function* () { yield Buffer.from('ABCD'); throw new Error('broken'); })() }
      : response(200, Buffer.from('ABCDEFGH'), { 'content-length': '8' }));
    await new KieClient({ transport, lookup, sleep }).downloadResult('https://cdn.example/out', destination);
    expect((await readFile(destination)).toString()).toBe('ABCDEFGH'); expect(transport.mock.calls[1][0].headers.Range).toBe('bytes=0-');
  }));
  it('never overwrites a changed prefix or promotes its new validator', async () => temporary(async directory => {
    let count = 0; const destination = path.join(directory, 'out.mp4');
    const transport = vi.fn<KieTransport>(async () => ++count === 1 ? { status: 200, headers: { 'content-length': '8', etag: '"old"' }, body: (async function* () { yield Buffer.from('ABCD'); throw new Error('broken'); })() }
      : response(200, Buffer.from('ZZZZYYYY'), { 'content-length': '8', etag: '"new"' }));
    await expect(new KieClient({ transport, lookup, sleep }).downloadResult('https://cdn.example/out', destination)).rejects.toMatchObject({ kind: 'protocol' });
    expect((await readFile(destination + '.part')).toString()).toBe('ABCD');
    expect(JSON.parse(await readFile(destination + '.part.json', 'utf8')).etag).toBe('"old"');
  }));
  it('does not replace existing output files or follow local output symlinks', async () => temporary(async directory => {
    const destination = path.join(directory, 'original.mp4'); await writeFile(destination, 'preserved');
    const transport = vi.fn<KieTransport>(async () => response(200, Buffer.from('new'))), client = new KieClient({ transport, lookup, sleep });
    await expect(client.downloadResult('https://cdn.example/out', destination)).rejects.toMatchObject({ kind: 'protocol' });
    expect((await readFile(destination)).toString()).toBe('preserved');
    const linked = path.join(directory, 'link.mp4'); await symlink(destination, linked);
    await expect(client.downloadResult('https://cdn.example/out', linked)).rejects.toMatchObject({ kind: 'security' }); expect(transport).not.toHaveBeenCalled();
  }));
  it('rejects oversized results and malformed ranges without silently discarding partial bytes', async () => temporary(async directory => {
    const client = new KieClient({ lookup, sleep, maxDownloadBytes: 4, transport: async () => response(200, 'abcdef', { 'content-length': '6' }) });
    await expect(client.downloadResult('https://cdn.example/out', path.join(directory, 'big'))).rejects.toMatchObject({ kind: 'protocol' });
    const invalid = new KieClient({ lookup, sleep, transport: async () => response(206, 'abc', { 'content-range': 'bytes 2-4/5', 'content-length': '3' }) });
    await expect(invalid.downloadResult('https://cdn.example/out', path.join(directory, 'bad'))).rejects.toMatchObject({ kind: 'protocol' });
  }));
  it('uses an inactivity timeout that resets on progress instead of a total-transfer deadline', async () => temporary(async directory => {
    const client = new KieClient({ lookup, sleep, inactivityTimeoutMs: 80, readAttempts: 1,
      transport: async () => ({ status: 200, headers: { 'content-length': '5' }, body: (async function* () {
        for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 30)); yield Buffer.from('x'); }
      })() }) });
    expect((await client.downloadResult('https://cdn.example/out', path.join(directory, 'healthy'))).bytes).toBe(5);
    let cancelled = false;
    const stalled = new KieClient({ lookup, sleep, inactivityTimeoutMs: 25, readAttempts: 1,
      transport: async () => ({ status: 200, headers: {}, cancel: () => { cancelled = true; }, body: (async function* () { await new Promise(() => undefined); yield Buffer.from('x'); })() }) });
    await expect(stalled.downloadResult('https://cdn.example/out', path.join(directory, 'stalled'))).rejects.toMatchObject({ kind: 'transient' });
    expect(cancelled).toBe(true);
  }));
});
