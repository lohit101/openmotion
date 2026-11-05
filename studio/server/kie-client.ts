/** Server-only Kie adapter. Construction is inert; paid POSTs never retry. */
import { createHash, randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { once } from 'node:events';

const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co';
const MODEL = 'wan/3-0-video';
const JSON_LIMIT = 2 * 1024 * 1024;
export interface KieVideoInput {
  prompt: string;
  reference_video_urls: string[];
  reference_image_urls: string[];
  resolution: '480P' | '720P' | '1080P';
  duration: number;
  aspect_ratio: 'adaptive' | '16:9' | '9:16' | '4:3' | '3:4' | '1:1';
  audio: boolean;
  seed?: number;
}
export interface KieTask {
  taskId: string;
  state: 'waiting' | 'running' | 'succeeded' | 'failed';
  providerState: string;
  urls?: string[];
  error?: string;
  model?: string;
  input?: KieVideoInput;
  param?: { model?: string; input?: unknown };
  progress?: number;
  creditsConsumed?: number;
  costTime?: number;
  completedAt?: number;
  createdAt?: number;
}
export type KieErrorKind = 'rejected' | 'ambiguous' | 'transient' | 'protocol' | 'security';
export class KieApiError extends Error {
  readonly submissionUnknown: boolean;
  constructor(message: string, readonly kind: KieErrorKind, readonly status?: number,
    readonly code?: number, readonly retryable = false) {
    super(message); this.name = 'KieApiError'; this.submissionUnknown = kind === 'ambiguous';
  }
}
export interface KieAddress { address: string; family: number }
export interface KieHttpRequest {
  url: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: AsyncIterable<Uint8Array> | Uint8Array;
  signal: AbortSignal;
  address: KieAddress;
}
export interface KieHttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel?: () => void;
}
export type KieTransport = (request: KieHttpRequest) => Promise<KieHttpResponse>;
export interface KieClientOptions {
  /** Explicit injected transport is for tests; production always pins public DNS. */
  transport?: KieTransport;
  lookup?: (host: string) => Promise<KieAddress[]>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  inactivityTimeoutMs?: number;
  readAttempts?: number;
  maxDownloadBytes?: number;
  now?: () => number;
}
export interface KieDownload { path: string; bytes: number; sha256: string }
export type KieDownloadProgress = (received: number, total: number | null) => void;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KieApiError('Kie returned an invalid response.', 'protocol');
  return value as Record<string, unknown>;
}
function safeMessage(value: unknown, key: string) {
  const text = typeof value === 'string' ? value : 'Kie could not process this request.';
  return text.split(key).join('[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[provider link]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}
function keyHeader(key: string) {
  if (typeof key !== 'string' || !key || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) throw new KieApiError('Enter a valid Kie API key in Settings.', 'rejected');
  return { Authorization: `Bearer ${key}` };
}
function validTaskId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function publicShape(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new KieApiError('The provider returned an invalid media URL.', 'security'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443')
    throw new KieApiError('Provider media must use HTTPS without credentials or nonstandard ports.', 'security');
  return url;
}

/** Reject local, private, mapped, multicast and special-purpose addresses. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 100 && b >= 64 && b <= 127 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || address.includes('%') || address.includes('.')) return false;
  const parts = address.toLowerCase().split('::');
  if (parts.length > 2) return false;
  const left = parts[0] ? parts[0].split(':') : [], right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const words = [...left, ...Array(parts.length === 2 ? 8 - left.length - right.length : 0).fill('0'), ...right].map(x => parseInt(x, 16));
  if (words.length !== 8 || words.some(x => !Number.isInteger(x))) return false;
  // Global unicast only; also exclude IETF special space, documentation/6to4.
  return words[0] >= 0x2000 && words[0] < 0x4000 && !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8)) && words[0] !== 0x2002 && words[0] !== 0x3fff;
}

async function nativeTransport(input: KieHttpRequest): Promise<KieHttpResponse> {
  input.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const host = input.url.hostname.replace(/^\[|\]$/g, '');
    // Connect to the inspected IP, keeping original TLS identity and Host.
    // No second DNS lookup can rebind a public hostname to a private address.
    const req = httpsRequest({ protocol: 'https:', hostname: input.address.address, port: 443,
      servername: isIP(host) ? undefined : host, method: input.method,
      path: input.url.pathname + input.url.search, headers: { ...input.headers, Host: input.url.host },
      signal: input.signal }, res => {
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(res.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      resolve({ status: res.statusCode || 0, headers, body: res, cancel: () => res.destroy() });
    });
    req.once('error', reject);
    void (async () => {
      try {
        if (input.body instanceof Uint8Array) req.end(input.body);
        else if (input.body) {
          for await (const chunk of input.body) { input.signal.throwIfAborted(); if (!req.write(chunk)) await once(req, 'drain', { signal: input.signal }); }
          req.end();
        } else req.end();
      } catch (error) { req.destroy(error instanceof Error ? error : new Error('Upload interrupted.')); }
    })();
  });
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const headerNumber = (value?: string) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
interface PartialMetadata { sourceHash: string; etag?: string; modified?: string; total: number | null; verifiedBytes?: number; verifiedSHA256?: string; complete?: boolean }

/** Node writes may legally consume fewer bytes than requested. */
export async function writeAll(writer: { write(bytes: Uint8Array): Promise<{ bytesWritten: number }> }, bytes: Uint8Array): Promise<void> {
  let position = 0;
  while (position < bytes.byteLength) {
    const value = await writer.write(bytes.subarray(position));
    if (!Number.isSafeInteger(value.bytesWritten) || value.bytesWritten <= 0 || value.bytesWritten > bytes.byteLength - position)
      throw new KieApiError('The local output could not be written completely. Its partial was retained.', 'protocol');
    position += value.bytesWritten;
  }
}
async function atomicJson(file: string, value: unknown) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    try { await writeAll(handle, Buffer.from(JSON.stringify(value))); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export class KieClient {
  private readonly transport: KieTransport;
  private readonly lookup: (host: string) => Promise<KieAddress[]>;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly idleMs: number;
  private readonly attempts: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  constructor(options: KieClientOptions = {}) {
    this.transport = options.transport || nativeTransport;
    this.lookup = options.lookup || (host => dnsLookup(host, { all: true, verbatim: true }));
    this.sleep = options.sleep || defaultSleep; this.idleMs = options.inactivityTimeoutMs ?? 60_000;
    this.attempts = options.readAttempts ?? 3; this.maxBytes = options.maxDownloadBytes ?? 1024 ** 3; this.now = options.now || Date.now;
  }
  private async address(url: URL): Promise<KieAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await this.lookup(host);
    if (!addresses.length || addresses.some(value => !isPublicAddress(value.address) || isIP(value.address) !== value.family))
      throw new KieApiError('The provider media address is not a public Internet endpoint.', 'security');
    return addresses[0];
  }
  private async referenceAddress(url: URL, signal?: AbortSignal) {
    const timeout = new AbortController(), combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const timer = setTimeout(() => timeout.abort(), this.idleMs);
    try { return await abortable(this.address(url), combined); }
    catch (error) {
      if (error instanceof KieApiError) throw error;
      throw new KieApiError(signal?.aborted ? 'Creation cancelled before submitting paid work.' : 'The reference address could not be verified. No generation was submitted.', signal?.aborted ? 'rejected' : 'transient', undefined, undefined, !signal?.aborted);
    } finally { clearTimeout(timer); }
  }
  private async exchange(url: URL, method: 'GET' | 'POST', headers: Record<string, string>, body?: AsyncIterable<Uint8Array> | Uint8Array, signal?: AbortSignal): Promise<KieHttpResponse> {
    signal?.throwIfAborted();
    const idle = new AbortController(), combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), this.idleMs); };
    const clear = () => clearTimeout(timer);
    touch();
    try {
      const address = await abortable(this.address(url), combined);
      let payload = body;
      if (body && !(body instanceof Uint8Array)) payload = (async function* () { for await (const chunk of body) { touch(); yield chunk; } })();
      const response = await abortable(this.transport({ url, method, headers, body: payload, signal: combined, address }), combined);
      touch();
      const original = response.body;
      const cancel = response.cancel;
      return { ...response, cancel: () => { clear(); cancel?.(); }, body: (async function* () {
        const iterator = original[Symbol.asyncIterator]();
        try { while (true) { const next = await abortable(iterator.next(), combined); if (next.done) break; touch(); yield next.value; } }
        finally { clear(); cancel?.(); }
      })() };
    } catch (error) { clear(); throw error; }
  }
  private async json(url: URL, method: 'GET' | 'POST', key: string, body: Uint8Array | AsyncIterable<Uint8Array> | undefined,
    extra: Record<string, string>, signal?: AbortSignal, paid = false): Promise<Record<string, unknown>> {
    const tries = method === 'GET' ? this.attempts : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      let response: KieHttpResponse | undefined;
      try {
        const expected = url.origin === API || url.origin === UPLOAD;
        if (!expected) throw new KieApiError('Authentication is restricted to official Kie endpoints.', 'security');
        response = await this.exchange(url, method, { ...keyHeader(key), Accept: 'application/json', ...extra }, body, signal);
        if (response.status >= 300 && response.status < 400) {
          response.cancel?.();
          throw new KieApiError('Kie redirected an authenticated request; credentials were not forwarded.', paid ? 'ambiguous' : 'security', response.status);
        }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.byteLength; if (size > JSON_LIMIT) throw new KieApiError('Kie returned an oversized response.', paid ? 'ambiguous' : 'protocol'); chunks.push(Buffer.from(chunk)); }
        let value: Record<string, unknown>;
        try { value = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { const transient = response.status === 429 || response.status >= 500; throw new KieApiError('Kie returned an unreadable response. Check the existing task before submitting again.', paid ? 'ambiguous' : transient ? 'transient' : 'protocol', response.status, undefined, transient && !paid); }
        const code = typeof value.code === 'number' ? value.code : 0;
        if (response.status !== 200 || code !== 200) {
          const status = response.status, transient = status === 429 || status >= 500 || code === 429 || code >= 500;
          const definite = [400, 401, 402, 403, 404, 422, 429, 433, 455].includes(code || status);
          throw new KieApiError(safeMessage(value.msg, key), paid ? definite ? 'rejected' : 'ambiguous' : transient ? 'transient' : 'rejected', status, code || undefined, transient && !paid);
        }
        return value;
      } catch (error) {
        response?.cancel?.();
        if (signal?.aborted) throw new KieApiError(paid ? 'Submission was interrupted; its outcome is unknown. Check Kie before submitting again.' : 'Kie request cancelled.', paid ? 'ambiguous' : 'transient');
        const normalized = error instanceof KieApiError ? error : new KieApiError(paid ? 'Submission response was lost. Check the existing Kie task before submitting again.' : 'Kie could not be reached. Reconnect and try again.', paid ? 'ambiguous' : 'transient', undefined, undefined, !paid);
        if (method !== 'GET' || !normalized.retryable || attempt + 1 === tries) throw normalized;
        const retryAfter = response?.headers['retry-after'];
        const wait = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(30_000, Number(retryAfter) * 1000) : Math.min(8_000, 500 * 2 ** attempt);
        await this.sleep(wait, signal);
      }
    }
    throw new KieApiError('Kie request could not be completed.', 'transient');
  }
  async getCredits(key: string, signal?: AbortSignal): Promise<number> {
    const value = await this.json(new URL('/api/v1/chat/credit', API), 'GET', key, undefined, {}, signal);
    if (typeof value.data !== 'number' || !Number.isFinite(value.data) || value.data < 0) throw new KieApiError('Kie returned an invalid credit balance.', 'protocol');
    return value.data;
  }
  async uploadFile(filePath: string, key: string, kind: 'image' | 'video', signal?: AbortSignal, context?: { jobId: string; imageRole?: 'face' | 'additional'; imageIndex?: number }) {
    keyHeader(key); signal?.throwIfAborted();
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat(), limit = kind === 'video' ? 100_000_000 : 20_000_000;
      if (!info.isFile() || !info.size || info.size > limit) throw new KieApiError(`Choose a ${kind} within the ${kind === 'video' ? '100' : '20'} MB upload limit.`, 'rejected');
      const ext = path.extname(filePath).toLowerCase(), types: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };
      if (!types[ext] || !types[ext].startsWith(kind + '/')) throw new KieApiError('Use a supported image or MP4/MOV video.', 'rejected');
      const jobId = context?.jobId || randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(jobId)) throw new KieApiError('The upload job identifier is invalid.', 'rejected');
      if (context?.imageRole === 'additional' && (!Number.isInteger(context.imageIndex) || context.imageIndex! < 1 || context.imageIndex! > 8)) throw new KieApiError('The additional image index is invalid.', 'rejected');
      const boundary = 'recast-' + randomUUID(), fileName = (kind === 'video' ? 'source' : context?.imageRole === 'face' ? 'face-reference' : context?.imageRole === 'additional' ? `appearance-reference-${context.imageIndex}` : 'reference') + ext;
      const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="uploadPath"\r\n\r\nrecast/${jobId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="fileName"\r\n\r\n${fileName}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${types[ext]}\r\n\r\n`);
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
      const stream = file.createReadStream({ autoClose: false });
      const body = (async function* () { yield prefix; for await (const chunk of stream) yield Buffer.from(chunk); yield suffix; })();
      try {
        const value = await this.json(new URL('/api/file-stream-upload', UPLOAD), 'POST', key, body,
          { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(prefix.length + info.size + suffix.length) }, signal);
        const data = object(value.data);
        if (value.success !== true || data.success === false || typeof data.downloadUrl !== 'string' || data.downloadUrl.includes(key))
          throw new KieApiError('Kie did not confirm the uploaded file.', 'protocol');
        const url = publicShape(data.downloadUrl);
        await this.referenceAddress(url, signal);
        const uploaded = typeof data.uploadedAt === 'string' ? Date.parse(data.uploadedAt) : this.now();
        return { url: url.href, fileName, bytes: info.size, expiresAt: new Date((Number.isFinite(uploaded) ? uploaded : this.now()) + 24 * 60 * 60 * 1000).toISOString() };
      } finally { stream.destroy(); }
    } finally { await file.close(); }
  }
  async createTask(key: string, input: KieVideoInput, signal?: AbortSignal): Promise<{ taskId: string }> {
    keyHeader(key);
    if (signal?.aborted) throw new KieApiError('Creation cancelled before submitting paid work.', 'rejected');
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || Array.from(input.prompt).length > 20000 ||
      !Array.isArray(input.reference_video_urls) || input.reference_video_urls.length !== 1 ||
      !Array.isArray(input.reference_image_urls) || !input.reference_image_urls.length || input.reference_image_urls.length > 10 ||
      !['480P', '720P', '1080P'].includes(input.resolution) || !Number.isInteger(input.duration) || input.duration < 2 || input.duration > 15 ||
      !['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1'].includes(input.aspect_ratio) || typeof input.audio !== 'boolean' || input.seed !== undefined && (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 2147483647))
      throw new KieApiError('Choose a prompt, character images, one 2–15 second clip, and an explicit output resolution.', 'rejected');
    for (const value of [...input.reference_video_urls, ...input.reference_image_urls]) await this.referenceAddress(publicShape(value), signal);
    const payload: KieVideoInput = { prompt: input.prompt, reference_video_urls: [...input.reference_video_urls], reference_image_urls: [...input.reference_image_urls],
      resolution: input.resolution, duration: input.duration, aspect_ratio: input.aspect_ratio, audio: input.audio, ...(input.seed === undefined ? {} : { seed: input.seed }) };
    const value = await this.json(new URL('/api/v1/jobs/createTask', API), 'POST', key, Buffer.from(JSON.stringify({ model: MODEL, input: payload })), { 'Content-Type': 'application/json' }, signal, true);
    let data: Record<string, unknown>;
    try { data = object(value.data); } catch { throw new KieApiError('Kie accepted the request without a readable task ID. Check Kie before submitting again.', 'ambiguous'); }
    if (!validTaskId(data.taskId) || data.taskId.includes(key)) throw new KieApiError('Kie accepted the request without a readable task ID. Check Kie before submitting again.', 'ambiguous');
    return { taskId: data.taskId };
  }
  async getTask(key: string, taskId: string, signal?: AbortSignal): Promise<KieTask> {
    if (!validTaskId(taskId)) throw new KieApiError('Enter a valid existing Kie task ID.', 'rejected');
    const url = new URL('/api/v1/jobs/recordInfo', API); url.searchParams.set('taskId', taskId);
    const value = await this.json(url, 'GET', key, undefined, {}, signal), data = object(value.data);
    if (data.taskId !== taskId || typeof data.state !== 'string') throw new KieApiError('Kie returned another task or an invalid task state.', 'protocol');
    const states: Record<string, KieTask['state']> = { waiting: 'waiting', queuing: 'waiting', queued: 'waiting', generating: 'running', running: 'running', success: 'succeeded', fail: 'failed' };
    if (!states[data.state]) throw new KieApiError('Kie returned an unsupported task state.', 'protocol');
    const result: KieTask = { taskId, providerState: data.state, state: states[data.state] };
    if (typeof data.model === 'string') {
      if (data.model !== MODEL) throw new KieApiError('The selected task uses another model.', 'protocol');
      result.model = data.model;
    }
    if (typeof data.param === 'string' && data.param) {
      let param: Record<string, unknown>;
      try { param = object(JSON.parse(data.param)); if (typeof param.input === 'string') param.input = JSON.parse(param.input); }
      catch { throw new KieApiError('Kie returned unreadable original task parameters.', 'protocol'); }
      if (typeof param.model === 'string' && param.model !== MODEL) throw new KieApiError('The original task parameters use another model.', 'protocol');
      const clean = param.input && typeof param.input === 'object' && !Array.isArray(param.input) ?
        Object.fromEntries(Object.entries(param.input).filter(([name]) => ['prompt', 'reference_video_urls', 'reference_image_urls', 'resolution', 'duration', 'aspect_ratio', 'audio', 'seed'].includes(name))) : undefined;
      result.param = { model: typeof param.model === 'string' ? param.model : undefined, input: clean };
      if (clean) result.input = clean as unknown as KieVideoInput;
    }
    if (result.state === 'succeeded') {
      let parsed: Record<string, unknown>;
      try { parsed = object(JSON.parse(typeof data.resultJson === 'string' ? data.resultJson : '')); }
      catch { throw new KieApiError('Kie completed the task without a readable media result.', 'protocol'); }
      if (!Array.isArray(parsed.resultUrls) || !parsed.resultUrls.length || parsed.resultUrls.length > 10 || parsed.resultUrls.some(x => typeof x !== 'string'))
        throw new KieApiError('Kie completed the task without valid result URLs.', 'protocol');
      result.urls = parsed.resultUrls.map(value => publicShape(value as string).href);
    }
    if (result.state === 'failed') result.error = safeMessage(data.failMsg || 'Kie generation failed.', key);
    for (const [source, target] of [['progress', 'progress'], ['creditsConsumed', 'creditsConsumed'], ['costTime', 'costTime'], ['completeTime', 'completedAt'], ['createTime', 'createdAt']] as const) {
      const number = data[source]; if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && (source !== 'progress' || number <= 100)) result[target] = number;
    }
    if (JSON.stringify({ ...result, error: undefined }).includes(key)) throw new KieApiError('Kie returned unexpected credential data; it was not saved.', 'protocol');
    return result;
  }
  recordInfo(key: string, taskId: string, signal?: AbortSignal) { return this.getTask(key, taskId, signal); }

  async downloadResult(url: string, destination: string, signal?: AbortSignal, onProgress?: KieDownloadProgress): Promise<KieDownload> {
    const source = publicShape(url), sourceHash = sha(source.href), part = destination + '.part', metaPath = part + '.json', receiptPath = destination + '.download.json';
    await mkdir(path.dirname(destination), { recursive: true });
    let existingDestination = false;
    for (const file of [destination, part, metaPath, receiptPath]) {
      try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new KieApiError('The download path is not an owned regular file.', 'security'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    try { await lstat(destination); existingDestination = true; } catch { /* Missing output is normal before download. */ }
    const fileHash = async (file: string) => { const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); } finally { await handle.close(); } };
    try {
      const saved = JSON.parse(await readFile(receiptPath, 'utf8')) as KieDownload & { sourceHash: string };
      if (saved.sourceHash === sourceHash && saved.bytes === (await lstat(destination)).size && saved.sha256 === await fileHash(destination)) return { path: destination, bytes: saved.bytes, sha256: saved.sha256 };
      throw new KieApiError('An existing completed download belongs to different media.', 'protocol');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existingDestination) {
      // Recover the narrow crash window after the exclusive output link and
      // before its receipt commit. Retained verified metadata must prove every
      // byte; an unrelated existing file is never overwritten or adopted.
      let saved: PartialMetadata | null = null;
      try { saved = JSON.parse(await readFile(metaPath, 'utf8')); } catch { /* No proof means preserve and reject. */ }
      const info = await lstat(destination);
      if (!saved || saved.sourceHash !== sourceHash || saved.verifiedBytes !== info.size || !saved.verifiedSHA256 ||
        saved.complete !== true && saved.total !== info.size || saved.verifiedSHA256 !== await fileHash(destination))
        throw new KieApiError('A completed output already exists without matching verified metadata. It was preserved.', 'protocol');
      let partialExists = false;
      try { const partialInfo = await lstat(part); partialExists = true;
        if (partialInfo.size !== info.size || await fileHash(part) !== saved.verifiedSHA256) throw new KieApiError('The completed output conflicts with its partial. Both were preserved.', 'protocol');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const result = { path: destination, bytes: info.size, sha256: saved.verifiedSHA256 };
      await atomicJson(receiptPath, { ...result, sourceHash }); if (partialExists) await unlink(part);
      onProgress?.(info.size, info.size); return result;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      signal?.throwIfAborted();
      let response: KieHttpResponse | undefined;
      let metadata: PartialMetadata = { sourceHash, total: null };
      let offset = 0;
      try {
        try { metadata = JSON.parse(await readFile(metaPath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new KieApiError('The saved download metadata is unreadable.', 'protocol'); }
        if (metadata.sourceHash !== sourceHash) throw new KieApiError('The saved partial belongs to another result URL. It was preserved.', 'protocol');
        try { const file = await lstat(part); offset = file.size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (offset > this.maxBytes) throw new KieApiError('The saved partial exceeds the download size limit.', 'protocol');
        if (metadata.verifiedBytes === offset && metadata.verifiedSHA256 && metadata.verifiedSHA256 !== await fileHash(part)) throw new KieApiError('The saved partial changed since it was verified.', 'protocol');
        if (offset && metadata.total === offset && metadata.verifiedBytes === offset && metadata.verifiedSHA256) return await finish(metadata.verifiedSHA256, offset, metadata);
        const validator = metadata.etag && !metadata.etag.startsWith('W/') ? metadata.etag : metadata.modified && Number.isFinite(Date.parse(metadata.modified)) ? metadata.modified : undefined;
        const resume = offset && validator ? offset : 0;
        const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
        if (offset) { headers.Range = `bytes=${resume}-`; if (validator) headers['If-Range'] = validator; }
        let current = source;
        for (let redirects = 0; ; redirects++) {
          response = await this.exchange(current, 'GET', headers, undefined, signal);
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.location; response.cancel?.();
          if (!location || redirects >= 4) throw new KieApiError('The result download redirected too many times.', 'security');
          current = publicShape(new URL(location, current).href);
        }
        if (response.status !== 200 && response.status !== 206) {
          const transient = response.status === 429 || response.status >= 500;
          throw new KieApiError(`Result download returned HTTP ${response.status}. The saved partial was kept.`, transient ? 'transient' : 'rejected', response.status, undefined, transient);
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new KieApiError('Compressed result ranges cannot be combined safely.', 'protocol');
        const length = headerNumber(response.headers['content-length']);
        let total = length, bodyStart = 0;
        if (response.status === 206) {
          const match = response.headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (!match || Number(match[1]) !== resume || Number(match[2]) < resume || Number(match[2]) >= Number(match[3]) || length !== null && length !== Number(match[2]) - resume + 1)
            throw new KieApiError('The server returned an inconsistent download range. The partial was kept.', 'protocol');
          bodyStart = resume; total = Number(match[3]);
          if (metadata.total !== null && metadata.total !== total || validator && metadata.etag && response.headers.etag && metadata.etag !== response.headers.etag)
            throw new KieApiError('The result changed while downloading. The original partial was preserved.', 'protocol');
        }
        if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > this.maxBytes)) throw new KieApiError('The result exceeds the permitted download size.', 'protocol');
        const pendingMetadata = { sourceHash, total, etag: response.headers.etag, modified: response.headers['last-modified'] };
        let prefixVerified = bodyStart === offset;
        if (prefixVerified) { metadata = pendingMetadata; await atomicJson(metaPath, metadata); }
        const file = await open(part, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
        let received = offset, position = bodyStart;
        try {
          onProgress?.(received, total);
          for await (const value of response.body) {
            signal?.throwIfAborted(); let chunk = Buffer.from(value);
            // A server ignoring Range, or a missing validator, requires an
            // exact full-prefix comparison. Never truncate a matching partial.
            if (position < offset) {
              const count = Math.min(chunk.length, offset - position), local = Buffer.alloc(count);
              const read = await file.read(local, 0, count, position);
              if (read.bytesRead !== count || !local.equals(chunk.subarray(0, count))) throw new KieApiError('The result prefix changed. Its existing partial was preserved.', 'protocol');
              position += count; chunk = chunk.subarray(count);
            }
            if (!prefixVerified && position === offset) { prefixVerified = true; metadata = pendingMetadata; await atomicJson(metaPath, metadata); }
            if (chunk.length) {
              const nextReceived = received + chunk.length;
              if (nextReceived > this.maxBytes || total !== null && nextReceived > total) throw new KieApiError('The result exceeded its declared size.', 'protocol');
              await writeAll(file, chunk); received = nextReceived; position += chunk.length; onProgress?.(received, total);
            }
          }
          if (position < offset || total !== null && received !== total) throw new KieApiError('The result download ended early. Its partial was retained.', 'transient', undefined, undefined, true);
          await file.sync();
        } finally { await file.close(); }
        const hash = await fileHash(part);
        metadata.verifiedBytes = received; metadata.verifiedSHA256 = hash;
        await atomicJson(metaPath, metadata);
        return await finish(hash, received, metadata);
      } catch (error) {
        response?.cancel?.();
        try { const file = await lstat(part); if (file.isFile() && !file.isSymbolicLink()) { metadata.verifiedBytes = file.size; metadata.verifiedSHA256 = await fileHash(part); await atomicJson(metaPath, metadata); } } catch { /* Preserve the original error and bytes. */ }
        if (signal?.aborted) throw new KieApiError('Result download cancelled; its partial was retained.', 'transient');
        lastError = error instanceof KieApiError ? error : new KieApiError('Result transfer was interrupted; its partial was retained.', 'transient', undefined, undefined, true);
        if (!(lastError as KieApiError).retryable || attempt + 1 === this.attempts) throw lastError;
        const retryAfter = response?.headers['retry-after'];
        const wait = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(30_000, Number(retryAfter) * 1000) : Math.min(8000, 500 * 2 ** attempt);
        await this.sleep(wait, signal);
      }
    }
    throw lastError;
    async function finish(hash: string, bytes: number, metadata: PartialMetadata): Promise<KieDownload> {
      await atomicJson(metaPath, { ...metadata, verifiedBytes: bytes, verifiedSHA256: hash, complete: true });
      // link is exclusive: a concurrently created output is never overwritten.
      await link(part, destination); await unlink(part);
      const result = { path: destination, bytes, sha256: hash };
      await atomicJson(receiptPath, { ...result, sourceHash });
      onProgress?.(bytes, bytes); return result;
    }
  }
  download(url: string, destination: string, signal?: AbortSignal, progress?: KieDownloadProgress) { return this.downloadResult(url, destination, signal, progress); }
}
