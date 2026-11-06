import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { ModelManager, type downloadPinnedModels } from '../server/models';
import type { manageGpuFiles } from '../server/gpu-files';
import type { ConnectionManager } from '../server/comfy';
import { gpuFileDeleteSchema, gpuFileListSchema, gpuFileModelId, gpuFileRestorable, type GpuFileListing } from '../shared/gpu-files';
import { defaults, type Catalog } from '../shared/types';
import { modelDefinitions, modelFilesForSettings } from '../shared/models';
import { moduleDownloadPlan, moduleDownloadProgress } from '../shared/module-downloads';
import ModuleAction from '../src/ModuleAction';
import { fileRemovalMessage } from '../src/GpuFileBrowser';

const token = 'a'.repeat(64), selected = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const, facialConsistency: 'off' as const };
const files = modelFilesForSettings(selected), id = files[0];
let folder = '', store: Store | undefined, manager: ModelManager | undefined;
afterEach(async () => { manager?.dispose(); store?.close(); if (folder) await rm(folder, { recursive: true, force: true }); });

async function fixture() {
  folder = await mkdtemp(path.join(os.tmpdir(), 'gpu-files-')); store = new Store(folder); store.set('cloud-connected-instance', 123);
  const present = new Set(files), queue = vi.fn(async () => ({ queue_running: [], queue_pending: [] }));
  // Loader names deliberately remain cached after deletion.
  const catalog: Catalog = { Loader: { input: { required: { files: [files.map(id => id.split('/').at(-1)!)] } }, output: [] } };
  const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188', loras: [] }, client: () => ({ json: async (route: string) => route === '/queue' ? queue() : catalog }), emit: vi.fn() };
  const storage = vi.fn(async () => ({ freeBytes: 1e12, loras: [], files: [...present].map(id => ({ id, size: modelDefinitions.find(file => file.id === id)!.size, verified: true })) }));
  const download = vi.fn<typeof downloadPinnedModels>(async (_repo, _instance, _endpoint, names) => { for (const name of names) present.add(name); });
  const release = vi.fn(async () => {});
  manager = new ModelManager(store, connection as unknown as ConnectionManager, path.resolve(import.meta.dirname, '../..'), download, storage, release);
  const request = { instanceId: 123, root: 'models' as const, path: id, token };
  const remove = vi.fn(async () => { present.delete(id); return { ...request, removed: true, freedBytes: 12, freeBytes: 1e12 }; });
  return { manager, present, download, queue, release, request, remove: remove as unknown as typeof manageGpuFiles, removeSpy: remove, connection };
}

describe('GPU file storage', () => {
  it('rejects absolute/traversing paths, unknown roots and stale confirmation shapes', () => {
    for (const path of ['/etc/passwd', '../weights', 'a/../b', 'a//b', 'a\\b', 'bad\nname']) expect(gpuFileListSchema.safeParse({ instanceId: 123, root: 'models', path }).success).toBe(false);
    expect(gpuFileDeleteSchema.safeParse({ instanceId: 123, root: 'models', path: 'file.bin', token: 'bad' }).success).toBe(false);
    expect(gpuFileListSchema.safeParse({ instanceId: 123, root: '/etc', path: '' }).success).toBe(false);
  });
  it('advertises restoration only for catalog models and identifies their workspace/partial paths', () => {
    expect(gpuFileModelId({ root: 'workspace', path: 'models/' + id })).toBe(id);
    expect(gpuFileRestorable({ root: 'models', path: id + '.part' })).toBe(true);
    expect(gpuFileRestorable({ root: 'models', path: 'custom/unknown.gguf' })).toBe(false);
    expect(gpuFileRestorable({ root: 'output', path: 'video.mp4' })).toBe(false);
    const listing = { root: 'models', path: '', absolutePath: '/workspace/character-swap/models', instanceId: 123 } as GpuFileListing;
    expect(fileRemovalMessage(listing, { name: id.split('/').at(-1)!, path: id, kind: 'file', size: 12, modifiedAt: '', token, deletable: true })).toContain('Download missing dependencies again');
    expect(fileRemovalMessage(listing, { name: 'custom.bin', path: 'custom.bin', kind: 'file', size: 12, modifiedAt: '', token, deletable: true })).toContain('will not restore');
  });
  it('invalidates a deleted model despite cached loader names, then downloads only that missing dependency', async () => {
    const f = await fixture(); await f.manager.refresh();
    expect(moduleDownloadProgress(moduleDownloadPlan('remotion', selected), f.manager.state).missing).toEqual([]);
    const originals = JSON.stringify({ draft: store!.draft(), image: store!.imageDraft(), jobs: store!.jobs() });
    await f.manager.removeGpuFile(f.request, () => {}, f.remove);
    const plan = moduleDownloadPlan('remotion', selected);
    expect(moduleDownloadProgress(plan, f.manager.state).missing).toEqual([id]);
    const html = renderToStaticMarkup(<ModuleAction request={{ module: 'remotion', settings: selected }} controls={{ state: f.manager.state, online: true, blocked: false, download: () => {}, remove: () => {} }} runtimeReady onGenerate={() => {}} onManage={() => {}} onConnect={() => {}} />);
    expect(html).toContain('Download Remotion');
    expect(f.download).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify({ draft: store!.draft(), image: store!.imageDraft(), jobs: store!.jobs() })).toBe(originals);
    await f.manager.start(moduleDownloadProgress(plan, f.manager.state).missing); await f.manager.settle();
    expect(f.download).toHaveBeenCalledOnce(); expect(f.download.mock.calls[0][3]).toEqual([id]);
    expect(f.manager.state.files.find(file => file.id === id)?.status).toBe('installed');
  });
  it('blocks stale rentals, active transfers, malformed queues and activity that starts during preflight', async () => {
    const f = await fixture();
    await expect(f.manager.removeGpuFile({ ...f.request, instanceId: 456 }, () => {}, f.remove)).rejects.toThrow('selected managed GPU');
    f.manager.state.busy = true; await expect(f.manager.removeGpuFile(f.request, () => {}, f.remove)).rejects.toThrow('Finish setup'); f.manager.state.busy = false;
    f.queue.mockResolvedValueOnce({} as any); await expect(f.manager.removeGpuFile(f.request, () => {}, f.remove)).rejects.toThrow('could not be verified');
    f.queue.mockResolvedValueOnce({ queue_running: [1], queue_pending: [] } as any); await expect(f.manager.removeGpuFile(f.request, () => {}, f.remove)).rejects.toThrow('render queue');
    let checks = 0; await expect(f.manager.removeGpuFile(f.request, () => { if (++checks === 3) throw new Error('New render'); }, f.remove)).rejects.toThrow('New render');
    expect(f.removeSpy).not.toHaveBeenCalled(); expect(f.manager.state.busy).toBe(false);
  });
  it('rejects a GPU change after an awaited cache release and a stale list response', async () => {
    const f = await fixture();
    f.release.mockImplementationOnce(async () => { store!.set('cloud-connected-instance', 456); });
    await expect(f.manager.removeGpuFile(f.request, () => {}, f.remove)).rejects.toThrow('GPU changed'); expect(f.removeSpy).not.toHaveBeenCalled();
    store!.set('cloud-connected-instance', 123);
    const listing = vi.fn(async () => { store!.set('cloud-connected-instance', 456); return {}; }) as unknown as typeof manageGpuFiles;
    await expect(f.manager.listGpuFiles({ instanceId: 123, root: 'models', path: '', offset: 0 }, listing)).rejects.toThrow('GPU changed');
  });
});
