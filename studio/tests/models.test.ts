import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { defaults, type Catalog, type Graph, type Job } from '../shared/types';
import { I2V_SPEED, modelBytes, modelFilesForSettings, NATURAL_SPEED, pinnedModels, RELIGHT, setupModelFiles, SOCIAL_STYLE } from '../shared/models';
import { compileWorkflow } from '../server/workflow';
import { downloadPinnedModels, installedModelIds, missingPinnedAdapters, ModelManager } from '../server/models';
import { Store } from '../server/store';
import type { ConnectionManager } from '../server/comfy';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const repo = path.resolve(import.meta.dirname, '../..');
const template: Graph = JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
const catalog: Catalog = JSON.parse(readFileSync(path.join(repo, 'integration-snapshot/object-info.json'), 'utf8'));
const makeJob = (settings = defaults): Job => ({ id: 'model-plan-test', title: 'Model test', status: 'queued', sourceId: 'source', referenceId: 'reference',
  createdAt: new Date().toISOString(), favorite: false, deleted: false, settings, uploads: { source: 'source.mp4', reference: 'reference.png' },
  width: 704, height: 1248, progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 2, completedFrames: 0, targetFrames: 120, updatedAt: Date.now() },
  context: '', segments: [], renderVersion: 'continuous-v1', pendingPrompt: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null });
const withLoras = (names: string[]) => {
  const live = structuredClone(catalog); live.LoraLoaderModelOnly.input.required!.lora_name[0] = names;
  return live;
};

afterEach(() => vi.clearAllMocks());
describe('selected-recipe model provisioning', () => {
  for (const preset of ['fast', 'natural', 'quality12', 'quality16', 'quality'] as const) for (const mode of ['swap', 'motion'] as const)
    for (const relight of [false, true]) it(`covers every active adapter for ${preset}/${mode}/relight=${relight}`, () => {
      const settings = { ...defaults, preset, mode, relight };
      const files = modelFilesForSettings(settings), graph = compileWorkflow(template, makeJob(settings));
      const adapters = Object.values(graph).filter(node => node.class_type === 'LoraLoaderModelOnly').map(node => String(node.inputs.lora_name));
      expect(files.filter(name => name.startsWith('loras/')).sort()).toEqual(adapters.map(name => 'loras/' + name).sort());
      expect(new Set(files).size).toBe(files.length);
      expect(files.filter(name => !name.startsWith('loras/'))).toHaveLength(5);
      if (preset.startsWith('quality')) { expect(graph['24']).toBeUndefined(); expect(graph['25'].inputs.model).toEqual(['23', 0]); }
    });

  it('saves exactly the inactive acceleration file, retaining the measured recipe', () => {
    const full = pinnedModels.reduce((sum, file) => sum + file.size, 0);
    const natural = modelFilesForSettings({ ...defaults, preset: 'natural' });
    expect(full - modelBytes(natural)).toBe(738005744 + 613557448);
    expect(natural).toContain('loras/' + NATURAL_SPEED); expect(natural).toContain('loras/' + RELIGHT);
    expect(modelFilesForSettings(defaults)).toEqual(natural);
    expect(new Set(natural)).toEqual(new Set(setupModelFiles));
    expect(natural).not.toContain('loras/' + SOCIAL_STYLE);
  });

  it('does not preload relighting when disabled, in motion mode, or at zero strength', () => {
    for (const settings of [{ ...defaults, relight: false }, { ...defaults, relightStrength: 0 }, { ...defaults, mode: 'motion' as const }]) {
      expect(modelFilesForSettings(settings)).not.toContain('loras/' + RELIGHT);
      expect(compileWorkflow(template, makeJob(settings))['50']).toBeUndefined();
    }
  });

  it('includes an otherwise inactive pinned adapter when explicitly chosen in a user slot', () => {
    expect(modelFilesForSettings({ ...defaults, preset: 'quality', loraA: NATURAL_SPEED })).toContain('loras/' + NATURAL_SPEED);
    expect(modelFilesForSettings({ ...defaults, loraA: 'user/identity.safetensors' })).not.toContain('loras/user/identity.safetensors');
    expect(() => modelBytes(['loras/unpinned.safetensors'])).toThrow('Unknown');
  });

  it('requests only missing pinned adapters and rejects absent user files before downloading', () => {
    const graph = compileWorkflow(template, makeJob({ ...defaults, preset: 'natural' }));
    const installed = pinnedModels.filter(file => file.destination.startsWith('loras/') && !file.destination.endsWith(NATURAL_SPEED))
      .map(file => file.destination.slice(6));
    expect(missingPinnedAdapters(graph, withLoras(installed))).toEqual(['loras/' + NATURAL_SPEED]);
    expect(missingPinnedAdapters(graph, withLoras([...installed, NATURAL_SPEED]))).toEqual([]);
    graph['22'].inputs.lora_name = 'user/missing.safetensors';
    expect(() => missingPinnedAdapters(graph, withLoras(installed))).toThrow('Upload the selected custom LoRA');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not require either acceleration filename for Quality', () => {
    const graph = compileWorkflow(template, makeJob({ ...defaults, preset: 'quality', relight: false }));
    expect(missingPinnedAdapters(graph, withLoras(['wan2.1_SCAIL_2_DPO_lora_bf16.safetensors']))).toEqual([]);
    expect(modelFilesForSettings({ ...defaults, preset: 'quality' })).not.toContain('loras/' + I2V_SPEED);
  });
  it('omits the disabled detail adapter without breaking the relighting or sampler chain', () => {
    const settings = { ...defaults, dpoStrength: 0 }, graph = compileWorkflow(template, makeJob(settings));
    expect(graph['21']).toBeUndefined(); expect(graph['50'].inputs.model).toEqual(['20', 0]);
    expect(modelFilesForSettings(settings).some(name => name.includes('_DPO_'))).toBe(false);
    const withoutRelight = compileWorkflow(template, makeJob({ ...settings, relight: false }));
    expect(withoutRelight['22'].inputs.model).toEqual(['20', 0]);
  });
});

describe('explicit file delivery', () => {
  const fakeChild = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    return child;
  };

  it('refuses unmanaged endpoints and already cancelled requests without starting a worker', () => {
    const signal = new AbortController().signal;
    expect(() => downloadPinnedModels(repo, null, 'http://127.0.0.1:8188', [], signal, () => {})).toThrow('managed GPU');
    expect(() => downloadPinnedModels(repo, 123, 'http://127.0.0.1:9000', [], signal, () => {})).toThrow('managed GPU');
    expect(() => downloadPinnedModels(repo, 123, 'http://127.0.0.1:8188', [], AbortSignal.abort(new Error('Cancelled')), () => {})).toThrow('Cancelled');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports real download counters, verifies completion and sends only pinned model destinations', async () => {
    const child = fakeChild(), progress = vi.fn();
    const pending = downloadPinnedModels(repo, 123, 'http://127.0.0.1:8188', ['loras/' + NATURAL_SPEED], new AbortController().signal, progress);
    child.stdout.write('Downloading adapter.safetensors (0.00 / 0.63 GB)\n  adapter.safetensors: 25%\nVerified: adapter.safetensors\n');
    child.emit('close', 0); await pending;
    expect(progress).toHaveBeenCalledWith('Downloading adapter.safetensors', 25);
    expect(progress).toHaveBeenCalledWith('File verified');
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--instance-id'); expect(args).toContain('123');
    const files = JSON.parse(args[args.indexOf('--model-files') + 1]);
    expect(files.filter((name: string) => name.startsWith('loras/'))).toEqual(['loras/' + NATURAL_SPEED]);
    expect(args).not.toContain('start'); expect(args).not.toContain('launch');
  });
  it('uses exact byte telemetry and shows checksum verification as a separate stage', async () => {
    const child = fakeChild(), progress = vi.fn(), file = 'loras/' + NATURAL_SPEED;
    const pending = downloadPinnedModels(repo, 123, 'http://127.0.0.1:8188', [file], new AbortController().signal, progress);
    const message = (downloaded: number, phase: string) => 'RECAST_MODEL_PROGRESS ' + JSON.stringify({ destination: file, downloaded, total: 630697104, phase }) + '\n';
    child.stdout.write(message(315348552, 'downloading') + message(630697104, 'verifying') + message(630697104, 'ready'));
    child.emit('close', 0); await pending;
    expect(progress.mock.calls.map(call => call.slice(0, 2))).toEqual([['Downloading model file', 50], ['Verifying SHA256', null], ['File verified', 100]]);
    expect(progress.mock.calls[0][2]).toMatchObject({ downloaded: 315348552, total: 630697104 });
  });

  it('surfaces failed transfers without returning success or attempting a render', async () => {
    const child = fakeChild();
    const pending = downloadPinnedModels(repo, 123, 'http://127.0.0.1:8188', ['loras/' + NATURAL_SPEED], new AbortController().signal, () => {});
    const check = expect(pending).rejects.toThrow('Partial files are retained');
    child.stderr.write('Model access failed (HTTP 403)\n'); child.emit('close', 1); await check;
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('cancels the transfer worker without stopping the GPU or submitting a job', async () => {
    const child = fakeChild(), controller = new AbortController();
    const pending = downloadPinnedModels(repo, 123, 'http://127.0.0.1:8188', ['loras/' + NATURAL_SPEED], controller.signal, () => {});
    const check = expect(pending).rejects.toThrow('Cancelled');
    controller.abort(new Error('Cancelled')); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null); await check; expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('manual model queue', () => {
  let store: Store | undefined, manager: ModelManager | undefined, root = '';
  afterEach(async () => { await manager?.cancel(); manager = undefined; store?.close(); store = undefined; if (root) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    root = await mkdtemp(path.join(os.tmpdir(), 'recast-manual-models-')); store = new Store(root); store.set('cloud-connected-instance', 123);
    const choices: string[] = [], live: Catalog = { LoraLoaderModelOnly: { input: { required: { lora_name: [choices] } }, output: ['MODEL'] } };
    const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188', loras: [] }, client: () => ({ json: vi.fn(async () => live) }), emit: vi.fn() };
    const controls = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    const worker = vi.fn<typeof downloadPinnedModels>(async (_repo, _id, _endpoint, files, signal, progress) => {
      expect(files).toHaveLength(1); const file = files[0]; progress('Downloading ' + file, 23);
      await new Promise<void>((resolve, reject) => { controls.set(file, { resolve: () => { choices.push(file.slice(file.lastIndexOf('/') + 1)); resolve(); }, reject }); signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); });
    });
    const storage = vi.fn(async (_repo: string, _id: number, action: 'inventory' | 'delete', name?: string) => {
      if (action === 'delete') { const index = choices.indexOf(name!); if (index >= 0) choices.splice(index, 1); return { name, freedBytes: 123, removed: true }; }
      return { loras: choices.map(name => ({ name, size: 123, included: setupModelFiles.includes('loras/' + name) })) };
    });
    manager = new ModelManager(store, connection as unknown as ConnectionManager, repo, worker, storage);
    const untilIdle = async () => { for (let i = 0; i < 100 && manager!.state.busy; i++) await new Promise(resolve => setTimeout(resolve, 5)); expect(manager!.state.busy).toBe(false); };
    return { manager, worker, storage, controls, connection, choices, untilIdle };
  }
  it('refreshes availability without downloading and installs only an explicitly clicked file', async () => {
    const { manager, worker, controls, untilIdle } = await fixture(), file = 'loras/' + NATURAL_SPEED;
    await manager.refresh(); expect(worker).not.toHaveBeenCalled(); expect(manager.state.files.every(file => file.status === 'missing')).toBe(true);
    await manager.start([file]); await manager.start([file]); expect(worker).toHaveBeenCalledTimes(1);
    expect(manager.state.files.find(item => item.id === file)).toMatchObject({ status: 'downloading', percent: 23 });
    controls.get(file)!.resolve(); await untilIdle();
    expect(manager.state.files.find(item => item.id === file)?.status).toBe('installed');
    expect(manager.state.files.filter(item => item.status === 'installed').map(item => item.id)).toEqual([file]);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('keeps at most four transfers active, exposes failures and retries only when requested', async () => {
    const { manager, worker, controls, untilIdle } = await fixture(); const files = pinnedModels.slice(0, 5).map(file => file.destination);
    await manager.start(files); expect(worker).toHaveBeenCalledTimes(4);
    controls.get(files[0])!.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); expect(worker).toHaveBeenCalledTimes(5);
    controls.get(files[1])!.reject(new Error('Checksum mismatch')); for (const file of files.slice(2)) controls.get(file)!.resolve(); await untilIdle();
    expect(manager.state.files.find(file => file.id === files[1])).toMatchObject({ status: 'failed', error: 'Checksum mismatch' });
    await manager.refresh(); expect(worker).toHaveBeenCalledTimes(5);
    await manager.start([files[1]]); expect(worker).toHaveBeenCalledTimes(6); controls.get(files[1])!.resolve(); await untilIdle();
    expect(manager.state.files.find(file => file.id === files[1])?.status).toBe('installed');
  });
  it('cancels active and queued transfers without an automatic retry or lifecycle action', async () => {
    const { manager, worker } = await fixture(); const files = pinnedModels.slice(0, 5).map(file => file.destination);
    await manager.start(files); await manager.cancel();
    expect(worker).toHaveBeenCalledTimes(4); expect(manager.state.busy).toBe(false);
    expect(manager.state.files.every(file => !['queued', 'downloading', 'failed'].includes(file.status))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('rejects unpinned files and offline downloads without starting a worker', async () => {
    const { manager, worker, connection } = await fixture();
    await expect(manager.start(['loras/untrusted.safetensors'])).rejects.toThrow('known model');
    connection.status.state = 'offline'; await expect(manager.start([pinnedModels[0].destination])).rejects.toThrow('running GPU');
    expect(worker).not.toHaveBeenCalled();
  });
  it('counts only filenames actually present in ComfyUI, including the shared encoders and tracker', () => {
    const installed = installedModelIds(catalog);
    expect(installed.has('diffusion_models/wan2.1_14B_SCAIL_2_int8_convrot.safetensors')).toBe(true);
    expect(installed.has('checkpoints/sam3.1_multiplex_fp16.safetensors')).toBe(true);
    expect(installed.has('text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors')).toBe(true);
    expect(installedModelIds({}).size).toBe(0);
  });
  it('removes only optional LoRAs, refreshes choices, and clears the current draft selection', async () => {
    const { manager, storage, choices, connection, worker } = await fixture();
    choices.push(SOCIAL_STYLE); const draft = store!.draft(); draft.settings.loraA = SOCIAL_STYLE; store!.set('draft', draft);
    const result = await manager.remove(SOCIAL_STYLE);
    expect(result.freedBytes).toBe(123); expect(connection.status.loras).not.toContain(SOCIAL_STYLE);
    expect(store!.draft().settings.loraA).toBe('None'); expect(manager.state.files.find(f => f.id === 'loras/' + SOCIAL_STYLE)?.status).toBe('missing');
    expect(storage).toHaveBeenCalledWith(repo, 123, 'delete', SOCIAL_STYLE); expect(worker).not.toHaveBeenCalled(); expect(manager.state.busy).toBe(false);
    choices.push(NATURAL_SPEED); await manager.remove(NATURAL_SPEED);
    await expect(manager.remove('../outside.safetensors')).rejects.toThrow('valid');
    expect(storage.mock.calls.filter(c => c[2] === 'delete')).toHaveLength(2);
  });
  it('blocks deletion during a transfer and new downloads while deletion is pending', async () => {
    const { manager, choices, storage } = await fixture();
    await manager.start(['loras/' + I2V_SPEED]);
    await expect(manager.remove(SOCIAL_STYLE)).rejects.toThrow('active transfers'); await manager.cancel();
    let finish!: () => void; storage.mockImplementationOnce(async (_repo, _id, _action, name) => { await new Promise<void>(resolve => { finish = resolve; }); return { name, freedBytes: 12, removed: true }; });
    choices.push(SOCIAL_STYLE); const pending = manager.remove(SOCIAL_STYLE);
    expect(manager.state.deleting).toBe(SOCIAL_STYLE);
    await expect(manager.start(['loras/' + I2V_SPEED])).rejects.toThrow('removal');
    finish(); await pending;
  });
});
