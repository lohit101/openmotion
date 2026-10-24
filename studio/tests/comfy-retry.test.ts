import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyClient, ConnectionManager, OfflineError } from '../server/comfy';
import type { Store } from '../server/store';

const client = new ComfyClient('http://127.0.0.1:8188');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('safe ComfyUI metadata retries', () => {
  it('restores a lost tunnel once and checks the same prompt without any mutation', async () => {
    vi.useFakeTimers();
    const recover = vi.fn().mockResolvedValue(true), fetcher = vi.fn();
    for (let i = 0; i < 3; i++) fetcher.mockRejectedValueOnce(new TypeError('Tunnel closed'));
    fetcher.mockResolvedValueOnce(json({ existing: { status: { completed: true } } })); vi.stubGlobal('fetch', fetcher);
    const pending = new ComfyClient(client.endpoint, recover).json('/history/existing');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toEqual({ existing: { status: { completed: true } } }); expect(recover).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every(([url, options]) => url.endsWith('/history/existing') && options.method === 'GET')).toBe(true);
  });

  it('does not enter an endless recovery loop when the tunnel restores but the GPU server stays down', async () => {
    vi.useFakeTimers();
    const recover = vi.fn().mockResolvedValue(true), fetcher = vi.fn().mockRejectedValue(new TypeError('Server closed'));
    vi.stubGlobal('fetch', fetcher);
    const pending = new ComfyClient(client.endpoint, recover).json('/queue').catch(error => error);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeInstanceOf(OfflineError); expect(recover).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('never invokes connection recovery or repeats a failed paid submission', async () => {
    const recover = vi.fn().mockResolvedValue(true), fetcher = vi.fn().mockRejectedValue(new TypeError('Response lost'));
    vi.stubGlobal('fetch', fetcher);
    await expect(new ComfyClient(client.endpoint, recover).json('/prompt', { prompt: {} })).rejects.toThrow(OfflineError);
    expect(recover).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('recovers a stalled history read with a longer deadline and does not resubmit the prompt', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockRejectedValueOnce(new DOMException('poll deadline', 'TimeoutError')).mockResolvedValueOnce(json({ active: { status: { completed: false } } }));
    vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/history/active');
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ active: { status: { completed: false } } });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(timeout).toHaveBeenNthCalledWith(1, 45000); expect(timeout).toHaveBeenNthCalledWith(2, 45000);
    expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET' && options.body === undefined)).toBe(true);
  });

  it.each([429, 500, 502, 503, 504])('retries transient HTTP %i queue reads with bounded backoff', async status => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: 'temporary' }, status)).mockResolvedValueOnce(json({ error: 'temporary' }, status)).mockResolvedValueOnce(json({ queue_running: [], queue_pending: [] }));
    vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/queue');
    await vi.advanceTimersByTimeAsync(499); expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ queue_running: [], queue_pending: [] }); expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('stops after three transient reads and reports an offline condition without leaking response details', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json({ error: { message: 'private upstream detail token=secret' } }, 503)));
    vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/object_info').catch(error => error);
    await vi.advanceTimersByTimeAsync(1500);
    const error = await pending;
    expect(error).toBeInstanceOf(OfflineError); expect(error.message).toContain('existing job may still be running'); expect(error.message).not.toContain('secret');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404, 422])('does not retry nontransient HTTP %i metadata errors', async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { message: 'Request rejected' } }, status)); vi.stubGlobal('fetch', fetcher);
    await expect(client.json('/queue')).rejects.toThrow('Request rejected'); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('never repeats prompt submission after a lost response and retains its ambiguous offline error', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('private request detail token=secret')); vi.stubGlobal('fetch', fetcher);
    await expect(client.json('/prompt', { prompt: { node: 'test' } })).rejects.toThrow(OfflineError);
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].method).toBe('POST'); expect(timeout).toHaveBeenCalledOnce(); expect(timeout).toHaveBeenCalledWith(12000);
  });

  it('never retries mutation HTTP failures or an unreadable successful submission response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: 'temporary' }, 503)).mockResolvedValueOnce(new Response('not-json', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    await expect(client.json('/api/jobs/existing/cancel', {})).rejects.toThrow('temporary'); expect(fetcher).toHaveBeenCalledOnce();
    await expect(client.json('/prompt', { prompt: {} })).rejects.toThrow(OfflineError); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts immediately during backoff and sends no next read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), reason = new Error('User stopped this check');
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('temporary read stall')); vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/queue', undefined, controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(1); controller.abort(reason);
    expect(await pending).toBe(reason); await vi.advanceTimersByTimeAsync(2000); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts an active metadata fetch and does not turn user cancellation into a retry', async () => {
    const controller = new AbortController(), reason = new Error('Cancelled');
    const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))); vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/queue', undefined, controller.signal).catch(error => error);
    controller.abort(reason);
    expect(await pending).toBe(reason); expect(fetcher).toHaveBeenCalledOnce();
    await expect(client.json('/prompt', {}, controller.signal)).rejects.toBe(reason); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('recovers unreadable metadata but never returns a primitive or HTML error body as valid metadata', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('incomplete', { status: 200 })).mockResolvedValueOnce(json(null)).mockResolvedValueOnce(json({ queue_running: [], queue_pending: [] })); vi.stubGlobal('fetch', fetcher);
    const pending = client.json('/queue'); await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toEqual({ queue_running: [], queue_pending: [] }); expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValueOnce(new Response('<html>private proxy secret</html>', { status: 400 }));
    await expect(client.json('/queue')).rejects.toThrow('ComfyUI returned HTTP 400.'); expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('managed connection recovery', () => {
  function managed(restore: (...args: any[]) => Promise<string>) {
    const values = new Map<string, any>([['cloud-connected-instance', 123]]);
    const store = { value: (key: string, fallback: unknown) => values.get(key) ?? fallback, emit: vi.fn() } as unknown as Store;
    return { connection: new ConnectionManager(store, '/test/project', {}, restore), values };
  }

  it('deduplicates concurrent reconnects and only repairs forwarding to the intended existing rental', async () => {
    let release!: () => void;
    const restore = vi.fn(() => new Promise<string>(resolve => { release = () => resolve(''); }));
    const { connection } = managed(restore), fetcher = vi.fn().mockImplementation(() => Promise.resolve(json({ devices: [{ type: 'cuda' }] })));
    vi.stubGlobal('fetch', fetcher);
    const first = connection.recoverTransport(), second = connection.recoverTransport(); release();
    expect(await first).toBe(true); expect(await second).toBe(true); expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0]).toEqual(['python3', ['/test/project/scripts/vast.py', 'tunnel', '--instance-id', '123'], undefined, 25000]);
    expect(connection.status.state).toBe('online'); expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toMatch(/\/system_stats$/);
  });

  it('does not reconnect a stopped/unmanaged instance or a custom endpoint', async () => {
    const restore = vi.fn().mockResolvedValue(''), { connection, values } = managed(restore);
    values.delete('cloud-connected-instance'); expect(await connection.recoverTransport()).toBe(false);
    values.set('cloud-connected-instance', 123); connection.status.endpoint = 'http://127.0.0.1:9999';
    expect(await connection.recoverTransport()).toBe(false); expect(restore).not.toHaveBeenCalled();
  });

  it('keeps a manual disconnect authoritative while forwarding repair is in flight', async () => {
    let release!: () => void;
    const restore = vi.fn(() => new Promise<string>(resolve => { release = () => resolve(''); }));
    const { connection } = managed(restore); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ devices: [{ type: 'cuda' }] })));
    const recovery = connection.recoverTransport(); connection.disconnect('Stopped by you'); release();
    expect(await recovery).toBe(false); expect(connection.status.state).toBe('offline'); expect(connection.status.message).toBe('Stopped by you');
  });
});
