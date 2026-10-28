import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { GpuIdleManager, GPU_IDLE_MS, gpuQueueEmpty } from '../server/gpu-idle';
import type { CloudManager } from '../server/cloud';
import type { ConnectionManager } from '../server/comfy';

describe('five-minute GPU idle pause', () => {
  let store: Store, root = '', idle: GpuIdleManager;
  afterEach(async () => { idle?.dispose(); store?.close(); if (root) await rm(root, { recursive: true, force: true }); idle = undefined!; store = undefined!; root = ''; vi.unstubAllGlobals(); });
  async function fixture() {
    root = await mkdtemp(path.join(os.tmpdir(), 'recast-idle-')); store = new Store(root); store.set('cloud-connected-instance', 777);
    let now = Date.parse('2026-10-28T15:00:00Z'), busy = false;
    const cloud = { state: { configured: true, busy: false, launches: [{ instanceId: 777, phase: 'ready', safetyStatus: 'armed' }] }, pauseIdle: vi.fn(async (_id: number, valid: () => boolean, empty: () => Promise<boolean>): Promise<'confirmed' | 'unconfirmed' | 'aborted'> => valid() && await empty() && valid() ? 'confirmed' : 'aborted') };
    const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188' } };
    const empty = vi.fn(async (_endpoint: string) => true);
    idle = new GpuIdleManager(store, cloud as unknown as CloudManager, connection as ConnectionManager, () => busy, empty, () => now);
    return { cloud, connection, empty, advance(ms: number) { now += ms; }, work(value: boolean) { busy = value; } };
  }
  it('pauses only after a full verified idle interval and never restarts or deletes compute', async () => {
    const f = await fixture(); await idle.tick(); f.advance(GPU_IDLE_MS - 1); await idle.tick(); expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
    f.advance(1); await idle.tick(); expect(f.cloud.pauseIdle).toHaveBeenCalledOnce(); expect(f.cloud.pauseIdle.mock.calls[0][0]).toBe(777);
    expect(idle.state.status).toBe('paused'); expect(idle.state.lastPause?.confirmedAt).toBeTruthy();
  });
  it('resets during jobs, model transfers, face processing or setup regardless of how long they take', async () => {
    const f = await fixture(); await idle.tick(); f.advance(299_000); f.work(true); await idle.tick();
    f.advance(30 * 60_000); await idle.tick(); expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
    f.work(false); await idle.tick(); f.advance(299_000); await idle.tick(); expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
    f.advance(1000); await idle.tick(); expect(f.cloud.pauseIdle).toHaveBeenCalledOnce();
  });
  it('does not treat ComfyUI activity, an unknown queue or a transport failure as idle', async () => {
    const f = await fixture(); await idle.tick(); f.advance(GPU_IDLE_MS);
    f.empty.mockResolvedValueOnce(false); await idle.tick(); expect(idle.state.idleSince).toBeNull();
    f.advance(GPU_IDLE_MS); f.empty.mockRejectedValueOnce(new Error('Offline')); await idle.tick(); expect(idle.state.status).toBe('checking');
    expect(f.cloud.pauseIdle).not.toHaveBeenCalled(); expect(f.connection.status.state).toBe('online');
    await idle.tick(); f.advance(GPU_IDLE_MS - 1); await idle.tick(); expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
  });
  it('invalidates an in-flight idle check when new work arrives or the rental changes', async () => {
    const f = await fixture(); await idle.tick(); f.advance(GPU_IDLE_MS);
    let release!: (value: boolean) => void; f.empty.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const check = idle.tick(); idle.touch(); release(true); await check; expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
    f.advance(GPU_IDLE_MS); f.empty.mockImplementationOnce(async () => { store.set('cloud-connected-instance', 888); return true; });
    await idle.tick(); expect(f.cloud.pauseIdle).not.toHaveBeenCalled();
  });
  it('never pauses setup, offline, unmanaged or disabled rentals and persists the preference', async () => {
    const f = await fixture(); idle.configure(false); f.advance(GPU_IDLE_MS * 2); await idle.tick(); expect(f.empty).not.toHaveBeenCalled(); expect(store.value('gpu-idle-auto-pause', true)).toBe(false);
    idle.configure(true); f.cloud.state.launches[0].phase = 'installing'; await idle.tick();
    f.cloud.state.launches[0].phase = 'ready'; f.connection.status.state = 'offline'; await idle.tick();
    f.connection.status.state = 'online'; store.set('cloud-connected-instance', 999); await idle.tick();
    expect(f.cloud.pauseIdle).not.toHaveBeenCalled(); expect(f.empty).not.toHaveBeenCalled();
  });
  it('reports an unconfirmed pause as an error and waits for actual stop confirmation', async () => {
    const f = await fixture(); f.cloud.pauseIdle.mockResolvedValue('unconfirmed'); await idle.tick(); f.advance(GPU_IDLE_MS); await idle.tick();
    expect(idle.state.lastPause?.confirmedAt).toBeUndefined(); expect(idle.state.lastPause?.error).toContain('not confirmed');
    f.cloud.state.launches[0].phase = 'stopped'; f.cloud.state.launches[0].safetyStatus = 'stopped'; f.connection.status.state = 'offline';
    await idle.tick(); expect(idle.state.lastPause?.confirmedAt).toBeTruthy(); expect(idle.state.status).toBe('paused');
  });
  it('rejects unreadable or incomplete native queue responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ queue_running: [] }))));
    await expect(gpuQueueEmpty('http://127.0.0.1:8188')).rejects.toThrow('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ queue_running: [], queue_pending: [] }))));
    await expect(gpuQueueEmpty('http://127.0.0.1:8188')).resolves.toBe(true);
  });
});
