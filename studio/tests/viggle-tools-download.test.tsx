import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaults, type Catalog } from '../shared/types';
import { emptyModels, hasViggleTools, modelDefinitions, viggleToolNodes } from '../shared/models';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { ModelManager, type downloadPinnedModels, type ViggleToolsStatus } from '../server/models';
import { Store } from '../server/store';
import type { ConnectionManager } from '../server/comfy';
import ModuleAction from '../src/ModuleAction';

const selected = { ...defaults, engine: 'viggle' as const, referencePreparation: 'prepared' as const, facialConsistency: 'off' as const };
const plan = moduleDownloadPlan('remotion', selected);
const status = (extra: Partial<ViggleToolsStatus> = {}): ViggleToolsStatus => ({ instanceId: 123, ready: true, running: false,
  unknown: false, confirmedStopped: true, helperSHA256: 'a'.repeat(64), state: 'complete', ...extra });

describe('explicit native video-tools preparation', () => {
  let root = '', store: Store, manager: ModelManager;
  afterEach(async () => { manager?.dispose(); await manager?.cancel(); store?.close(); if (root) await rm(root, { recursive: true, force: true }); manager = undefined!; store = undefined!; root = ''; });
  async function fixture(alreadyReady = false, saved?: unknown) {
    root = await mkdtemp(path.join(os.tmpdir(), 'recast-native-tools-')); store = new Store(root);
    store.set('cloud-connected-instance', 123); if (saved) store.set('model-download-state-v1', saved);
    const installed = new Set<string>(); let nodesReady = alreadyReady;
    const catalog = () => ({ Loader: { input: { required: { files: [[...installed].map(id => id.split('/').at(-1))] } }, output: [] },
      ...Object.fromEntries(nodesReady ? viggleToolNodes.map(name => [name, { input: { required: {} }, output: [] }]) : []) } as Catalog);
    const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188', loras: [] }, catalog: catalog(),
      client: () => ({ json: async () => catalog() }), recoverTransport: vi.fn(async () => true), emit: () => {},
      connect: vi.fn(async (_endpoint: string, _ssh: boolean) => { nodesReady = true; connection.status.state = 'online'; connection.catalog = catalog(); }) };
    const worker = vi.fn<typeof downloadPinnedModels>(async (_repo, _instance, _endpoint, files) => { for (const id of files) installed.add(id); });
    const storage = vi.fn(async () => ({ freeBytes: 10 ** 12, loras: [], files: [...installed].map(id => ({ id,
      size: modelDefinitions.find(file => file.id === id)!.size, verified: true })) }));
    manager = new ModelManager(store, connection as unknown as ConnectionManager, path.resolve(import.meta.dirname, '../..'), worker, storage);
    const tool = vi.fn(async (_id: number, _action: 'prepare' | 'status', _signal?: AbortSignal) => {
      expect(plan.files.every(id => installed.has(id))).toBe(true); return status();
    });
    manager.viggleTools = tool;
    const until = async (test: () => boolean) => { for (let i = 0; i < 200 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 5)); expect(test()).toBe(true); };
    return { connection, installed, worker, tool, until };
  }

  it('verifies all required catalog nodes rather than a saved installed-weights claim', () => {
    expect(hasViggleTools({})).toBe(false);
    for (const absent of viggleToolNodes) {
      const catalog = Object.fromEntries(viggleToolNodes.filter(name => name !== absent).map(name => [name, {}])) as Catalog;
      expect(hasViggleTools(catalog)).toBe(false);
    }
    expect(hasViggleTools(Object.fromEntries(viggleToolNodes.map(name => [name, {}])) as Catalog)).toBe(true);
    expect(plan.runtimes).toEqual(['viggle-tools']); expect(plan.files).toHaveLength(4);
  });

  it('updates only after explicit module download and probes the existing engine without SSH setup', async () => {
    const f = await fixture(); expect(f.tool).not.toHaveBeenCalled();
    await manager.prepareModule(plan); await f.until(() => !manager.state.busy);
    expect(f.tool).toHaveBeenCalledTimes(1); expect(f.tool.mock.calls[0].slice(0, 2)).toEqual([123, 'prepare']);
    expect(f.connection.connect).toHaveBeenCalledWith('http://127.0.0.1:8188', false);
    expect(manager.state.viggleToolsReady).toBe(true); expect(manager.state.moduleSetup?.status).toBe('complete');
    expect(f.worker.mock.calls.flatMap(call => call[3]).sort()).toEqual([...plan.files].sort());
  });

  it('skips the updater if the actual connected catalog is already capable', async () => {
    const f = await fixture(true); await manager.prepareModule(plan); await f.until(() => !manager.state.busy);
    expect(f.tool).not.toHaveBeenCalled(); expect(f.connection.connect).not.toHaveBeenCalled();
    expect(manager.state.viggleToolsReady).toBe(true);
  });

  it('reprobes the same running engine after its explicit idle service restart went offline', async () => {
    const f = await fixture();
    f.tool.mockImplementation(async () => { f.connection.status.state = 'offline'; return status(); });
    await manager.prepareModule(plan); await f.until(() => !manager.state.busy);
    expect(f.connection.connect).toHaveBeenCalledWith('http://127.0.0.1:8188', false);
    expect(manager.state.moduleSetup?.status).toBe('complete'); expect(manager.state.viggleToolsReady).toBe(true);
  });

  it('keeps unknown setup busy and only observes it on recovery, never launching a replacement', async () => {
    const f = await fixture(); let terminal = false;
    const tool = vi.fn(async (_id: number, action: 'prepare' | 'status') => {
      if (action === 'prepare') throw new Error('Synthetic transport loss after launch');
      return terminal ? status({ ready: false, state: 'failed' }) : status({ ready: false, unknown: true, confirmedStopped: false, state: 'unknown' });
    });
    manager.viggleTools = tool;
    await manager.prepareModule(plan); await f.until(() => manager.state.moduleSetup?.status === 'reconnecting');
    expect(manager.state.busy).toBe(true); expect(manager.state.moduleSetup?.activeRuntime).toBe('viggle-tools');
    await expect(manager.prepareModule(plan)).rejects.toThrow('existing transfers');
    await manager.recoverPending(); expect(tool.mock.calls.filter(call => call[1] === 'prepare')).toHaveLength(1);
    expect(manager.state.busy).toBe(true); terminal = true; await manager.recoverPending();
    await f.until(() => !manager.state.busy);
    expect(manager.state.moduleSetup?.status).toBe('failed'); expect(manager.state.moduleSetup?.activeRuntime).toBeUndefined();
    expect(tool.mock.calls.filter(call => call[1] === 'prepare')).toHaveLength(1); expect(f.connection.connect).not.toHaveBeenCalled();
  });

  it('keeps cancelled owned setup protected until its status confirms terminal', async () => {
    const saved = { instanceId: 123, endpoint: 'http://127.0.0.1:8188', startedAt: 1, cancelled: true, files: [],
      moduleSetup: { ...plan, instanceId: 123, endpoint: 'http://127.0.0.1:8188', transferFiles: [], status: 'cancelled',
        activeRuntime: 'viggle-tools', message: '', error: null, updatedAt: 1 } };
    const f = await fixture(false, saved);
    const tool = vi.fn(async (_id: number, _action: 'prepare' | 'status') => status({ ready: false, running: true, confirmedStopped: false, state: 'running' })); manager.viggleTools = tool;
    await manager.recoverPending(); expect(manager.state.busy).toBe(true); expect(f.worker).not.toHaveBeenCalled();
    manager.viggleTools = vi.fn(async () => status({ ready: false, state: 'failed' })); await manager.recoverPending();
    expect(manager.state.busy).toBe(false); expect(manager.state.moduleSetup?.status).toBe('cancelled');
    expect(tool.mock.calls[0]?.[1]).toBe('status');
  });

  it('shows Download for missing native tools even when the four video weights are installed', () => {
    const state = emptyModels(); for (const file of state.files) if (plan.files.includes(file.id)) file.status = 'installed';
    const render = (ready: boolean) => renderToStaticMarkup(<ModuleAction request={{ module: 'remotion', settings: selected }}
      controls={{ state, online: true, blocked: false, download: () => {}, remove: () => {} }} runtimeReady={ready}
      onGenerate={() => {}} onConnect={() => {}} onManage={() => {}} />);
    expect(render(false)).toContain('aria-label="Download Remotion"'); expect(render(true)).toContain('aria-label="Generate"');
  });
});
