import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyClient, OfflineError } from '../server/comfy';

const client = new ComfyClient('http://127.0.0.1:8188');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('safe ComfyUI metadata retries', () => {
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
