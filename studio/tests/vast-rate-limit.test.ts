import { afterEach, describe, expect, it, vi } from 'vitest';
import { VastClient, VastError } from '../server/cloud';

const reply = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Vast request coordination', () => {
  it('shares concurrent identical reads without caching later responses', async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(reply({ instances: [] }));
    const client = new VastClient(async () => 'fixture-key', fetcher), a = client.instances(), b = client.instances();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); release(reply({ instances: [{ id: 77 }] }));
    expect(await a).toEqual([{ id: 77 }]); expect(await b).toEqual([{ id: 77 }]);
    expect(await client.instances()).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('recovers the same instance after a detail-only 429 and Retry-After', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ detail: 'API requests too frequent endpoint threshold=2.0' }, 429, { 'Retry-After': '8' }))
      .mockResolvedValueOnce(reply({ instances: { id: 77, actual_status: 'running' } }));
    const result = new VastClient(async () => 'fixture-key', fetcher).instance(77);
    await vi.advanceTimersByTimeAsync(7999); expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ id: 77, actual_status: 'running' });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(Array(2).fill('https://console.vast.ai/api/v0/instances/77/'));
  });
  it('recognizes a rate-limit rejection even with HTTP 200', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ success: false, msg: 'API requests too frequent' })).mockResolvedValueOnce(reply({ instances: [] }));
    const result = new VastClient(async () => 'fixture-key', fetcher).instances();
    await vi.advanceTimersByTimeAsync(5000); expect(await result).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('honors HTTP-date cooldowns across routes without queuing paid commands', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ detail: 'API requests too frequent' }, 429, { 'Retry-After': 'Fri, 13 Nov 2026 15:01:00 GMT' })).mockResolvedValue(reply({ instances: [] }));
    const client = new VastClient(async () => 'fixture-key', fetcher);
    await expect(client.instances()).rejects.toMatchObject({ status: 429, retryAt: Date.now() + 60000 });
    await expect(client.request('/api/v0/instances/77/', 'PUT', { state: 'running' })).rejects.toMatchObject({ status: 429, ambiguous: false });
    await expect(client.request('/api/v0/ssh/')).rejects.toMatchObject({ status: 429 }); expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledOnce();
    await client.instances(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds repeated rate-limit reads', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ detail: 'API requests too frequent' }, 429));
    const result = new VastClient(async () => 'fixture-key', fetcher).request('/api/v0/ssh/', 'GET', undefined, 100000).catch(error => error);
    await vi.advanceTimersByTimeAsync(15000); expect(await result).toBeInstanceOf(VastError); expect(await result).toMatchObject({ status: 429, ambiguous: false }); expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120000); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(['PUT', 'POST', 'DELETE'])('never repeats a rejected %s mutation', async method => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ detail: 'API requests too frequent' }, 429));
    await expect(new VastClient(async () => 'fixture-key', fetcher).request('/api/v0/instances/77/', method, { state: 'running' })).rejects.toMatchObject({ status: 429, ambiguous: false });
    await vi.advanceTimersByTimeAsync(120000); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never shares a pre-mutation read with a later confirmation', async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce(reply({ success: true })).mockResolvedValueOnce(reply({ instances: { id: 77, actual_status: 'stopped' } }));
    const client = new VastClient(async () => 'fixture-key', fetcher), old = client.instance(77);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); await client.request('/api/v0/instances/77/', 'PUT', { state: 'stopped' });
    expect(await client.instance(77)).toMatchObject({ actual_status: 'stopped' }); release(reply({ instances: { id: 77, actual_status: 'running' } }));
    expect(await old).toMatchObject({ actual_status: 'running' }); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retries the same read-only offer query with unchanged filters', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ detail: 'API requests too frequent' }, 429)).mockResolvedValueOnce(reply({ offers: [] }));
    const body = { gpu_ram: { gte: 40000 }, limit: 1000 }, result = new VastClient(async () => 'fixture-key', fetcher).request('/api/v0/bundles/', 'POST', body);
    await vi.advanceTimersByTimeAsync(5000); expect(await result).toEqual({ offers: [] }); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url, init]) => String(url).endsWith('/api/v0/bundles/') && init?.body === JSON.stringify(body))).toBe(true);
  });
  it('preserves ambiguity after losing a paid request response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('lost response'));
    await expect(new VastClient(async () => 'fixture-key', fetcher).request('/api/v0/asks/123/', 'PUT', {})).rejects.toMatchObject({ status: 503, ambiguous: true }); expect(fetcher).toHaveBeenCalledOnce();
  });
});
