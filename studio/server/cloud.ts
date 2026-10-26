import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { EmptyHostError, hasNoContainerSignals, hostSilenceExpired, observeHostSilence } from './provisioning-health';
import type { Store } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import { command } from './media';
import type { CloudInstance, CloudLaunch, CloudState, GpuOffer, GpuFavourite, OfferFilters } from '../shared/cloud';
import { canRetryRental, isDgxSpark, isGraceBlackwell, offerFiltersSchema, offerGpuFilter, sameGpuModel, supportedGpuName } from '../shared/cloud';
import { modelBytes, modelFilesForSettings, pinnedModels, setupModelFiles } from '../shared/models';

const MODEL_GB = modelBytes(setupModelFiles) / 1e9;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const RENTAL_IMAGE = 'nvidia/cuda:13.0.2-base-ubuntu24.04';
export const SSH_ONSTART = readFileSync(new URL('../../scripts/ssh_permissions.sh', import.meta.url), 'utf8');
const number = (value: unknown): number | null => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const amount = (...values: unknown[]) => values.map(number).find(v => v !== null && v >= 0) ?? null;
const driverNumber = (value: unknown) => { const parts = String(value || '').split('.'); return parts.length === 1 ? Number(value) : Number(parts[0]) * 1000000 + Number(parts[1]) * 1000 + Number(parts[2] || 0); };
export class VastError extends Error { constructor(message: string, public status: number, public ambiguous = false) { super(message); } }
const publicKeyIdentity = (value: unknown) => typeof value === 'string' ? value.trim().split(/\s+/).slice(0, 2).join(' ') : '';
export function registeredSshKeys(response: unknown): any[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') for (const field of ['ssh_keys', 'keys']) { const rows = (response as Record<string, unknown>)[field]; if (Array.isArray(rows)) return rows; }
  throw new Error('Vast returned an unexpected SSH-key list. Refresh your account before trying again.');
}
export function hasRegisteredSshKey(response: unknown, publicKey: string) {
  const expected = publicKeyIdentity(publicKey);
  return registeredSshKeys(response).some(key => typeof key === 'string' ? publicKeyIdentity(key) === expected : key && !key.deleted_at &&
    [key.public_key, key.key, key.ssh_key].some(value => publicKeyIdentity(value) === expected));
}
type CloudOptions = {
  fetcher?: typeof fetch; base?: string; provision?: (instance: any, log: (line: string) => void, signal: AbortSignal) => Promise<void>;
  preflight?: (identity: string) => Promise<void>; sshIdentity?: string;
  probe?: (instance: any, identity: string) => Promise<boolean>;
  sshReachable?: (instance: any) => Promise<boolean>;
  hostSilenceMs?: number;
  setupWarningMs?: number; pollMs?: number; stopPollAttempts?: number; backgroundSafety?: boolean;
};
export class PreflightError extends Error { constructor(message: string, public code: NonNullable<CloudLaunch['failureCode']>) { super(message); } }
export function computeIsStopped(instance: any) {
  return instance.actual_status === 'stopped' || (instance.actual_status === 'exited' && [instance.intended_status, instance.cur_state, instance.next_state].includes('stopped'));
}
export function fatalContainerStatus(message: unknown) {
  const value = String(message || '').trim();
  // Some hosts leave actual_status=loading after their builder has failed.
  // Match explicit fatal reports; elapsed time or quiet pull logs are not errors.
  return /^docker_build\(\)\s+error writing dockerfile\b/i.test(value) ||
    /^Error response from daemon:.*(?:no space left on device|pull access denied|manifest unknown|no matching manifest)/i.test(value) ? value.slice(0, 500) : null;
}
export function matchesGpuProbe(instance: { gpu_name?: string; gpu_ram?: number | null }, output: string) {
  const minimumMemory = Math.max(24000, Number(instance.gpu_ram || 0) * 0.95);
  return output.split('\n').some(line => {
    const [name, memory] = line.split(',');
    if (!instance.gpu_name || !sameGpuModel(instance.gpu_name, name || '')) return false;
    // GB10 reports N/A instead of a dedicated VRAM pool. Bootstrap verifies
    // actual container-limited shared memory before installing the runtime.
    return (isDgxSpark(instance.gpu_name) && /^\[?N\/A\]?$/i.test(memory?.trim() || '')) || Number(memory?.trim()) >= minimumMemory;
  });
}
export class VastClient {
  constructor(private key: () => Promise<string>, public fetcher: typeof fetch = fetch, public base = 'https://console.vast.ai') {}
  async request(route: string, method = 'GET', body?: unknown, timeoutMs = 30000): Promise<any> {
    const key = await this.key(); let response: Response;
    try { response = await this.fetcher(this.base + route, { method, headers: { Authorization: 'Bearer ' + key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
    catch { throw new VastError(method === 'PUT' ? 'Vast did not confirm the request. Refresh instances before retrying; it may have succeeded.' : 'Vast could not be reached. Try refreshing.', 503, method !== 'GET'); }
    let value: any;
    try { value = await response.json(); }
    catch { throw new VastError('Vast returned an unreadable response. The request was not repeated; check the account status before retrying.', 502, method !== 'GET'); }
    if (value === null || typeof value !== 'object') throw new VastError('Vast returned an invalid response. The request was not repeated; checking the account is required before retrying.', 502, method !== 'GET');
    if (!response.ok || value.success === false) {
      const text = String(value.msg || value.message || value.error || `Vast returned HTTP ${response.status}.`).replaceAll(key, '[redacted]').slice(0, 500);
      throw new VastError(response.status === 401 ? 'This Vast API key is invalid or expired.' : response.status === 403 ? 'This key does not allow this operation. Check its Vast permissions.' : text, response.status, method !== 'GET' && (response.status >= 500 || response.status === 408));
    }
    return value;
  }
  async instances() {
    const instances: any[] = []; let after = '';
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: '100', select_filters: '{}', order_by: JSON.stringify([{ col: 'id', dir: 'asc' }]), ...(after ? { after_token: after } : {}) });
      const value = await this.request('/api/v1/instances/?' + query);
      if (!Array.isArray(value.instances) || value.instances.some((row: any) => !Number.isSafeInteger(Number(row?.id)) || Number(row.id) <= 0)) throw new VastError('Vast returned an invalid instance list. Previously known rentals are kept until their status can be checked.', 502);
      instances.push(...value.instances.map((row: any) => ({ ...row, id: Number(row.id) })));
      if (!value.next_token) return instances; after = value.next_token;
    }
    throw new Error('Vast returned too many instance pages. Narrow this account before continuing.');
  }
  async instance(id: number) {
    try {
      const value = await this.request(`/api/v0/instances/${id}/`, 'GET', undefined, 10000);
      if (!value || !Object.hasOwn(value, 'instances')) throw new VastError('Vast returned an invalid instance status.', 502);
      const row = Array.isArray(value.instances) ? value.instances.find((item: any) => Number(item.id) === id) : value.instances;
      if (row === null || (Array.isArray(value.instances) && !value.instances.length)) return null;
      if (!row || Number(row.id) !== id) throw new VastError('Vast returned a different instance than requested. No setup or stop action was sent to it.', 502);
      return { ...row, id };
    } catch (error) { if (error instanceof VastError && error.status === 404) return null; throw error; }
  }
  async offers(filters: OfferFilters, id?: number, host?: { machineId: number; gpu: string }) {
    const query: any = { type: 'on-demand', rentable: { eq: true }, rented: { eq: false }, external: { eq: false }, num_gpus: { eq: 1 },
      gpu_ram: { gte: 24000 }, cpu_ram: { gte: filters.ram * 1000 }, disk_space: { gte: filters.disk }, cuda_max_good: { gte: 13 }, driver_version: { gte: 580065006 },
      direct_port_count: { gte: 1 }, allocated_storage: filters.disk, order: [['dph_total', 'asc']], limit: 250 };
    // GB10 can omit gpu_ram because CPU/GPU share the same pool. Capacity is
    // still checked below; dedicated-family searches retain the VRAM predicate.
    if (['datacenter', 'dgx', 'all'].includes(filters.gpu) || isDgxSpark(filters.gpu)) delete query.gpu_ram;
    // Vast defaults to amd64 if omitted, silently hiding Grace ARM hosts.
    query.cpu_arch = { in: ['amd64', 'arm64'] };
    // Vast's bundle-search `id` predicate does not target the rental ask ID.
    // Revalidate the exact ask that will be used by PUT /asks/{ask_contract_id}.
    if (id) query.ask_contract_id = { eq: id }; else query.gpu_name = offerGpuFilter(filters.gpu);
    if (host) { query.machine_id = { eq: host.machineId }; query.gpu_name = { eq: host.gpu }; }
    if (filters.verified) query.verified = { eq: true };
    if (filters.minDownload > 0) query.inet_down = { gte: filters.minDownload };
    const value = await this.request('/api/v0/bundles/', 'POST', query);
    if (!Array.isArray(value.offers)) throw new VastError('Vast returned an invalid offer list. No rental was requested.', 502);
    return (id ? value.offers.filter((offer: any) => Number(offer.ask_contract_id ?? offer.id) === id) : value.offers) as any[];
  }
}
export function normalizeOffer(raw: any, filters: OfferFilters, modelGB = MODEL_GB): GpuOffer {
  const storageHourly = amount(raw.search?.diskHour, raw.storage_total_cost), totalHourly = amount(raw.search?.totalHour, raw.dph_total);
  const computeHourly = amount(raw.search?.gpuCostPerHour, raw.dph_base, totalHourly !== null && storageHourly !== null ? totalHourly - storageHourly : null);
  const reasons: string[] = [], gpu = String(raw.gpu_name || ''), ram = Number(raw.cpu_ram || 0) / 1000, unified = isDgxSpark(gpu);
  const reportedVram = number(raw.gpu_ram), vram = reportedVram && reportedVram > 0 ? reportedVram / 1024 : unified ? ram : 0;
  if (!supportedGpuName(gpu)) reasons.push('Choose a supported NVIDIA RTX, A-series or DGX/datacenter GPU.'); if (Number(raw.num_gpus) !== 1) reasons.push('This workflow uses one GPU.');
  const askId = Number(raw.ask_contract_id ?? raw.id);
  if (!Number.isSafeInteger(askId) || askId <= 0) reasons.push('A valid rental ask ID is required.');
  if (!Number.isSafeInteger(Number(raw.machine_id)) || Number(raw.machine_id) <= 0) reasons.push('A valid host machine ID is required.');
  if (unified) {
    const minimumShared = Math.max(64, filters.ram);
    if (vram < minimumShared || ram < minimumShared) reasons.push(`At least ${minimumShared} GB shared memory is required.`);
    if (raw.cpu_arch && !/^(?:arm64|aarch64)$/i.test(raw.cpu_arch)) reasons.push('DGX Spark requires a native ARM64 host.');
  } else {
    if (Number(raw.gpu_ram || 0) < 24000) reasons.push('This setup requires a 24 GB-class GPU with at least 24,000 MiB reported memory.');
    if (ram < filters.ram) reasons.push(`At least ${filters.ram} GB system RAM is required.`);
  }
  if (isGraceBlackwell(gpu) && raw.cpu_arch && !/^(?:arm64|aarch64)$/i.test(raw.cpu_arch)) reasons.push('Grace Blackwell requires a native ARM64 host.');
  if (driverNumber(raw.driver_version) < 580065006 || !raw.driver_version) reasons.push('CUDA 13 needs NVIDIA driver 580.65.06 or newer.');
  if (Number(raw.cuda_max_good || 0) < 13) reasons.push('CUDA 13 support is required.'); if (Number(raw.disk_space || 0) < filters.disk) reasons.push('The requested disk allocation is unavailable.');
  if (Number(raw.direct_port_count || 0) < 1) reasons.push('A direct SSH port is required.'); if (raw.rented || raw.rentable === false) reasons.push('This offer is no longer available.');
  if (filters.verified && raw.verification !== 'verified' && raw.verified !== true) reasons.push('A verified host is required.');
  if (filters.minDownload > 0 && Number(raw.inet_down || 0) < filters.minDownload) reasons.push(`At least ${filters.minDownload} Mbps download is selected.`);
  if (totalHourly === null) reasons.push('An hourly quote is unavailable.');
  return { id: askId, machineId: Number(raw.machine_id), gpu, vram, ram, cpus: Number(raw.cpu_cores_effective || raw.cpu_cores || 0), cpu: String(raw.cpu_name || 'CPU details unavailable'),
    location: String(raw.geolocation || 'Location unavailable'), verified: raw.verification === 'verified' || raw.verified === true, reliability: Number(raw.reliability2 ?? raw.reliability ?? 0),
    driver: String(raw.driver_version || ''), cuda: Number(raw.cuda_max_good || 0), diskMax: Number(raw.disk_space || 0), diskBandwidth: Number(raw.disk_bw || 0),
    downloadMbps: Number(raw.inet_down || 0), uploadMbps: Number(raw.inet_up || 0), downloadPerGB: amount(raw.inet_down_cost), uploadPerGB: amount(raw.inet_up_cost), pcie: Number(raw.pcie_bw || 0),
    computeHourly, storageHourly, totalHourly, storageMonthly: amount(raw.storage_cost) === null ? null : Number(raw.storage_cost) * filters.disk,
    modelDownloadCost: amount(raw.inet_down_cost) === null ? null : Number(raw.inet_down_cost) * modelGB, modelDownloadGB: modelGB, disk: filters.disk,
    expiresAt: new Date(Date.now() + 90000).toISOString(), quote: randomUUID(), compatible: !reasons.length, reasons };
}

export class CloudManager {
  client: VastClient; state: CloudState; private keyFile: string; private quotes = new Map<string, { offer: GpuOffer; filters: OfferFilters }>();
  private rawInstances: any[] = []; private provision: ChildProcess | null = null; private activeLaunch: string | null = null; private refreshPromise: Promise<CloudState> | null = null; private stopped = new Set<string>();
  private activeAbort: AbortController | null = null; private safetyTimer: ReturnType<typeof setInterval> | null = null; private safetyBusy = false;
  private activeTask: Promise<void> | null = null;
  private closing = false;
  private stopChecks = new Map<string, Promise<boolean>>();
  private cleanupChecks = new Map<string, Promise<boolean>>();
  private favouriteChecks = new Map<string, string>();
  private resuming = new Set<string>();
  constructor(public store: Store, public connection: ConnectionManager, public runner: Runner, public repo: string, options: CloudOptions = {}) {
    this.options = options; this.keyFile = path.join(store.root, 'private', 'vast-api-key');
    this.client = new VastClient(() => this.key(), options.fetcher, options.base);
    const launches = store.value<CloudLaunch[]>('cloud-launches', []);
    for (const launch of launches) {
      launch.setupDeadline = null; // Legacy deadlines never stop a healthy setup.
      launch.hostWatch = undefined;
      // Legacy rentals may contain models even when old log lines were trimmed.
      // Only new rentals explicitly carry permission to discard an empty disk.
      if (launch.emptyRental === undefined) launch.emptyRental = false;
      if (launch.autoCleanup?.state === 'pending') {
        launch.phase = 'failed'; launch.safetyStatus = 'unconfirmed';
        launch.message = 'Rechecking automatic removal of the failed empty rental.';
        continue;
      }
      if (!['checking', 'requesting', 'waiting', 'installing', 'connecting', 'stopping', 'destroying'].includes(launch.phase)) continue;
      if (['stopping', 'destroying'].includes(launch.phase) || ['unconfirmed', 'stop_requested'].includes(launch.safetyStatus || '')) {
        launch.phase = launch.instanceId ? 'failed' : 'unknown'; launch.safetyStatus = 'unconfirmed';
        launch.message = 'Rechecking the existing instance action after the app restarted.';
      } else if (launch.instanceId) {
        launch.phase = 'waiting'; launch.needsReconnect = true; launch.safetyStatus = 'armed';
        launch.warning = 'The local app restarted. Reconnect to follow the existing setup; remote downloads are retained.';
        launch.message = 'Existing rental found. Reconnect setup to follow its progress.';
      } else if (launch.creationAttempted) {
        launch.phase = 'unknown'; launch.safetyStatus = 'unconfirmed';
        launch.lastFailure ||= 'The app restarted before the rental request was confirmed.';
      } else {
        launch.phase = 'failed'; launch.creationAttempted = false; launch.safetyStatus = 'disarmed';
        launch.message = 'The app closed before a rental request was sent. You can retry.';
      }
    }
    for (const launch of launches) if (!launch.instanceId && launch.creationAttempted !== true && /^This offer was rented by someone else\./.test(launch.message)) {
      launch.creationAttempted = false; launch.failureCode = 'offer-unavailable'; launch.lastFailure ||= launch.message;
      launch.message = 'This earlier attempt stopped before renting. The availability check has been corrected. Choose a fresh marketplace offer to try again.';
    }
    const favourites = store.value<GpuFavourite[]>('cloud-favourites', []).map(favourite => ({ ...favourite, status: 'unchecked' as const, checkedAt: null, offer: null, message: undefined }));
    this.state = { configured: !!process.env.VAST_API_KEY || existsSync(this.keyFile), keySource: process.env.VAST_API_KEY ? 'environment' : existsSync(this.keyFile) ? 'local' : null, instances: [], launches, favourites, refreshedAt: null, error: null, busy: false };
    this.monitorSafety();
  }
  private options: CloudOptions;
  async key() { const key = process.env.VAST_API_KEY || await readFile(this.keyFile, 'utf8').catch(() => ''); if (!key.trim()) throw new Error('Connect your Vast account with an API key first.'); return key.trim(); }
  emit() {
    this.store.set('cloud-launches', this.state.launches);
    this.store.set('cloud-favourites', (this.state.favourites || []).map(({ offer: _offer, status: _status, checkedAt: _checked, message: _message, ...saved }) => saved));
    this.store.emit('event', { type: 'cloud', data: this.state }); this.monitorSafety();
  }
  dispose() { if (this.safetyTimer) clearInterval(this.safetyTimer); this.safetyTimer = null; }
  async shutdown() {
    this.closing = true; this.dispose();
    this.activeAbort?.abort(new Error('The local app is shutting down.')); this.stopProvision();
    if (this.activeTask) await this.activeTask.catch(() => undefined);
    for (const launch of this.state.launches) if (launch.instanceId && ['checking', 'requesting', 'waiting', 'installing', 'connecting'].includes(launch.phase)) {
      launch.needsReconnect = true; launch.warning = 'The local app disconnected. Remote installation continues; reconnect to follow it.';
    }
    this.emit();
    const pending = this.state.launches.filter(l => l.autoCleanup?.state === 'pending' || (!['ready', 'stopped', 'destroyed'].includes(l.phase) && ['unconfirmed', 'stop_requested'].includes(l.safetyStatus || '')));
    if (pending.length) { await this.refresh(); await Promise.allSettled(pending.filter(l => l.instanceId).map(l => l.autoCleanup?.state === 'pending' ? this.cleanupEmptyRental(l) : this.stopRental(l, l.lastFailure || 'Completing the previously requested compute stop.'))); }
    this.dispose();
    if (pending.some(l => !['stopped', 'destroyed'].includes(l.phase))) throw new Error('Some rental stops remain unconfirmed. Check the Vast console; compute charges may continue.');
  }
  private monitorSafety() {
    if (this.closing || this.options.backgroundSafety === false) return;
    const pending = this.state.launches.some(l => l.autoCleanup?.state === 'pending' || (l.autoStopOnFailure !== false && !['ready', 'stopped', 'destroyed'].includes(l.phase) && (l.safetyStatus === 'unconfirmed' || l.safetyStatus === 'stop_requested')));
    if (pending && !this.safetyTimer) { this.safetyTimer = setInterval(() => void this.enforceSafety().catch(() => undefined), 15000); this.safetyTimer.unref(); }
    else if (!pending) this.dispose();
  }
  async enforceSafety() {
    if (this.safetyBusy) return; this.safetyBusy = true;
    try {
      const due = this.state.launches.filter(l => l.autoCleanup?.state === 'pending' || (l.autoStopOnFailure !== false && !['ready', 'stopped', 'destroyed'].includes(l.phase) &&
        (l.safetyStatus === 'unconfirmed' || l.safetyStatus === 'stop_requested')));
      if (!due.length) return;
      await this.refresh(); if (this.state.error) return;
      for (const launch of due) {
        if (launch.autoCleanup?.state === 'pending') { await this.cleanupEmptyRental(launch); continue; }
        if (this.resuming.has(launch.id) || !['unconfirmed', 'stop_requested'].includes(launch.safetyStatus || '') || ['stopped', 'destroyed', 'ready'].includes(launch.phase)) continue;
        launch.lastFailure ||= 'The previous instance request could not be confirmed.';
        if (this.activeLaunch === launch.id) { this.activeAbort?.abort(); this.stopProvision(); }
        this.stopped.add(launch.id);
        if (launch.instanceId) await this.stopRental(launch, launch.lastFailure);
      }
    } finally { this.safetyBusy = false; }
  }
  async saveKey(value: string) {
    const candidate = new VastClient(async () => value, this.options.fetcher, this.options.base); await candidate.instances();
    if (process.env.VAST_API_KEY) throw new Error('VAST_API_KEY is set in the server environment. Update that value instead.');
    const folder = path.dirname(this.keyFile); await mkdir(folder, { recursive: true, mode: 0o700 }); await chmod(folder, 0o700);
    await writeFile(this.keyFile + '.tmp', value, { mode: 0o600 }); await chmod(this.keyFile + '.tmp', 0o600); await rename(this.keyFile + '.tmp', this.keyFile);
    this.state.configured = true; this.state.keySource = 'local'; await this.refresh();
  }
  async removeKey() {
    if (this.state.busy) throw new Error('Wait for provisioning to finish before removing the key.');
    if (this.state.launches.some(l => !['ready', 'stopped', 'destroyed'].includes(l.phase) && ['unconfirmed', 'stop_requested'].includes(l.safetyStatus || ''))) throw new Error('Confirm the pending rental stop before removing the key. It is still needed to check and stop compute.');
    if (process.env.VAST_API_KEY) throw new Error('Remove VAST_API_KEY from the server environment instead.');
    await rm(this.keyFile, { force: true }); this.state.configured = false; this.state.keySource = null; this.state.instances = []; this.emit();
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const rows = await this.client.instances();
        // A newly created or stopped instance can be absent from the list while
        // the provider updates it. Check known IDs before declaring disks gone.
        for (const launch of this.state.launches) if (launch.instanceId && launch.phase !== 'destroyed' && !rows.some(row => row.id === launch.instanceId)) {
          const single = await this.client.instance(launch.instanceId); if (single) rows.push(single);
        }
        this.rawInstances = rows; this.state.error = null; this.state.refreshedAt = new Date().toISOString();
        const connected = this.store.value<number | null>('cloud-connected-instance', null);
        if (connected && !this.rawInstances.some(i => i.id === connected && !computeIsStopped(i))) { this.connection.disconnect('The managed rental is stopped or no longer exists. Use GPU cloud to continue.'); this.store.set('cloud-connected-instance', null); }
        this.state.instances = this.rawInstances.map(raw => this.normalizeInstance(raw));
        for (const launch of this.state.launches) {
          const instance = this.rawInstances.find(i => i.id === launch.instanceId || (!launch.instanceId && i.label === launch.label));
          if (instance && !launch.instanceId) { launch.instanceId = instance.id; if (this.activeLaunch !== launch.id) { launch.phase = 'failed'; launch.message = 'Rental recovered. Checking its compute safety before continuing.'; } }
          if (!instance && launch.instanceId && this.activeLaunch !== launch.id && !['checking', 'requesting'].includes(launch.phase)) {
            if (launch.autoCleanup) this.markCleanupConfirmed(launch);
            else { launch.phase = 'destroyed'; launch.setupDeadline = null; launch.safetyStatus = 'disarmed'; launch.message = 'Instance no longer exists. Local inputs and completed results remain available.'; }
          }
          else if (instance && computeIsStopped(instance) && this.activeLaunch !== launch.id) {
            if (launch.autoCleanup?.state === 'pending') continue;
            launch.phase = 'stopped'; launch.setupDeadline = null; launch.safetyStatus = 'stopped';
            launch.message = (launch.lastFailure ? launch.lastFailure + ' ' : '') + 'Compute is confirmed stopped. Retained storage is still billed.';
          }
        }
      } catch (error) { this.state.error = (error as Error).message; }
      this.emit(); return this.state;
    })().finally(() => { this.refreshPromise = null; }); return this.refreshPromise;
  }
  normalizeInstance(raw: any): CloudInstance {
    const storageHourly = amount(raw.instance?.diskHour, raw.search?.diskHour, raw.storage_total_cost), disk = Number(raw.disk_space || 0);
    const memory = number(raw.gpu_ram);
    return { id: Number(raw.id), label: String(raw.label || 'Untitled instance'), gpu: String(raw.gpu_name || 'GPU'), count: Number(raw.num_gpus || 1), vram: memory && memory > 0 ? memory / 1024 : isDgxSpark(String(raw.gpu_name || '')) ? Number(raw.cpu_ram || 0) / 1000 : 0,
      ram: Number(raw.cpu_ram || 0) / 1000, state: String(raw.actual_status || 'unknown'), intendedState: String(raw.intended_status || raw.cur_state || ''), message: String(raw.status_msg || '').slice(0, 500),
      disk, diskUsed: number(raw.disk_usage), location: String(raw.geolocation || ''), totalHourly: amount(raw.instance?.totalHour, raw.dph_total), storageHourly,
      storageMonthly: amount(raw.storage_cost) === null ? null : Number(raw.storage_cost) * disk,
      managed: this.state.launches.some(l => l.instanceId === raw.id || l.label === raw.label), connected: this.store.value<number | null>('cloud-connected-instance', null) === raw.id && this.connection.status.state === 'online', computeStopped: computeIsStopped(raw),
      createdAt: raw.start_date ? new Date(Number(raw.start_date) * 1000).toISOString() : null };
  }
  async offers(filters: OfferFilters) {
    const modelFiles = modelFilesForSettings(this.store.draft().settings);
    const rows = await this.client.offers(filters); const offers = rows.map(raw => normalizeOffer(raw, filters, modelBytes(modelFiles) / 1e9)).filter(o => o.compatible && !this.hostCoolingDown(o.machineId));
    const value = (o: GpuOffer) => filters.sort === 'compute' ? o.computeHourly : filters.sort === 'setup' ? (o.totalHourly === null || o.modelDownloadCost === null ? null : o.totalHourly + o.modelDownloadCost) : o.totalHourly;
    offers.sort((a, b) => (value(a) ?? Infinity) - (value(b) ?? Infinity));
    this.rememberOffers(offers, filters);
    return { offers, searchedAt: new Date().toISOString(), filters };
  }
  private rememberOffers(offers: GpuOffer[], filters: OfferFilters) {
    for (const [key, value] of this.quotes) if (Date.parse(value.offer.expiresAt) + 10 * 60000 < Date.now()) this.quotes.delete(key);
    for (const offer of offers) this.quotes.set(offer.quote, { offer, filters });
    while (this.quotes.size > 2000) this.quotes.delete(this.quotes.keys().next().value!);
  }
  saveFavourite(source: { launchId?: string; quote?: string }) {
    const launch = source.launchId ? this.state.launches.find(item => item.id === source.launchId && item.instanceId) : undefined;
    const offer = launch?.offer || (source.quote ? this.quotes.get(source.quote)?.offer : undefined);
    if (!offer || !Number.isSafeInteger(offer.machineId) || offer.machineId <= 0) throw new Error('Choose a current offer or a previous Recast rental to save this host.');
    const favourites = this.state.favourites ||= [];
    if (favourites.some(item => item.machineId === offer.machineId && item.gpu === offer.gpu)) return this.state;
    if (favourites.length >= 50) throw new Error('Remove a saved host before adding more than 50 favourites.');
    favourites.unshift({ id: randomUUID(), machineId: offer.machineId, gpu: offer.gpu, location: offer.location, savedAt: new Date().toISOString(), sourceLaunchId: launch?.id, lastHourly: offer.totalHourly, status: 'unchecked', checkedAt: null, offer: null });
    this.emit(); return this.state;
  }
  removeFavourite(id: string) {
    this.favouriteChecks.delete(id); this.state.favourites = (this.state.favourites || []).filter(item => item.id !== id);
    this.emit(); return this.state;
  }
  async checkFavourites(filters: OfferFilters, id?: string) {
    const selected = (this.state.favourites || []).filter(item => !id || item.id === id);
    if (id && !selected.length) throw new Error('This favourite no longer exists.');
    const token = randomUUID(), scopedFilters = { ...filters, gpu: 'all' as const };
    for (const item of selected) { this.favouriteChecks.set(item.id, token); item.status = 'checking'; item.offer = null; item.message = undefined; }
    this.emit();
    const queue = [...selected];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        let result: Partial<GpuFavourite>;
        try {
          if (this.hostCoolingDown(item.machineId)) result = { status: 'cooldown', message: 'Startup failed on this host. It is excluded for 24 hours.' };
          else {
            const rows = await this.client.offers(scopedFilters, undefined, { machineId: item.machineId, gpu: item.gpu });
            const modelGB = modelBytes(modelFilesForSettings(this.store.draft().settings)) / 1e9;
            const offers = rows.map(raw => normalizeOffer(raw, scopedFilters, modelGB)).filter(offer => offer.compatible && offer.machineId === item!.machineId && offer.gpu === item!.gpu).sort((a, b) => (a.totalHourly ?? Infinity) - (b.totalHourly ?? Infinity));
            this.rememberOffers(offers, scopedFilters);
            result = offers.length ? { status: 'available', offer: offers[0], lastHourly: offers[0].totalHourly } : { status: 'unavailable', message: 'No rentable single-GPU offer matches this host and the selected storage, RAM, network and verification settings.' };
          }
        } catch (error) { result = { status: 'error', message: (error as Error).message }; }
        if (this.favouriteChecks.get(item.id) === token && this.state.favourites?.some(saved => saved.id === item!.id)) {
          Object.assign(item, result, { checkedAt: new Date().toISOString() }); this.favouriteChecks.delete(item.id); this.emit();
        }
      }
    }));
    return this.state;
  }
  private async verifyOffer(offer: GpuOffer, filters: OfferFilters, ceiling: number, approved = { download: offer.downloadPerGB, upload: offer.uploadPerGB }) {
    if (this.hostCoolingDown(offer.machineId)) throw new PreflightError('This host failed to start recently. It is excluded for 24 hours; choose another host.', 'host-unresponsive');
    const rows = await this.client.offers(filters, offer.id);
    if (!rows.length) throw new PreflightError('This exact offer is no longer listed with the selected resources. Choose a fresh offer from the marketplace.', 'offer-unavailable');
    const fresh = normalizeOffer(rows[0], filters, offer.modelDownloadGB);
    if (fresh.machineId !== offer.machineId || fresh.gpu !== offer.gpu) throw new Error('The offer hardware changed. Review a fresh offer before renting.');
    if (!fresh.compatible) throw new Error(fresh.reasons.join(' '));
    if (fresh.totalHourly === null || fresh.totalHourly > ceiling + 0.000001) throw new PreflightError('The hourly price increased. Review a fresh quote before renting.', 'price-changed');
    if (approved.download === null || approved.upload === null || fresh.downloadPerGB === null || fresh.uploadPerGB === null) throw new PreflightError('Transfer pricing is unavailable. Choose an offer with known download and upload fees.', 'transfer-changed');
    if (fresh.downloadPerGB > approved.download + 1e-9 || fresh.uploadPerGB > approved.upload + 1e-9) throw new PreflightError('Transfer fees increased. Review a fresh quote before renting.', 'transfer-changed');
    return fresh;
  }
  private async localPreflight(identity: string) {
    if (this.options.preflight) await this.options.preflight(identity);
    else await command('python3', [path.join(this.repo, 'scripts/managed_instance.py'), '--check-local', '--identity', identity], undefined, 20000);
  }
  async checkConfiguration(quote: string) {
    const selected = this.quotes.get(quote); if (!selected || selected.offer.totalHourly === null) throw new Error('Refresh the marketplace and choose an offer first.');
    const checks: { name: string; ok: boolean; message: string }[] = [];
    const check = async (name: string, run: () => Promise<unknown>) => { try { await run(); checks.push({ name, ok: true, message: 'Passed' }); } catch (error) { checks.push({ name, ok: false, message: (error as Error).message }); } };
    const dedicated = this.options.sshIdentity || path.join(os.homedir(), '.ssh/comfyui_vast'); const identity = existsSync(dedicated) ? dedicated : path.join(this.store.root, 'private/id_ed25519');
    await check('Local tools, SSH authentication and deployment files', () => this.localPreflight(identity));
    await check('Existing account SSH key', async () => {
      const publicKey = (await readFile(identity + '.pub', 'utf8')).trim();
      if (!hasRegisteredSshKey(await this.client.request('/api/v0/ssh/'), publicKey)) throw new Error('This public key will be registered when you launch. No key was changed by this check.');
    });
    await check('Exact rental ask, hardware, hourly price and transfer fees', () => this.verifyOffer(selected.offer, selected.filters, selected.offer.totalHourly!));
    return { ready: checks.every(c => c.ok), checks, checkedAt: new Date().toISOString(), rentalRequests: 0 };
  }
  assertIdle() { if (this.runner.active || this.store.jobs().some(j => j.origin === 'render' && ['queued', 'running', 'reconnecting'].includes(j.status))) throw new Error('Cancel or finish the render queue before changing GPU instances.'); }
  change(launch: CloudLaunch, phase: CloudLaunch['phase'], message: string) { launch.phase = phase; launch.message = message; launch.updatedAt = new Date().toISOString(); this.emit(); }
  async ensureSshKey() {
    const dedicated = this.options.sshIdentity || path.join(os.homedir(), '.ssh/comfyui_vast'); let identity = existsSync(dedicated) && existsSync(dedicated + '.pub') ? dedicated : path.join(this.store.root, 'private/id_ed25519');
    if (!existsSync(identity)) { await mkdir(path.dirname(identity), { recursive: true, mode: 0o700 }); await command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'recast-studio', '-f', identity]); }
    await access(identity); const publicKey = (await readFile(identity + '.pub', 'utf8')).trim(); if (!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+/.test(publicKey)) throw new Error('The local SSH public key is invalid.');
    const response = await this.client.request('/api/v0/ssh/');
    if (!hasRegisteredSshKey(response, publicKey)) {
      try { await this.client.request('/api/v0/ssh/', 'POST', { ssh_key: publicKey }); }
      catch (error) {
        // Another request may register the key between listing and creating it.
        // Only recover a duplicate after verifying this exact key is registered.
        if (!(error instanceof VastError) || !/SSH key.*already exists|duplicate.*SSH key/i.test(error.message)) throw error;
        const latest = await this.client.request('/api/v0/ssh/'); if (!hasRegisteredSshKey(latest, publicKey)) throw error;
      }
    }
    return identity;
  }
  launch(quote: string, approvedHourly: number, requestKey: string) {
    const existing = this.state.launches.find(l => l.requestKey === requestKey); if (existing) return existing;
    this.assertIdle(); if (this.state.busy) throw new Error('Another GPU is being prepared. Wait for it or stop it first.');
    const selected = this.quotes.get(quote); if (!selected) throw new Error('This quote is no longer cached. Refresh the marketplace before renting.');
    if (selected.offer.totalHourly === null || approvedHourly < selected.offer.totalHourly) throw new Error('Review the full hourly price before renting.');
    const id = randomUUID(), now = new Date().toISOString(); const launch: CloudLaunch = { id, requestKey, instanceId: null, label: 'recast-' + id, offer: selected.offer, phase: 'checking', message: 'Checking current availability and your SSH key', createdAt: now, updatedAt: now, logs: [], creationAttempted: false, approvedHourly, filters: selected.filters,
      approvedTransfer: { download: selected.offer.downloadPerGB, upload: selected.offer.uploadPerGB }, autoStopOnFailure: true, safetyStatus: 'disarmed', emptyRental: true };
    this.state.launches.unshift(launch); this.state.busy = true; this.activeLaunch = id; this.emit();
    this.activeTask = this.rent(launch, selected.filters, approvedHourly); return launch;
  }
  private async rent(launch: CloudLaunch, filters: OfferFilters, ceiling: number) {
    try {
      await this.refresh(); if (this.state.error) throw new Error(this.state.error);
      const unresolved = this.state.launches.find(l => l.id !== launch.id && !['ready', 'stopped', 'destroyed'].includes(l.phase) && (['unconfirmed', 'stop_requested'].includes(l.safetyStatus || '') || (l.creationAttempted && !l.instanceId && l.phase === 'unknown')));
      if (unresolved) throw new Error('A previous rental request or compute stop is still unconfirmed. Resolve it in My instances or Vast before creating another paid rental.');
      const existing = this.state.instances.find(i => i.managed && !i.computeStopped && i.id !== launch.instanceId);
      if (existing) throw new Error(`Instance #${existing.id} is still active. Stop or use it before renting another GPU.`);
      const identity = await this.ensureSshKey();
      await this.localPreflight(identity);
      const fresh = await this.verifyOffer(launch.offer, filters, ceiling, launch.approvedTransfer);
      if (this.closing || this.stopped.has(launch.id)) return;
      launch.offer = fresh; launch.creationAttempted = true; this.change(launch, 'requesting', 'Creating your Vast instance. Billing begins when the rental starts.');
      const response = await this.client.request(`/api/v0/asks/${fresh.id}/`, 'PUT', { client_id: 'me', image: RENTAL_IMAGE, disk: fresh.disk, label: launch.label, runtype: 'ssh_direct', target_state: 'running', cancel_unavail: true, onstart: SSH_ONSTART });
      const id = Number(response?.new_contract); if (!Number.isSafeInteger(id) || id <= 0) throw new VastError('Vast accepted the request without an instance ID. Check instances before retrying.', 503, true);
      launch.instanceId = id;
      if (this.closing) { launch.needsReconnect = true; this.change(launch, 'waiting', 'Rental created. Reconnect setup to follow the existing instance.'); return; }
      if (this.stopped.has(launch.id)) { await this.stopRental(launch, 'Launch cancelled while the rental request was in progress.'); return; }
      this.change(launch, 'waiting', 'Rental created. Waiting for the container and SSH port.'); await this.prepareGuarded(launch, identity);
    } catch (error) { if (!this.closing && !this.stopped.has(launch.id)) await this.failedSetup(launch, error); else if (launch.creationAttempted && !launch.instanceId) { launch.safetyStatus = 'unconfirmed'; launch.phase = 'unknown'; launch.lastFailure = (error as Error).message; this.emit(); } }
    finally { if (this.activeLaunch === launch.id) { this.state.busy = false; this.activeLaunch = null; this.emit(); } await this.refresh(); }
  }
  async continue(launch: CloudLaunch) {
    if (launch.autoCleanup?.state === 'pending') throw new Error('Automatic removal of this failed rental is still being confirmed. Wait for confirmation before renting again.');
    this.assertIdle(); if (this.state.busy) throw new Error('Another setup is still active.');
    if (this.resuming.has(launch.id)) throw new Error('This rental is already reconnecting.');
    this.resuming.add(launch.id);
    try {
    const previousStop = this.stopChecks.get(launch.id); if (previousStop) await previousStop;
    await this.refresh(); if (this.state.error) throw new Error(this.state.error);
    if (this.state.busy) throw new Error('Another setup is still active.');
    if (!launch.instanceId && canRetryRental(launch)) {
      const ceiling = launch.approvedHourly ?? launch.offer.totalHourly; if (ceiling === null) throw new Error('Choose a fresh offer to review its hourly price before renting.');
      const filters = launch.filters || offerFiltersSchema.parse({ disk: launch.offer.disk, ram: launch.offer.ram >= 96 ? 96 : launch.offer.ram >= 64 ? 64 : 48, verified: launch.offer.verified });
      launch.creationAttempted = false; launch.approvedHourly = ceiling; launch.filters = filters;
      this.stopped.delete(launch.id); this.state.busy = true; this.activeLaunch = launch.id; this.change(launch, 'checking', 'Retrying preflight checks at the previously approved price ceiling');
      this.activeTask = this.rent(launch, filters, ceiling); return launch;
    }
    if (!launch.instanceId || launch.phase === 'destroyed') throw new Error('No existing rental was found for this request. Check the Vast console before starting a new request if creation was unconfirmed.');
    if (this.stopChecks.has(launch.id)) throw new Error('Wait for stop confirmation before restarting this rental.');
    this.stopped.delete(launch.id); launch.safetyStatus = 'disarmed'; launch.setupDeadline = null; launch.lastFailure = undefined; this.state.busy = true; this.activeLaunch = launch.id; this.change(launch, 'checking', 'Checking local prerequisites before resuming this existing rental.');
    this.activeTask = (async () => { try {
      const identity = await this.ensureSshKey(); await this.localPreflight(identity);
      if (this.closing || this.stopped.has(launch.id)) return;
      const current = this.rawInstances.find(instance => instance.id === launch.instanceId);
      if (!current) throw new Error('The existing rental could not be confirmed. Refresh before reconnecting.');
      if (!['running', 'loading', 'creating'].includes(current.actual_status) && current.intended_status !== 'running') {
        this.change(launch, 'requesting', 'Starting the existing rental. Billing resumes when compute starts.');
        await this.client.request(`/api/v0/instances/${launch.instanceId}/`, 'PUT', { state: 'running' });
      } else this.change(launch, 'waiting', 'Following the existing rental without restarting its container.');
      if (this.closing) { launch.needsReconnect = true; this.change(launch, 'waiting', 'Rental started. Reconnect setup to follow this same instance.'); return; }
      if (this.stopped.has(launch.id)) { await this.stopRental(launch, 'Launch cancelled while the start request was in progress.'); return; }
      await this.prepareGuarded(launch, identity);
    }
      catch (error) { if (!this.closing && !this.stopped.has(launch.id)) await this.failedSetup(launch, error); }
      finally { this.state.busy = false; this.activeLaunch = null; this.emit(); await this.refresh(); } })(); return launch;
    } finally { this.resuming.delete(launch.id); }
  }
  private async failedSetup(launch: CloudLaunch, error: unknown) {
    launch.lastFailure = (error instanceof Error ? error.message : String(error)).slice(0, 900);
    launch.failureCode = error instanceof EmptyHostError ? 'host-unresponsive' : error instanceof PreflightError ? error.code : launch.creationAttempted && !launch.instanceId && error instanceof VastError && error.ambiguous ? 'request-unconfirmed' : 'setup-failed';
    const unknown = launch.failureCode === 'request-unconfirmed';
    launch.safetyStatus = unknown ? 'unconfirmed' : launch.instanceId ? 'armed' : 'disarmed';
    this.change(launch, unknown ? 'unknown' : 'failed', launch.lastFailure + (unknown ? ' Checking for the accepted rental; this request will not be sent again.' : ''));
    if (error instanceof EmptyHostError && launch.instanceId && launch.emptyRental && !launch.engineSetupStartedAt) {
      this.stopped.add(launch.id);
      launch.autoCleanup = { state: 'pending', reason: launch.lastFailure, requestedAt: new Date().toISOString() };
      await this.cleanupEmptyRental(launch); return;
    }
    if (launch.instanceId && launch.autoStopOnFailure !== false) { this.stopped.add(launch.id); await this.stopRental(launch, launch.lastFailure); }
  }
  private async prepareGuarded(launch: CloudLaunch, identity: string) {
    const controller = new AbortController(); this.activeAbort = controller;
    const warningAfter = this.options.setupWarningMs ?? 15 * 60000;
    if (!launch.needsReconnect || !launch.setupStartedAt) launch.setupStartedAt = new Date().toISOString();
    launch.setupWarningAt = new Date(Date.parse(launch.setupStartedAt) + warningAfter).toISOString(); launch.setupDeadline = null;
    launch.needsReconnect = false; launch.setupSlow = false; launch.warning = null; launch.safetyStatus = 'armed'; launch.autoStopOnFailure = true; launch.lastFailure = undefined; launch.failureCode = undefined;
    launch.setupDownloads = []; this.emit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason || new Error('GPU setup interrupted.')), { once: true }));
    try {
      timer = setTimeout(() => { if (this.closing || controller.signal.aborted) return; launch.setupSlow = true; launch.warning = 'Taking longer than usual. Setup is still running; elapsed time will not stop this instance.'; this.emit(); }, Math.max(0, Date.parse(launch.setupWarningAt) - Date.now()));
      await Promise.race([this.prepare(launch, identity, controller.signal), aborted]);
    } finally { if (timer) clearTimeout(timer); if (this.activeAbort === controller) this.activeAbort = null; }
  }
  private hostCoolingDown(machineId: number) {
    return this.state.launches.some(launch => launch.offer.machineId === machineId && launch.autoCleanup && Date.now() - Date.parse(launch.autoCleanup.requestedAt) < 24 * 60 * 60_000);
  }
  private markCleanupConfirmed(launch: CloudLaunch) {
    if (launch.autoCleanup) { launch.autoCleanup.state = 'confirmed'; launch.autoCleanup.confirmedAt ||= new Date().toISOString(); launch.autoCleanup.lastError = undefined; }
    launch.phase = 'destroyed'; launch.safetyStatus = 'disarmed'; launch.setupDeadline = null; launch.warning = null; launch.needsReconnect = false;
    launch.message = 'Failed host removed automatically. Rental and remote disk deletion confirmed.';
    launch.updatedAt = new Date().toISOString();
  }
  private cleanupEmptyRental(launch: CloudLaunch): Promise<boolean> {
    const existing = this.cleanupChecks.get(launch.id); if (existing) return existing;
    const task = this.confirmEmptyRentalCleanup(launch).finally(() => this.cleanupChecks.delete(launch.id));
    this.cleanupChecks.set(launch.id, task); return task;
  }
  private async confirmEmptyRentalCleanup(launch: CloudLaunch) {
    if (!launch.instanceId || !launch.autoCleanup || !launch.emptyRental || launch.engineSetupStartedAt) return false;
    const id = launch.instanceId;
    launch.safetyStatus = 'unconfirmed';
    this.change(launch, 'destroying', 'Provisioning failed. Cancelling and removing this empty rental; checking Vast for confirmation.');
    try {
      const current = await this.client.instance(id);
      if (!current) { this.markCleanupConfirmed(launch); this.emit(); return true; }
      if (current.actual_status === 'running' && !fatalContainerStatus(current.status_msg)) {
        launch.autoCleanup = undefined; launch.safetyStatus = 'disarmed'; this.stopped.delete(launch.id);
        this.change(launch, 'failed', 'The host began running during the final check. Automatic deletion was cancelled; connect again to finish setup.'); return false;
      }
      // A stop failure must not prevent deletion of a confirmed empty rental.
      await this.client.request(`/api/v0/instances/${id}/`, 'PUT', { state: 'stopped' }).catch(() => undefined);
      let requestError = '';
      try { await this.client.request(`/api/v0/instances/${id}/`, 'DELETE'); }
      catch (error) { requestError = (error as Error).message; }
      for (let attempt = 0; attempt < (this.options.stopPollAttempts ?? 3); attempt++) {
        if (!await this.client.instance(id)) { this.markCleanupConfirmed(launch); this.emit(); return true; }
        if (attempt + 1 < (this.options.stopPollAttempts ?? 3)) await pause(this.options.pollMs ?? 5000);
      }
      throw new Error(requestError || 'Vast still reports this rental.');
    } catch (error) {
      if (launch.autoCleanup) launch.autoCleanup.lastError = (error as Error).message.slice(0, 500); launch.safetyStatus = 'unconfirmed';
      this.change(launch, 'failed', 'Automatic deletion is not yet confirmed. Recast will keep checking and retrying cleanup. Check Vast if this persists.'); return false;
    }
  }
  private async sshServiceReachable(instance: any) {
    if (this.options.sshReachable) return this.options.sshReachable(instance);
    if (!/^[a-zA-Z0-9.-]+$/.test(instance.ssh_host || '') || !Number.isInteger(Number(instance.ssh_port)) || Number(instance.ssh_port) < 1 || Number(instance.ssh_port) > 65535) return true;
    return new Promise<boolean>(resolve => {
      const socket = createConnection({ host: instance.ssh_host, port: Number(instance.ssh_port) });
      const finish = (reachable: boolean) => { socket.destroy(); resolve(reachable); };
      socket.setTimeout(3000); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
    });
  }
  private stopRental(launch: CloudLaunch, reason: string): Promise<boolean> {
    const existing = this.stopChecks.get(launch.id); if (existing) return existing;
    const task = this.confirmStop(launch, reason).finally(() => { this.stopChecks.delete(launch.id); }); this.stopChecks.set(launch.id, task); return task;
  }
  private async confirmStop(launch: CloudLaunch, reason: string) {
    if (!launch.instanceId) return false;
    launch.safetyStatus = 'stop_requested'; launch.setupDeadline = null;
    this.change(launch, 'stopping', reason + ' Requesting compute stop and checking Vast’s actual status.');
    if (this.activeLaunch === launch.id || this.store.value('cloud-connected-instance', null) === launch.instanceId) this.connection.disconnect('Stopping the managed rental');
    let requestError = '';
    try { await this.client.request(`/api/v0/instances/${launch.instanceId}/`, 'PUT', { state: 'stopped' }, 15000); }
    catch (error) { requestError = (error as Error).message; }
    const deadline = Date.now() + 15000, attempts = this.options.stopPollAttempts ?? 6;
    for (let i = 0; i < attempts && Date.now() < deadline; i++) {
      try {
        const instance = await this.client.instance(launch.instanceId);
        if (!instance || computeIsStopped(instance)) {
          launch.safetyStatus = instance ? 'stopped' : 'disarmed';
          this.change(launch, instance ? 'stopped' : 'destroyed', reason + (instance ? ' Compute is confirmed stopped. Storage remains billed; downloaded model files are retained.' : ' The rental no longer exists. Local files are kept.'));
          if (this.store.value('cloud-connected-instance', null) === launch.instanceId) this.store.set('cloud-connected-instance', null);
          return true;
        }
      } catch (error) { requestError = (error as Error).message; }
      if (i + 1 < attempts) await pause(this.options.pollMs ?? 2000);
    }
    launch.safetyStatus = 'unconfirmed';
    this.change(launch, 'failed', reason + ' Compute stop is NOT confirmed and charges may continue. The local app will keep checking; you can also stop it in Vast. ' + requestError);
    return false;
  }
  private async prepare(launch: CloudLaunch, identity: string, signal: AbortSignal) {
    const check = () => { if (signal.aborted || this.stopped.has(launch.id)) throw signal.reason || new Error('GPU setup interrupted.'); };
    this.connection.disconnect('Preparing the selected GPU'); this.change(launch, 'waiting', 'Waiting for Vast to report the instance as running');
    let instance: any;
    for (let attempt = 0; ; attempt++) {
      check();
      try { instance = await this.client.instance(launch.instanceId!); }
      catch (error) { launch.hostWatch = undefined; if (!(error instanceof VastError) || error.status < 429) throw error; launch.warning = 'Vast status is temporarily unavailable. Retrying the existing rental.'; this.emit(); await pause(this.options.pollMs ?? 5000); continue; }
      check();
      if (!instance) { if (attempt < 12) { await pause(this.options.pollMs ?? 5000); continue; } throw new Error('The rental no longer exists.'); }
      if (instance.actual_status === 'running' && instance.ssh_host && instance.ssh_port) break;
      if (instance.actual_status === 'error') throw new EmptyHostError('Vast reports a container error before setup: ' + (instance.status_msg || 'unknown host error'));
      const containerError = fatalContainerStatus(instance.status_msg);
      if (containerError) throw new EmptyHostError('Vast’s container builder failed before ComfyUI could start: ' + containerError + '. Choose another host.');
      if (instance.ssh_host && instance.ssh_port && await this.probeGpu(instance, identity)) {
        launch.warning = 'Vast’s status is delayed, but SSH and the selected GPU are reachable. Continuing setup.'; this.emit(); break;
      }
      if (launch.emptyRental && !launch.engineSetupStartedAt && hasNoContainerSignals(instance)) {
        launch.hostWatch = observeHostSilence(launch.hostWatch);
        if (hostSilenceExpired(launch.hostWatch, Date.now(), this.options.hostSilenceMs)) {
          if (await this.sshServiceReachable(instance)) launch.hostWatch = undefined;
          else {
            const confirmed = await this.client.instance(launch.instanceId!); check();
            if (confirmed && hasNoContainerSignals(confirmed) && !await this.sshServiceReachable(confirmed)) throw new EmptyHostError('Host provisioning stalled: repeated checks found no container status, no assigned direct ports and unreachable SSH for five minutes.');
            launch.hostWatch = undefined;
          }
        }
      } else launch.hostWatch = undefined;
      const status = String(instance.status_msg || (hasNoContainerSignals(instance) ? 'Waiting for host response. Container status and direct ports are missing; automatic host checks are active.' : 'Container status: ' + (instance.actual_status || 'not reported'))).trim();
      if (status !== launch.message.trim()) {
        launch.logs.push(`[${new Date().toISOString()}] Vast: ${status}`.slice(0, 800)); launch.logs = launch.logs.slice(-120);
        launch.lastLogAt = new Date().toISOString();
      }
      this.change(launch, 'waiting', status); await pause(this.options.pollMs ?? 5000);
    }
    launch.emptyRental = false; launch.hostWatch = undefined; launch.engineSetupStartedAt ||= new Date().toISOString();
    this.change(launch, 'installing', 'Installing the blank ComfyUI engine. Model files download only when requested.');
    const log = (line: string) => {
      if (signal.aborted || this.stopped.has(launch.id)) return;
      if (line.startsWith('RECAST_MODEL_PROGRESS ')) {
        try {
          const event = JSON.parse(line.slice(22)), file = launch.setupDownloads?.find(file => file.id === event.destination);
          if (file && event.total === file.total && Number.isFinite(event.downloaded) && event.downloaded >= 0 && event.downloaded <= file.total && ['downloading', 'verifying', 'ready'].includes(event.phase)) Object.assign(file, { downloaded: event.downloaded, phase: event.phase });
        } catch { /* Only validated downloader telemetry updates progress. */ }
      }
      launch.logs.push(line.slice(0, 800)); launch.logs = launch.logs.slice(-120);
      if (line.startsWith('RECAST_WARNING ')) launch.warning = line.slice(15, 500);
      if (line.startsWith('RECAST_STAGE ')) launch.stageDetail = line.slice(13, 500);
      if (/Downloading|Verified:|CUDA test|Setup complete|RECAST_STAGE/.test(line)) launch.message = line.replace('RECAST_STAGE ', '').slice(0, 250);
      launch.lastLogAt = launch.updatedAt = new Date().toISOString(); this.emit();
    };
    if (this.options.provision) await this.options.provision(instance, log, signal);
    else await this.runProvision(instance, identity, log, signal);
    check();
    this.change(launch, 'connecting', 'Checking the actual CUDA ComfyUI server');
    await this.connection.connect('http://127.0.0.1:8188', false); check(); if (this.connection.status.state !== 'online') throw new Error(this.connection.status.message);
    launch.setupDeadline = null; launch.setupWarningAt = null; launch.setupSlow = false; launch.warning = null; launch.safetyStatus = 'disarmed'; this.store.set('cloud-connected-instance', launch.instanceId); this.change(launch, 'ready', 'ComfyUI engine connected. Download the files needed by your selected settings before rendering.');
  }
  private async probeGpu(instance: any, identity: string) {
    if (this.options.probe) return this.options.probe(instance, identity);
    if (!Number.isInteger(Number(instance.ssh_port)) || Number(instance.ssh_port) < 1 || Number(instance.ssh_port) > 65535 || !/^[a-zA-Z0-9.-]+$/.test(instance.ssh_host)) return false;
    try {
      const output = await command('ssh', ['-p', String(instance.ssh_port), '-i', identity, '-o', `HostKeyAlias=recast-instance-${instance.id}`, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-T', `root@${instance.ssh_host}`, 'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits'], undefined, 10000);
      return matchesGpuProbe(instance, output);
    } catch { return false; }
  }
  private runProvision(instance: any, identity: string, log: (line: string) => void, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const child = spawn('python3', ['-u', path.join(this.repo, 'scripts/managed_instance.py'), '--host', String(instance.ssh_host), '--port', String(instance.ssh_port), '--identity', identity, '--instance-id', String(instance.id)], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      this.provision = child; let buffer = '', tail = ''; const abort = () => { if (this.provision === child) this.stopProvision(); }; signal.addEventListener('abort', abort, { once: true });
      const receive = (chunk: Buffer) => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) if (line.trim()) { log(line); tail = line; } };
      child.stdout!.on('data', receive); child.stderr!.on('data', receive);
      child.once('error', error => { signal.removeEventListener('abort', abort); if (this.provision === child) this.provision = null; reject(error); });
      child.once('close', code => { signal.removeEventListener('abort', abort); if (this.provision === child) this.provision = null; if (buffer.trim()) log(buffer); code === 0 && !signal.aborted ? resolve() : reject(signal.reason || new Error(tail || `Setup exited (${code}).`)); });
    });
  }
  private stopProvision() { const child = this.provision; if (child?.pid) { try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM'); } catch { /* Child already exited. */ } } }
  private interruptLocalRender(id: number, reason: string) {
    if (this.store.value('cloud-connected-instance', null) !== id) return;
    this.runner.interrupt?.(reason);
  }
  async cancel(launch: CloudLaunch) {
    this.stopped.add(launch.id);
    if (this.activeLaunch === launch.id) { this.activeAbort?.abort(new Error('Launch cancelled.')); this.stopProvision(); }
    launch.lastFailure = 'Launch cancelled by you.'; launch.setupDeadline = null;
    if (launch.instanceId) { this.interruptLocalRender(launch.instanceId, 'The GPU launch was cancelled.'); await this.stopRental(launch, launch.lastFailure); }
    else if (launch.creationAttempted) { launch.safetyStatus = 'unconfirmed'; this.change(launch, 'unknown', 'Cancellation requested. Checking whether Vast accepted the rental so its compute can be stopped. No second rental will be created.'); }
    else { launch.safetyStatus = 'disarmed'; this.change(launch, 'failed', 'Launch cancelled before any rental request was sent.'); }
    return launch;
  }
  async action(id: number, action: 'start' | 'stop' | 'destroy' | 'connect', confirmation?: string) {
    if (action === 'start' || action === 'connect') this.assertIdle();
    await this.refresh(); if (this.state.error && (action === 'start' || action === 'connect')) throw new Error(this.state.error);
    const launch = this.state.launches.find(l => l.instanceId === id); if (!launch) throw new Error('This instance was created outside Recast. Manage it in Vast; Recast controls only its own rentals.');
    if (!this.state.error && !this.rawInstances.some(i => i.id === id)) throw new Error('This instance no longer exists.');
    if (action === 'destroy' && confirmation !== String(id)) throw new Error('Enter the instance ID to confirm permanent deletion of its remote disk.');
    if (action === 'start' || action === 'connect') return this.continue(launch);
    this.stopped.add(launch.id); if (this.activeLaunch === launch.id) { this.activeAbort?.abort(new Error('Instance action requested.')); this.stopProvision(); }
    this.interruptLocalRender(id, action === 'destroy' ? 'The GPU instance is being destroyed. Local completed segments are kept; reuse settings for a new rental.' : 'GPU compute is being stopped. Reconnect before checking the unfinished render.');
    if (action === 'stop') { const confirmed = await this.stopRental(launch, 'Compute stop requested by you.'); await this.refresh(); if (!confirmed) throw new Error(launch.message); return launch; }
    launch.safetyStatus = 'stop_requested'; launch.setupDeadline = null; this.change(launch, 'destroying', 'Deleting the rental and checking that its remote disk is gone.');
    try {
      await this.client.request(`/api/v0/instances/${id}/`, 'DELETE');
      const stillExists = await this.client.instance(id);
      if (stillExists) throw new Error('The delete request was acknowledged, but the rental is still present.');
    } catch (error) {
      launch.lastFailure = 'Instance deletion could not be confirmed. Compute stop will be checked to limit further charges.';
      await this.stopRental(launch, launch.lastFailure); await this.refresh(); throw error;
    }
    launch.safetyStatus = 'disarmed'; this.change(launch, 'destroyed', 'Rental deletion confirmed. Local inputs and completed results are kept.');
    if (this.store.value<number | null>('cloud-connected-instance', null) === id || this.activeLaunch === launch.id) this.connection.disconnect('The GPU instance was destroyed. Rent another when ready.');
    await this.refresh(); return launch;
  }
}
