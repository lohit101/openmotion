import { openAsBlob } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import WebSocket from 'ws';
import type { Catalog, Connection, Graph, Job } from '../shared/types';
import { stageNames } from '../shared/types';
import type { Store } from './store';
import { command } from './media';

export class OfflineError extends Error {}
export function localEndpoint(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a local ComfyUI address, such as http://127.0.0.1:8188. Remote access goes through the SSH tunnel.');
  return url.origin;
}
export class ComfyClient {
  constructor(public endpoint: string) {}
  async json(route: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    let response: Response;
    try { response = await fetch(this.endpoint + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }); }
    catch (error) { if (signal?.aborted) throw error; throw new OfflineError('The GPU connection was lost. Reconnect to check the existing job before retrying.'); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error?.message || value.error || `ComfyUI returned HTTP ${response.status}.`);
    return value;
  }
  async upload(file: string, id: string, signal: AbortSignal) {
    const form = new FormData(); form.append('image', await openAsBlob(file), id + path.extname(file)); form.append('type', 'input');
    let response: Response;
    try { response = await fetch(this.endpoint + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) }); }
    catch (error) { if (signal.aborted) throw error; throw new OfflineError('Input transfer was interrupted. Reconnect and resume.'); }
    if (!response.ok) throw new Error(`Input transfer failed (${response.status}).`);
    const result = await response.json() as { name: string; subfolder?: string };
    return [result.subfolder, result.name].filter(Boolean).join('/');
  }
  async download(entry: { filename: string; subfolder?: string; type?: string }, dest: string, signal: AbortSignal) {
    const query = new URLSearchParams({ filename: entry.filename, subfolder: entry.subfolder || '', type: entry.type || 'output' });
    try {
      const response = await fetch(this.endpoint + '/view?' + query, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
      if (!response.ok || !response.body) throw new OfflineError('The completed segment could not be downloaded. Reconnect and resume to retry the download.');
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(dest + '.part'), { signal });
      await rename(dest + '.part', dest);
    } catch (error) { if (signal.aborted || error instanceof OfflineError) throw error; throw new OfflineError('The segment download was interrupted. Reconnect and resume to retry the download.'); }
  }
  watch(clientId: string, receive: (event: any) => void): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.endpoint.replace(/^http/, 'ws') + '/ws?clientId=' + encodeURIComponent(clientId), { handshakeTimeout: 6000, maxPayload: 16 * 1024 ** 2 });
      socket.once('open', () => resolve(socket));
      socket.on('message', (data, binary) => { if (!binary) { try { receive(JSON.parse(data.toString())); } catch { /* Non-JSON frames cannot update job state. */ } } });
      socket.on('error', reject);
    });
  }
  cancel(id: string) { return this.json('/api/jobs/' + encodeURIComponent(id) + '/cancel', {}); }
}
export function applyProgress(job: Job, event: any): boolean {
  const data = event?.data;
  if (!data || (data.prompt_id && job.pendingPrompt && data.prompt_id !== job.pendingPrompt)) return false;
  if (event.type === 'execution_start') { if (!job.pendingPrompt) job.pendingPrompt = data.prompt_id; job.progress.stage = 'Starting GPU job'; job.progress.updatedAt = Date.now(); return true; }
  let node: string | null = null, value: number | null = null, max: number | null = null;
  if (event.type === 'executing' && data.node != null) node = String(data.node);
  else if (event.type === 'progress') { node = data.node != null ? String(data.node) : job.progress.node; value = Number(data.value); max = Number(data.max); }
  else if (event.type === 'progress_state') {
    const running = Object.values(data.nodes || {}).find((n: any) => n.state === 'running') as any;
    if (running) { node = String(running.node_id); value = Number(running.value); max = Number(running.max); }
  }
  if (node === null) return false;
  const validCounter = value !== null && max !== null && Number.isFinite(value) && Number.isFinite(max) && max > 0;
  job.progress = { ...job.progress, node, stage: stageNames[node] || 'Processing video', value: validCounter ? Math.min(max!, Math.max(0, value!)) : null,
    max: validCounter ? max : null, unit: node === '43' ? 'steps' : ['9', '10'].includes(node) ? 'frames' : 'items', updatedAt: Date.now() };
  job.status = 'running'; return true;
}
export class ConnectionManager {
  status: Connection; catalog: Catalog;
  constructor(public store: Store, public repo: string, catalog: Catalog) {
    this.catalog = catalog;
    this.status = { state: 'offline', endpoint: store.value('endpoint', process.env.COMFY_URL || 'http://127.0.0.1:8188'), gpu: null,
      message: 'Local workspace. Connect your GPU when you are ready to generate.', checkedAt: null, loras: lorasFrom(catalog) };
  }
  client() { return new ComfyClient(this.status.endpoint); }
  emit() { this.store.emit('event', { type: 'connection', data: this.status }); }
  async connect(endpoint: string, useSSH: boolean) {
    if (this.status.state === 'connecting') return;
    this.status.endpoint = localEndpoint(endpoint); this.store.set('endpoint', this.status.endpoint);
    this.status.state = 'connecting'; this.status.message = 'Checking the private GPU connection'; this.emit();
    try {
      try { await this.client().json('/system_stats'); }
      catch (error) {
        if (!useSSH) throw error;
        this.status.message = 'Restoring the saved SSH tunnel'; this.emit();
        await command('python3', [path.join(this.repo, 'scripts/vast.py'), 'open', '--no-browser'], undefined, 35000);
      }
      const [stats, catalog] = await Promise.all([this.client().json('/system_stats'), this.client().json('/object_info')]);
      const gpu = stats.devices?.find((d: any) => /cuda/i.test(d.type || d.name));
      if (!gpu) throw new Error('ComfyUI is reachable, but an NVIDIA GPU is not available.');
      this.catalog = catalog; this.status = { ...this.status, state: 'online', gpu: gpu.name.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, ''),
        loras: lorasFrom(catalog), checkedAt: new Date().toISOString(), message: 'Ready for generation' };
    } catch (error) { this.status.state = 'offline'; this.status.message = 'Start your Vast instance, then reconnect. ' + (error instanceof Error ? error.message : String(error)).slice(0, 240); }
    this.emit();
  }
  disconnect(message = 'GPU disconnected. Your local workspace and library are available.') { this.status.state = 'offline'; this.status.message = message; this.emit(); }
}
export function lorasFrom(catalog: Catalog) { return (catalog.LoraLoaderModelOnly?.input.required?.lora_name?.[0] as string[] || []).filter(n => n !== 'None'); }
