import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Catalog, Graph } from '../shared/types';
import { emptyModels, IMAGE_IDENTITY, modelDefinitions, modelWorkingReserve, pinnedModels, type InstalledLora, type ModelInventory, type ModelsState, type ModelTransfer } from '../shared/models';
import { inventoryKey } from '../shared/downloads';
import type { Store } from './store';
import { lorasFrom, type ConnectionManager } from './comfy';
import { command } from './media';
import { facialCommand } from './facial-consistency';
import type { FacialConsistencyRun } from '../shared/facial-consistency';

export async function manageModelStorage(repo: string, instanceId: number, action: 'inventory' | 'delete', name?: string): Promise<{ loras?: InstalledLora[]; files?: { id: string; size: number; verified?: boolean }[]; name?: string; freedBytes?: number; freeBytes?: number; partials?: { id: string; size: number }[]; removed?: boolean; facialRuntimeReady?: boolean; facialCleanupRuntimeReady?: boolean; facialCalibratedRuntimeReady?: boolean; facialEyeFinishRuntimeReady?: boolean; facialGeometryRuntimeReady?: boolean; facialBoundaryRuntimeReady?: boolean }> {
  const args = ['-u', path.join(repo, 'scripts/managed_models.py'), '--instance-id', String(instanceId), '--action', action];
  if (action === 'delete') args.push('--lora', name!);
  const output = await command('python3', args, undefined, 45000);
  const line = output.split(/\r?\n/).find(line => line.startsWith('RECAST_MODEL_STORAGE '));
  if (!line) throw new Error('The GPU did not return a model storage result.');
  return JSON.parse(line.slice(21));
}

export function missingPinnedAdapters(graph: Graph, catalog: Catalog): string[] {
  const installed = catalog.LoraLoaderModelOnly?.input.required?.lora_name?.[0];
  if (!Array.isArray(installed)) throw new Error('ComfyUI did not return its installed LoRA list.');
  const wanted = [...new Set(Object.values(graph).filter(node => ['LoraLoaderModelOnly', 'SwapOptionalLoRA'].includes(node.class_type))
    .map(node => String(node.inputs.lora_name)).filter(name => name !== 'None' && !installed.includes(name)))];
  const files = wanted.map(name => pinnedModels.find(file => file.destination === 'loras/' + name)?.destination);
  const unknown = wanted.filter((_, index) => !files[index]);
  if (unknown.length) throw new Error('Upload the selected custom LoRA before generating: ' + unknown.join(', '));
  return files as string[];
}

// No elapsed-time cutoff for a healthy transfer. The downloader provides
// bounded retries, resumable partials and pinned SHA256 verification.
export function downloadPinnedModels(repo: string, instanceId: number | null, endpoint: string, files: string[], signal: AbortSignal,
  progress: (message: string, percent?: number | null, transfer?: ModelTransfer) => void): Promise<void> {
  signal.throwIfAborted();
  if (!instanceId || endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU through GPU cloud before downloading models.');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-u', path.join(repo, 'scripts/managed_models.py'), '--instance-id', String(instanceId),
      '--model-files', JSON.stringify(files)], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let buffer = '', tail = '';
    const aborted = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Already finished. */ } };
    signal.addEventListener('abort', aborted, { once: true });
    const receive = (chunk: Buffer) => {
      buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        tail = line.slice(-900);
        if (line.startsWith('RECAST_MODEL_PROGRESS ')) {
          try {
            const event = JSON.parse(line.slice(22));
            if (!files.includes(event.destination) || !Number.isFinite(event.downloaded) || event.downloaded < 0 || event.downloaded > event.total || event.total !== pinnedModels.find(file => file.destination === event.destination)?.size) continue;
            progress(event.phase === 'verifying' ? 'Verifying SHA256' : event.phase === 'ready' ? 'File verified' : 'Downloading model file',
              event.phase === 'verifying' ? null : Math.min(100, Math.max(0, Math.floor(100 * event.downloaded / event.total))),
              { downloaded: event.downloaded, total: event.total, bytesPerSecond: Number.isFinite(event.bytesPerSecond) && event.bytesPerSecond >= 0 ? event.bytesPerSecond : undefined });
          } catch { /* Ignore malformed telemetry; normal process exit still decides success. */ }
          continue;
        }
        const counter = line.match(/^\s+(.+\.safetensors): (\d+)%$/);
        if (counter) progress('Downloading ' + counter[1], Math.min(100, Number(counter[2])));
        else if (line.startsWith('RECAST_FACIAL_STAGE ')) progress(line.slice(20), null);
        else if (line.startsWith('Downloading ')) progress(line.slice(0, 220));
        else if (line.startsWith('Verified: ')) progress('File verified');
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const cleanup = () => signal.removeEventListener('abort', aborted);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); if (signal.aborted) reject(signal.reason); else if (code === 0) resolve(); else reject(new Error('Model download failed. Partial files are retained for retry. ' + (buffer.trim() || tail).slice(-900))); });
    if (signal.aborted) aborted();
  });
}

export function installedModelIds(catalog: Catalog): Set<string> {
  const choices = new Set<string>();
  for (const node of Object.values(catalog)) for (const rule of Object.values({ ...node.input.required, ...node.input.optional })) {
    if (Array.isArray(rule[0])) for (const value of rule[0]) if (typeof value === 'string') choices.add(value);
  }
  return new Set(modelDefinitions.filter(file => choices.has(file.filename)).map(file => file.id));
}

type DownloadWorker = typeof downloadPinnedModels;
export class ModelManager {
  state: ModelsState = emptyModels();
  private queue = new Set<string>(); private controller: AbortController | null = null;
  private work: Promise<void> | null = null; private refreshing: Promise<ModelsState> | null = null;
  private preparing = 0; private cancelEpoch = 0;
  constructor(public store: Store, public connection: ConnectionManager, public repo: string, private download: DownloadWorker = downloadPinnedModels, private storage: typeof manageModelStorage = manageModelStorage) {
    this.state.inventories = store.value<ModelInventory[]>('model-inventories', []);
  }
  emit() { this.store.emit('event', { type: 'models', data: this.state }); }
  async refresh(): Promise<ModelsState> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.state.refreshing = true; this.emit();
      try {
        if (this.connection.status.state !== 'online') {
          for (const file of this.state.files) if (!['queued', 'downloading'].includes(file.status)) Object.assign(file, { status: 'unknown', percent: null });
          this.state.error = null; this.state.checkedAt = null; this.state.installedLoras = []; this.state.diskFreeBytes = undefined; return this.state;
        }
        const instanceId = this.store.value<number | null>('cloud-connected-instance', null), endpoint = this.connection.status.endpoint;
        const catalog: Catalog = await this.connection.client().json('/object_info');
        const sameConnection = () => this.connection.status.state === 'online' && this.connection.status.endpoint === endpoint && this.store.value('cloud-connected-instance', null) === instanceId;
        if (!sameConnection()) throw new Error('The GPU changed during the inventory check. Refresh its files again.');
        const installed = installedModelIds(catalog);
        for (const file of this.state.files) if (!['queued', 'downloading'].includes(file.status)) {
          if (installed.has(file.id)) Object.assign(file, { status: 'installed', percent: 100, error: null, message: 'Available on this GPU' });
          else if (file.status !== 'failed') Object.assign(file, { status: 'missing', percent: null, message: '', downloaded: 0 });
        }
        this.connection.catalog = catalog;
        let inventory: Awaited<ReturnType<typeof manageModelStorage>> | undefined;
        if (instanceId && this.connection.status.endpoint === 'http://127.0.0.1:8188') {
          const result = await this.storage(this.repo, instanceId, 'inventory');
          inventory = result;
          this.state.installedLoras = result.loras || [];
          this.state.diskFreeBytes = Number.isFinite(result.freeBytes) && result.freeBytes! >= 0 ? result.freeBytes : undefined;
          this.state.facialRuntimeReady = !!result.facialRuntimeReady;
          this.state.facialCleanupRuntimeReady = !!result.facialCleanupRuntimeReady;
          this.state.facialCalibratedRuntimeReady = !!result.facialCalibratedRuntimeReady;
          this.state.facialEyeFinishRuntimeReady = !!result.facialEyeFinishRuntimeReady;
          this.state.facialGeometryRuntimeReady = !!result.facialGeometryRuntimeReady;
          this.state.facialBoundaryRuntimeReady = !!result.facialBoundaryRuntimeReady;
          for (const file of this.state.files.filter(item => item.id.startsWith('face_consistency/'))) {
            if (['queued', 'downloading'].includes(file.status)) continue;
            const present = result.files?.find(item => item.id === file.id);
            if (present?.verified && present.size === pinnedModels.find(item => item.destination === file.id)?.size) Object.assign(file, { status: 'installed', percent: 100, error: null, message: 'Verified on this GPU' });
          }
          if (result.partials) for (const file of this.state.files) if (!['installed', 'queued', 'downloading'].includes(file.status)) {
            const size = result.partials.find(partial => partial.id === file.id)?.size || 0;
            file.downloaded = Number.isFinite(size) && size >= 0 ? Math.min(size, pinnedModels.find(model => model.destination === file.id)!.size) : 0;
          }
        }
        if (!sameConnection()) throw new Error('The GPU changed during the inventory check. Refresh its files again.');
        const loras = lorasFrom(catalog);
        if (JSON.stringify(loras) !== JSON.stringify(this.connection.status.loras)) { this.connection.status.loras = loras; this.connection.emit(); }
        this.state.error = null; this.state.checkedAt = new Date().toISOString();
        // A saved inventory is informational. It never makes an offline GPU
        // ready or authorizes downloads on another rental.
        if (this.connection.status.state === 'online' && this.connection.status.endpoint === endpoint && this.store.value('cloud-connected-instance', null) === instanceId) {
          const files = new Map<string, { id: string; size: number; partialSize: number; measured: boolean }>();
          for (const id of installed) files.set(id, { id, size: pinnedModels.find(file => file.destination === id)!.size, partialSize: 0, measured: false });
          for (const file of inventory?.files || []) if (Number.isFinite(file.size) && file.size >= 0) files.set(file.id, { id: file.id, size: file.size, partialSize: 0, measured: true });
          for (const lora of inventory?.loras || []) files.set('loras/' + lora.name, { id: 'loras/' + lora.name, size: lora.size, partialSize: lora.partialSize || 0, measured: true });
          for (const partial of inventory?.partials || []) {
            const file = files.get(partial.id) || { id: partial.id, size: 0, partialSize: 0, measured: true };
            file.partialSize = partial.size; files.set(file.id, file);
          }
          const snapshot: ModelInventory = { key: inventoryKey(instanceId, endpoint), instanceId, endpoint, gpu: this.connection.status.gpu || null,
            checkedAt: this.state.checkedAt, files: [...files.values()], freeBytes: this.state.diskFreeBytes };
          this.state.inventories = [snapshot, ...(this.state.inventories || []).filter(item => item.key !== snapshot.key)];
          this.store.set('model-inventories', this.state.inventories);
        }
      } catch (error) {
        this.state.error = 'Model availability could not be checked. Reconnect the GPU and refresh. ' + (error as Error).message;
        for (const file of this.state.files) if (!['queued', 'downloading'].includes(file.status)) file.status = 'unknown';
      } finally { this.state.refreshing = false; this.emit(); }
      return this.state;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async start(files: string[]) {
    if (this.state.deleting) throw new Error('Wait for the LoRA removal to finish.');
    if (!files.length || files.length > modelDefinitions.length || files.some(id => !modelDefinitions.some(file => file.id === id))) throw new Error('Choose known model files from the download list.');
    if (this.connection.status.state !== 'online') throw new Error('Connect a running GPU before downloading models.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null), endpoint = this.connection.status.endpoint;
    if (!instanceId || endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU through GPU cloud before downloading models.');
    const epoch = this.cancelEpoch;
    this.preparing++; this.state.busy = true; this.emit();
    try {
      await this.refresh(); if (this.state.error) throw new Error(this.state.error);
      if (epoch !== this.cancelEpoch) throw new Error('Download request cancelled.');
      if (this.connection.status.state !== 'online' || this.store.value('cloud-connected-instance', null) !== instanceId) throw new Error('The GPU connection changed. Reconnect before downloading.');
      const planned = new Set([...files, ...this.queue, ...this.state.files.filter(file => file.status === 'downloading').map(file => file.id)]);
      const remaining = this.state.files.filter(file => planned.has(file.id) && file.status !== 'installed').reduce((sum, file) => {
        const size = pinnedModels.find(model => model.destination === file.id)!.size;
        return sum + size - Math.min(size, Math.max(0, file.downloaded || 0));
      }, 0);
      const required = remaining + modelWorkingReserve([...planned]);
      if (remaining && this.state.diskFreeBytes !== undefined && this.state.diskFreeBytes < required) throw new Error(`These files need ${(required / 1e9).toFixed(2)} GB free including working space; this GPU has ${(this.state.diskFreeBytes / 1e9).toFixed(2)} GB. No new download was started. Use a larger disk or remove unused extras first.`);
      for (const id of files) {
        const file = this.state.files.find(file => file.id === id)!;
        if (['installed', 'queued', 'downloading'].includes(file.status)) continue;
        Object.assign(file, { status: 'queued', percent: null, error: null, message: 'Waiting to download' }); this.queue.add(id);
      }
      if (this.queue.size && !this.work) {
        this.controller = new AbortController(); this.state.busy = true;
        const signal = this.controller.signal;
        const worker = async () => {
          while (this.queue.size && !signal.aborted) {
            const id = this.queue.values().next().value!; this.queue.delete(id);
            const file = this.state.files.find(file => file.id === id)!;
            Object.assign(file, { status: 'downloading', message: 'Connecting to download', percent: null }); this.emit();
            const warning = setTimeout(() => { file.message = 'Taking longer than usual. Download is still running.'; this.emit(); }, 15 * 60000);
            try {
              await this.download(this.repo, instanceId, endpoint, [id], signal, (message, percent, transfer) => {
                if (signal.aborted) return;
                file.message = message; if (percent !== undefined) file.percent = percent; if (transfer) Object.assign(file, transfer); this.emit();
              });
              Object.assign(file, { status: 'installed', percent: 100, message: 'Downloaded and SHA256 verified', error: null });
            } catch (error) {
              Object.assign(file, { status: signal.aborted ? 'missing' : 'failed', percent: null,
                message: signal.aborted ? 'Cancelled. Partial files are kept for resume.' : 'Download failed', error: signal.aborted ? null : (error as Error).message });
            } finally { clearTimeout(warning); this.emit(); }
          }
        };
        this.work = Promise.all([worker(), worker(), worker(), worker()]).then(async () => {
          this.state.busy = this.preparing > 0; this.controller = null; this.work = null; await this.refresh();
        });
      }
      this.emit(); return this.state;
    } finally { this.preparing--; this.state.busy = !!this.work || this.preparing > 0; this.emit(); }
  }
  async cancel() {
    this.cancelEpoch++;
    this.queue.clear(); this.controller?.abort(new Error('Cancelled.'));
    for (const file of this.state.files) if (file.status === 'queued') Object.assign(file, { status: 'missing', message: 'Cancelled. Click download to resume.', percent: null });
    await this.work; this.emit(); return this.state;
  }
  async prepareFacialTools(version: FacialConsistencyRun['version'] = 'source-face-v6') {
    if (this.state.busy) throw new Error('Wait for model storage work to finish.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null);
    if (!instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU before preparing facial tools.');
    this.preparing++; this.state.busy = true; this.emit();
    try {
      await facialCommand(this.repo, ['--instance-id', String(instanceId), '--action', 'prepare', '--version', version]);
      if (this.store.value('cloud-connected-instance', null) !== instanceId) throw new Error('GPU changed during facial-tool setup.');
      await this.refresh(); return this.state;
    } finally { this.preparing--; this.state.busy = !!this.work || this.preparing > 0; this.emit(); }
  }
  async remove(name: string) {
    if (this.state.busy) throw new Error('Finish or cancel active transfers before removing a LoRA.');
    if (!name || name.length > 300 || /[\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || !name.endsWith('.safetensors')) throw new Error('Choose a valid LoRA filename.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null);
    if (!instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU before removing LoRAs.');
    this.state.busy = true; this.state.deleting = name; this.emit();
    try {
      const result = await this.storage(this.repo, instanceId, 'delete', name);
      if (result.name !== name || !Number.isFinite(result.freedBytes) || result.freedBytes! < 0) throw new Error('The GPU did not confirm this LoRA removal. Refresh its storage before retrying.');
      const draft = this.store.draft();
      if (draft.settings.loraA === name) draft.settings.loraA = 'None';
      if (draft.settings.loraB === name) draft.settings.loraB = 'None';
      this.store.set('draft', draft);
      if (name === IMAGE_IDENTITY) { const imageDraft = this.store.imageDraft(); imageDraft.settings.identityRefine = false; this.store.set('image-draft', imageDraft); }
      const file = this.state.files.find(file => file.id === 'loras/' + name);
      if (file) Object.assign(file, { status: 'missing', percent: null, message: '', error: null });
      this.store.emit('event', { type: 'lora-removed', data: result });
      if (this.refreshing) await this.refreshing;
      await this.refresh(); return { ...result, models: this.state };
    } finally { this.state.busy = false; this.state.deleting = null; this.emit(); }
  }
}
