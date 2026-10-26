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
const RETRYABLE_READ_STATUS = new Set([429, 500, 502, 503, 504]);
const READ_ATTEMPTS = 3;

function readBackoff(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', aborted); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason || new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function responseMessage(value: unknown, status: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = (value as { error?: unknown }).error;
    const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : null;
    // Do not stringify arbitrary provider payloads, request errors or HTML.
    if (message?.trim() && !/<(?:html|script|body)\b/i.test(message)) return message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
  }
  return `ComfyUI returned HTTP ${status}.`;
}

export function localEndpoint(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a local ComfyUI address, such as http://127.0.0.1:8188. Remote access goes through the SSH tunnel.');
  return url.origin;
}
export class ComfyClient {
  constructor(public endpoint: string, public recover?: (signal?: AbortSignal) => Promise<boolean>) {}
  async json(route: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const read = body === undefined, attempts = read ? READ_ATTEMPTS : 1;
    let recoveryTried = false;
    const restore = async () => {
      if (!read || recoveryTried || !this.recover || !/^\/(history|queue)(\/|\?|$)/.test(route)) return false;
      recoveryTried = true; signal?.throwIfAborted();
      try { return await this.recover(signal); } catch (error) { if (signal?.aborted) throw signal.reason || error; return false; }
    };
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      let response: Response, value: unknown;
      try {
        const deadline = AbortSignal.timeout(read ? 45000 : 12000);
        response = await fetch(this.endpoint + route, { method: read ? 'GET' : 'POST', headers: read ? {} : { 'Content-Type': 'application/json' }, body: read ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
        try { value = await response.json(); }
        catch (error) {
          if (signal?.aborted) throw error;
          if (response.ok) throw new OfflineError('ComfyUI returned an unreadable response. Reconnect to check the existing job before retrying.');
        }
        if (response.ok && (!value || typeof value !== 'object' || Array.isArray(value))) throw new OfflineError('ComfyUI returned an invalid response. Reconnect to check the existing job before retrying.');
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        if (read && attempt + 1 < attempts) { await readBackoff(500 * (attempt + 1), signal); continue; }
        if (await restore()) { attempt = -1; continue; }
        if (error instanceof OfflineError) throw error;
        throw new OfflineError('The GPU connection was lost. Reconnect to check the existing job before retrying.');
      }
      if (!response.ok) {
        if (read && RETRYABLE_READ_STATUS.has(response.status)) {
          if (attempt + 1 < attempts) { await readBackoff(500 * (attempt + 1), signal); continue; }
          if (await restore()) { attempt = -1; continue; }
          throw new OfflineError('GPU status is temporarily unavailable. The existing job may still be running; reconnect to check it before retrying.');
        }
        throw new Error(responseMessage(value, response.status));
      }
      return value;
    }
    throw new OfflineError('GPU status could not be checked. Reconnect before retrying the existing job.');
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
  job.progress = { ...job.progress, node, stage: job.workflow?.[node]?._meta?.title || stageNames[node] || 'Processing video', value: validCounter ? Math.min(max!, Math.max(0, value!)) : null,
    max: validCounter ? max : null, unit: ['43', '118'].includes(node) ? 'steps' : ['9', '10'].includes(node) ? 'frames' : 'items', updatedAt: Date.now() };
  job.status = 'running'; return true;
}
export class ConnectionManager {
  status: Connection; catalog: Catalog;
  private recovery: Promise<boolean> | null = null;
  private revision = 0;
  constructor(public store: Store, public repo: string, catalog: Catalog, private restore = command) {
    this.catalog = catalog;
    this.status = { state: 'offline', endpoint: store.value('endpoint', process.env.COMFY_URL || 'http://127.0.0.1:8188'), gpu: null,
      message: 'Local workspace. Connect your GPU when you are ready to generate.', checkedAt: null, loras: lorasFrom(catalog) };
  }
  client() { return new ComfyClient(this.status.endpoint, signal => this.recoverTransport(signal)); }
  async recoverTransport(signal?: AbortSignal): Promise<boolean> {
    if (this.recovery) return this.recovery;
    const instance = this.store.value<number | null>('cloud-connected-instance', null), endpoint = this.status.endpoint, revision = this.revision;
    if (!instance || endpoint !== 'http://127.0.0.1:8188') return false;
    this.recovery = (async () => {
      this.status.state = 'connecting'; this.status.message = 'Restoring the connection to the existing GPU job. No new render is being submitted.'; this.emit();
      try {
        await this.restore('python3', [path.join(this.repo, 'scripts/vast.py'), 'tunnel', '--instance-id', String(instance)], signal, 25000);
        // Probe only: recovery never starts a server, installs files, or resumes a rental.
        const stats = await new ComfyClient(endpoint).json('/system_stats', undefined, signal);
        if (!stats.devices?.some((device: any) => /cuda/i.test(device.type || device.name))) return false;
        if (this.revision !== revision || this.store.value('cloud-connected-instance', null) !== instance || this.status.endpoint !== endpoint) return false;
        this.status.state = 'online'; this.status.message = 'Connection restored. Checking the existing GPU job.'; this.status.checkedAt = new Date().toISOString(); this.emit(); return true;
      } catch (error) { if (signal?.aborted) throw signal.reason || error; return false; }
    })().finally(() => {
      if (this.revision === revision && this.status.state === 'connecting' && this.status.endpoint === endpoint) { this.status.state = 'offline'; this.status.message = 'The GPU server is unavailable. The rental was not restarted and the existing job was not resubmitted.'; this.emit(); }
      this.recovery = null;
    });
    return this.recovery;
  }
  emit() { this.store.emit('event', { type: 'connection', data: this.status }); }
  async connect(endpoint: string, useSSH: boolean) {
    if (this.status.state === 'connecting') return;
    this.revision++;
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
  disconnect(message = 'GPU disconnected. Your local workspace and library are available.') { this.revision++; this.status.state = 'offline'; this.status.message = message; this.emit(); }
}
export function lorasFrom(catalog: Catalog) { return (catalog.LoraLoaderModelOnly?.input.required?.lora_name?.[0] as string[] || []).filter(n => n !== 'None'); }
