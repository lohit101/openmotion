import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store';
import { CloudManager, computeIsStopped, fatalContainerStatus, hasRegisteredSshKey, matchesGpuProbe, normalizeOffer, RENTAL_IMAGE, SSH_ONSTART, VastClient, VastError } from '../server/cloud';
import { DOWNLOAD_PRICE_CEILING, GPU_COMPUTE_CEILING, offerFiltersSchema, withinComputeBudget, withinDownloadBudget } from '../shared/cloud';
import type { ConnectionManager } from '../server/comfy';
import type { Runner } from '../server/runner';
import { pinnedModels, setupModelFiles, SOCIAL_STYLE } from '../shared/models';

const filters = offerFiltersSchema.parse({});
const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixturePublicKeyOnly test-fixture';
const rawOffer = () => ({ id: 123, ask_contract_id: 123, bundle_id: 987654321, machine_id: 99, gpu_name: 'RTX 3090', num_gpus: 1, gpu_ram: 24576, cpu_ram: 64000, cpu_cores_effective: 8,
  cpu_name: 'Fixture CPU', geolocation: 'Fixture location', verification: 'verified', reliability2: .997, driver_version: '595.84', cuda_max_good: 13,
  disk_space: 500, disk_bw: 1400, inet_down: 1000, inet_up: 500, inet_down_cost: .001, inet_up_cost: .002, direct_port_count: 4, pcie_bw: 24,
  search: { gpuCostPerHour: .2, diskHour: .03, totalHour: .23 }, dph_total: .23, storage_total_cost: .03, storage_cost: .27, rentable: true, rented: false });
async function until(predicate: () => boolean, timeout = 4000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Cloud fixture timed out'); await new Promise(r => setTimeout(r, 10)); } }
function provider() {
  let creationState: any = {}, deleteAckOnly = false, rejectCreate = false;
  let offer = rawOffer(), instance: any = null, loseCreate = false, loseStop = false, stopAckOnly = false, omitList = false, invalidList = false, createCount = 0, sshKeys: any = [{ id: 51, public_key: publicKey, deleted_at: null }], registrationError: { status: number; msg: string; registerMatching?: boolean } | null = null; const calls: { url: URL; method: string; body: any; auth: string | null }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, auth: new Headers(init?.headers).get('Authorization') });
    let value: any;
    if (url.pathname === '/api/v1/instances/') value = invalidList ? { success: true } : { instances: instance && !omitList ? [instance] : [] };
    else if (url.pathname === '/api/v0/ssh/' && method === 'GET') value = sshKeys;
    else if (url.pathname === '/api/v0/ssh/' && method === 'POST') {
      if (registrationError) {
        if (registrationError.registerMatching) sshKeys = [{ id: 51, public_key: publicKey, deleted_at: null }];
        return new Response(JSON.stringify({ success: false, msg: registrationError.msg }), { status: registrationError.status, headers: { 'Content-Type': 'application/json' } });
      }
      sshKeys = [{ id: 51, public_key: body.ssh_key, deleted_at: null }]; value = { success: true };
    }
    // Captured live behavior: `id` does not revalidate the rental ask. The
    // ask_contract_id predicate must match the same ID sent to PUT /asks/.
    else if (url.pathname === '/api/v0/bundles/') value = { offers: body.id || (body.ask_contract_id && body.ask_contract_id.eq !== offer.ask_contract_id) ? [] : [offer] };
    else if (url.pathname === '/api/v0/asks/123/' && method === 'PUT') {
      if (rejectCreate) { createCount++; return new Response(JSON.stringify({ success: false, msg: 'This offer was rented by someone else.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      createCount++; instance = { ...offer, id: 777, label: body.label, actual_status: 'running', intended_status: 'running', ssh_host: '127.0.0.1', ssh_port: 2222, disk_space: body.disk, ...creationState };
      if (loseCreate) throw new Error('response lost after acceptance'); value = { success: true, new_contract: 777 };
    } else if (url.pathname === '/api/v0/instances/777/' && method === 'GET') value = { instances: instance };
    else if (url.pathname === '/api/v0/instances/777/' && method === 'PUT') { if (body.state === 'stopped' && loseStop) throw new Error('Unconfirmed stop'); if (!(body.state === 'stopped' && stopAckOnly)) instance.actual_status = body.state; instance.intended_status = body.state; value = { success: true }; }
    else if (url.pathname === '/api/v0/instances/777/' && method === 'DELETE') { if (!deleteAckOnly) instance = null; value = { success: true }; }
    else throw new Error('Unexpected fixture request ' + method + ' ' + url);
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  });
  return { fetcher, calls, rejectCreateRequest(value = true) { rejectCreate = value; }, setCreationState(value: any) { creationState = value; }, updateInstance(value: any) { Object.assign(instance, value); }, acknowledgeDeleteOnly(value = true) { deleteAckOnly = value; }, setGpu(name: string, memory: number) { offer.gpu_name = name; offer.gpu_ram = memory; }, setPrice(value: number) { offer = { ...offer, search: { ...offer.search, totalHour: value } }; }, setTransfer(value: number) { offer.inet_down_cost = value; }, setSshKeys(value: any) { sshKeys = value; }, failRegistration(error: typeof registrationError) { registrationError = error; }, loseCreateResponse() { loseCreate = true; }, loseStopResponse(value = true) { loseStop = value; }, acknowledgeStopOnly() { stopAckOnly = true; }, omitInstanceFromList(value = true) { omitList = value; }, invalidInstanceList() { invalidList = true; }, get createCount() { return createCount; } };
}
describe('Vast marketplace, billing and lifecycle', () => {
  let store: Store | undefined, root = '', tracked: CloudManager | undefined;
  afterEach(async () => { tracked?.dispose(); tracked = undefined; store?.close(); store = undefined; if (root) await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  async function manager(options: ConstructorParameters<typeof CloudManager>[4] = {}) {
    root = await mkdtemp(path.join(os.tmpdir(), 'recast-cloud-')); vi.spyOn(os, 'homedir').mockReturnValue(root);
    await mkdir(path.join(root, '.config/vastai'), { recursive: true });
    await writeFile(path.join(root, '.config/vastai/vast_api_key'), 'fixture-vast-key-never-real\n', { mode: 0o600 });
    store = new Store(root); const fixture = provider();
    const identity = path.join(root, 'fixture-identity'); await writeFile(identity, 'Fixture file only. Never used for SSH.'); await writeFile(identity + '.pub', publicKey);
    const connection = { status: { state: 'offline', message: '' }, disconnect: vi.fn((): void => { connection.status.state = 'offline'; }), connect: vi.fn(async () => { connection.status.state = 'online'; }) };
    const provision = vi.fn(async (_instance, log: (line: string) => void) => { log('RECAST_STAGE Fixture installation verified'); });
    const preflight = vi.fn(async (_identity: string): Promise<void> => undefined);
    const cloud = new CloudManager(store, connection as unknown as ConnectionManager, { active: null } as Runner, process.cwd(), { fetcher: fixture.fetcher, provision, preflight, sshIdentity: identity, backgroundSafety: false, pollMs: 1, stopPollAttempts: 2, ...options }); tracked = cloud;
    vi.spyOn(cloud, 'ensureSshKey').mockResolvedValue(identity); return { cloud, fixture, provision, connection, identity, preflight };
  }
  it('automatically pauses a rechecked idle rental without cancelling work or deleting its disk', async () => {
    const { cloud, fixture, connection } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'idle-pause'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(connection.status.state).toBe('online');
    const empty = vi.fn(async () => { expect(cloud.state.busy).toBe(true); return true; });
    expect(await cloud.pauseIdle(777, () => true, empty)).toBe('confirmed');
    expect(launch.phase).toBe('stopped'); expect(empty).toHaveBeenCalledOnce();
    expect(fixture.calls.filter(call => call.method === 'DELETE')).toHaveLength(0);
    expect(fixture.calls.filter(call => call.method === 'PUT' && call.body?.state === 'stopped')).toHaveLength(1);
  });
  it('abandons idle stop when new work starts during the final queue check or activity is unknown', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    cloud.launch(offers[0].quote, .23, 'idle-race'); await until(() => !cloud.state.busy);
    let idle = true;
    expect(await cloud.pauseIdle(777, () => idle, async () => { idle = false; return true; })).toBe('aborted');
    idle = true;
    expect(await cloud.pauseIdle(777, () => idle, async () => { throw new Error('Queue offline'); })).toBe('aborted');
    expect(fixture.calls.filter(call => call.method === 'PUT' && call.body?.state === 'stopped')).toHaveLength(0);
    expect(cloud.state.busy).toBe(false);
  });
  it('clears a cancelled definitive rejection after checking the exact label, allowing a fresh rental', async () => {
    const { cloud, fixture } = await manager(); fixture.rejectCreateRequest();
    const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'rejected-first');
    await until(() => !cloud.state.busy);
    expect(launch.instanceId).toBeNull(); expect(launch.failureCode).toBe('setup-failed');
    await cloud.cancel(launch);
    expect(launch.phase).toBe('failed'); expect(launch.safetyStatus).toBe('disarmed');
    // Recover the stale state written by older versions of Cancel.
    launch.phase = 'unknown'; launch.safetyStatus = 'unconfirmed';
    await cloud.refresh();
    expect(launch.phase).toBe('failed'); expect(launch.safetyStatus).toBe('disarmed');
    fixture.rejectCreateRequest(false);
    const next = cloud.launch(offers[0].quote, .23, 'fresh-after-rejection');
    await until(() => !cloud.state.busy);
    expect(next.phase).toBe('ready'); expect(fixture.createCount).toBe(2);
  });
  it('keeps a lost creation response blocked until the accepted rental is recovered and stopped', async () => {
    const { cloud, fixture } = await manager(); fixture.loseCreateResponse(); fixture.omitInstanceFromList();
    const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'lost-creation');
    await until(() => !cloud.state.busy);
    expect(launch.failureCode).toBe('request-unconfirmed'); expect(launch.instanceId).toBeNull();
    await cloud.cancel(launch); await cloud.refresh();
    expect(launch.phase).toBe('unknown'); expect(launch.safetyStatus).toBe('unconfirmed');
    const next = cloud.launch(offers[0].quote, .23, 'duplicate-blocked');
    await until(() => !cloud.state.busy);
    expect(next.message).toContain('still unconfirmed'); expect(fixture.createCount).toBe(1);
    fixture.omitInstanceFromList(false); await cloud.refresh();
    expect(launch.instanceId).toBe(777);
    await cloud.cancel(launch); expect(launch.safetyStatus).toBe('stopped');
  });
  it('recognizes the live public_key response shape without registering the same key again', async () => {
    const { cloud, fixture, identity } = await manager(); vi.mocked(cloud.ensureSshKey).mockRestore();
    expect(await cloud.ensureSshKey()).toBe(identity); expect(fixture.calls.map(c => c.method + ' ' + c.url.pathname)).toEqual(['GET /api/v0/ssh/']);
  });
  it('matches key material across field aliases, comments and whitespace while excluding deleted keys', () => {
    const material = publicKey.split(' ')[1];
    for (const field of ['public_key', 'key', 'ssh_key']) expect(hasRegisteredSshKey([{ [field]: `  ssh-ed25519\t${material}   a different comment\n`, deleted_at: null }], publicKey)).toBe(true);
    expect(hasRegisteredSshKey({ ssh_keys: [{ public_key: publicKey }] }, publicKey)).toBe(true);
    expect(hasRegisteredSshKey([{ public_key: publicKey, deleted_at: 123 }], publicKey)).toBe(false);
    expect(() => hasRegisteredSshKey({ unexpected: [] }, publicKey)).toThrow('unexpected SSH-key list');
  });
  it('registers an absent key once', async () => {
    const { cloud, fixture } = await manager(); vi.mocked(cloud.ensureSshKey).mockRestore(); fixture.setSshKeys([]);
    await cloud.ensureSshKey(); expect(fixture.calls.filter(c => c.method === 'POST' && c.url.pathname === '/api/v0/ssh/')).toHaveLength(1);
  });
  it('recovers a duplicate registration race only after confirming the exact existing key', async () => {
    const { cloud, fixture, identity } = await manager(); vi.mocked(cloud.ensureSshKey).mockRestore(); fixture.setSshKeys([]);
    fixture.failRegistration({ status: 400, msg: 'The SSH key already exists on this account', registerMatching: true });
    expect(await cloud.ensureSshKey()).toBe(identity); expect(fixture.calls.map(c => c.method)).toEqual(['GET', 'POST', 'GET']);
  });
  it('does not hide duplicate-key errors when the expected key is not registered', async () => {
    const { cloud, fixture } = await manager(); vi.mocked(cloud.ensureSshKey).mockRestore(); fixture.setSshKeys([]);
    fixture.failRegistration({ status: 400, msg: 'The SSH key already exists on this account' });
    await expect(cloud.ensureSshKey()).rejects.toThrow('already exists');
  });
  it('preserves genuine SSH-key permission failures', async () => {
    const { cloud, fixture } = await manager(); vi.mocked(cloud.ensureSshKey).mockRestore(); fixture.setSshKeys([]);
    fixture.failRegistration({ status: 403, msg: 'Denied' }); await expect(cloud.ensureSshKey()).rejects.toThrow('does not allow');
    expect(fixture.calls.map(c => c.method)).toEqual(['GET', 'POST']);
  });
  it('normalizes the quoted total without counting storage twice and exposes real transfer fees', () => {
    const offer = normalizeOffer(rawOffer(), filters); expect(offer.compatible).toBe(true); expect(offer.totalHourly).toBe(.23); expect(offer.computeHourly).toBe(.2); expect(offer.storageHourly).toBe(.03);
    expect(offer.storageMonthly).toBeCloseTo(21.6); expect(offer.modelDownloadCost).toBeCloseTo(.029738555883); expect(offer.vram).toBe(24);
    const old = normalizeOffer({ ...rawOffer(), driver_version: '535.86.05', gpu_ram: 16384 }, filters); expect(old.compatible).toBe(false); expect(old.reasons.join()).toContain('580.65.06');
  });
  it('enforces the compute ceiling while keeping separately quoted storage outside it', () => {
    expect(GPU_COMPUTE_CEILING).toBe(.7);
    for (const value of [null, NaN, Infinity, -.1, .7001, 1]) expect(withinComputeBudget(value)).toBe(false);
    expect(withinComputeBudget(.7)).toBe(true);
    const raw = rawOffer(); raw.search = { gpuCostPerHour: .7, diskHour: .1, totalHour: .8 };
    expect(normalizeOffer(raw, filters).compatible).toBe(true);
    raw.search.gpuCostPerHour = .701;
    expect(normalizeOffer(raw, filters).compatible).toBe(false);
    expect(normalizeOffer(raw, filters).reasons.join()).toContain('$0.70/hour');
  });
  it('allows known downloads up to the inclusive $0.005/GB limit without capping uploads', () => {
    expect(DOWNLOAD_PRICE_CEILING).toBe(.005);
    for (const value of [0, .000001, .004, .005]) {
      expect(withinDownloadBudget(value)).toBe(true);
      const offer = normalizeOffer({ ...rawOffer(), inet_down_cost: value, inet_up_cost: .1 }, filters, 40.4);
      expect(offer.compatible).toBe(true); expect(offer.downloadPerGB).toBe(value);
      expect(offer.modelDownloadCost).toBeCloseTo(40.4 * value); expect(offer.uploadPerGB).toBe(.1);
    }
    expect(normalizeOffer({ ...rawOffer(), inet_down_cost: '0.004' }, filters).compatible).toBe(true);
  });
  it('excludes unknown, invalid and over-budget download rates rather than treating them as free', () => {
    for (const value of [null, NaN, Infinity, -.001, .0050001, .0390625]) expect(withinDownloadBudget(value)).toBe(false);
    for (const value of [null, undefined, NaN, Infinity, -.001, .0050001, .0390625, '', ' ', false, true, [], 'unknown']) {
      const offer = normalizeOffer({ ...rawOffer(), inet_down_cost: value }, filters);
      expect(offer.compatible).toBe(false); expect(offer.reasons.join()).toContain('$0.005/GB');
    }
  });
  it('filters download rates locally even when a provider ignores the search ceiling', async () => {
    const { cloud } = await manager();
    for (const value of [.0390625, null, undefined]) {
      vi.spyOn(cloud.client, 'offers').mockResolvedValueOnce([{ ...rawOffer(), inet_down_cost: value }]);
      expect((await cloud.offers(filters)).offers).toEqual([]);
    }
  });
  it('never submits a rental when a fresh compute quote exceeds the budget even with a higher total approval', async () => {
    const { cloud, fixture } = await manager();
    const { offers } = await cloud.offers(filters);
    const fetcher = fixture.fetcher.getMockImplementation()!;
    fixture.fetcher.mockImplementation(async (input, init) => {
      const response = await fetcher(input, init);
      if (new URL(String(input)).pathname !== '/api/v0/bundles/') return response;
      const value = await response.json(); value.offers[0].search.gpuCostPerHour = .75;
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    });
    const launch = cloud.launch(offers[0].quote, 1, 'budget-change');
    await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('failed'); expect(launch.message).toContain('budget');
    expect(fixture.createCount).toBe(0);
  });
  it('does not start stopped compute whose current contract rate exceeds the ceiling', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'budget-resume'); await until(() => !cloud.state.busy);
    await cloud.action(777, 'stop');
    fixture.updateInstance({ actual_status: 'stopped', intended_status: 'stopped', dph_base: .8 });
    await cloud.continue(launch); await until(() => !cloud.state.busy);
    expect(launch.message).toContain('budget');
    expect(fixture.calls.filter(c => c.url.pathname === '/api/v0/instances/777/' && c.method === 'PUT' && c.body.state === 'running')).toHaveLength(0);
    expect(fixture.createCount).toBe(1);
  });
  it('allows a fast-network filter without treating a host rating as measured throughput', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    const fast = offerFiltersSchema.parse({ minDownload: 1000 }); await client.offers(fast);
    expect(fixture.calls[0].body.inet_down).toEqual({ gte: 1000 });
    expect(normalizeOffer({ ...rawOffer(), inet_down: 240 }, fast).compatible).toBe(false);
    expect(normalizeOffer(rawOffer(), fast).compatible).toBe(true);
  });
  it('queries compatible hardware with selected disk and authenticates only in the HTTPS header', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher); await client.offers({ ...filters, disk: 128, ram: 64 });
    const call = fixture.calls[0]; expect(call.auth).toBe('Bearer fixture-secret'); expect(call.url.toString()).not.toContain('fixture-secret');
    expect(call.body).toMatchObject({ allocated_storage: 128, cpu_ram: { gte: 64000 }, driver_version: { gte: 580065006 }, inet_down_cost: { lte: .005 }, type: 'on-demand' });
    expect(call.body.gpu_ram).toBeUndefined();
    expect(call.body.gpu_name.in).toContain('RTX 5090');
    expect(call.body.gpu_name.in).toContain('A100 PCIE');
    expect(call.body.gpu_name.in).toContain('GB10');
  });
  it('searches DGX Spark by GB10 and validates the shared pool without assuming dedicated VRAM', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    const settings = offerFiltersSchema.parse({ gpu: 'dgx', disk: 128 }); await client.offers(settings);
    expect(fixture.calls[0].body).toMatchObject({ gpu_name: { in: expect.arrayContaining(['GB10', 'GB200', 'GB300', 'B200', 'H200']) }, cpu_arch: { in: ['amd64', 'arm64'] }, cpu_ram: { gte: 48000 }, allocated_storage: 128, num_gpus: { eq: 1 } });
    expect(fixture.calls[0].body.gpu_ram).toBeUndefined();
    const raw = { ...rawOffer(), gpu_name: 'GB10', gpu_ram: null, cpu_ram: 128000, cpu_arch: 'arm64' };
    expect(normalizeOffer(raw, settings)).toMatchObject({ compatible: true, vram: 128, ram: 128 });
    expect(normalizeOffer({ ...raw, cpu_arch: 'amd64' }, settings).compatible).toBe(false);
    expect(normalizeOffer({ ...raw, cpu_ram: 32000 }, settings).compatible).toBe(false);
    expect(matchesGpuProbe(raw, 'NVIDIA GB10, [N/A]\n')).toBe(true);
    expect(matchesGpuProbe(raw, 'NVIDIA GB100, [N/A]\n')).toBe(false);
    expect(matchesGpuProbe(raw, 'NVIDIA GeForce RTX 5090, 32607\n')).toBe(false);
    expect(matchesGpuProbe({ gpu_name: 'RTX 3090', gpu_ram: 24576 }, 'NVIDIA GeForce RTX 3090, [N/A]\n')).toBe(false);
  });
  it('uses only CLI credentials, picks up rotation and never exposes the key in app state', async () => {
    const { cloud, fixture } = await manager();
    vi.stubEnv('VAST_API_KEY', 'ignored-environment-key');
    await mkdir(path.join(root, 'private'), { recursive: true });
    await writeFile(path.join(root, 'private/vast-api-key'), 'ignored-legacy-key');
    await cloud.refresh();
    expect(cloud.state.configured).toBe(true);
    expect(fixture.calls.at(-1)?.auth).toBe('Bearer fixture-vast-key-never-real');
    await writeFile(path.join(root, '.config/vastai/vast_api_key'), '  rotated-fixture-key\n');
    await cloud.offers(filters);
    expect(fixture.calls.at(-1)?.auth).toBe('Bearer rotated-fixture-key');
    expect(JSON.stringify(cloud.state)).not.toMatch(/fixture-vast-key|rotated-fixture-key|ignored-environment-key|ignored-legacy-key/);
  });
  it.each(['missing', 'empty'])('fails closed with %s CLI credentials despite alternate keys', async state => {
    const { cloud, fixture } = await manager();
    vi.stubEnv('VAST_API_KEY', 'ignored-environment-key');
    await mkdir(path.join(root, 'private'), { recursive: true });
    await writeFile(path.join(root, 'private/vast-api-key'), 'ignored-legacy-key');
    const file = path.join(root, '.config/vastai/vast_api_key');
    if (state === 'missing') await rm(file); else await writeFile(file, ' \n');
    await cloud.refresh();
    expect(cloud.state.configured).toBe(false);
    expect(cloud.state.error).toContain('Account & SSH keys');
    expect(fixture.calls).toHaveLength(0);
    const reopened = new CloudManager(store!, cloud.connection, cloud.runner, cloud.repo, { backgroundSafety: false });
    expect(reopened.state.configured).toBe(false); reopened.dispose();
    await writeFile(file, 'restored-fixture-key'); await cloud.refresh();
    expect(cloud.state.configured).toBe(true); expect(cloud.state.error).toBeNull();
    expect(fixture.calls.at(-1)?.auth).toBe('Bearer restored-fixture-key');
  });
  it.each(['GB200', 'GB300'])('includes %s as ARM hardware with separate GPU memory capacity', gpu => {
    const settings = offerFiltersSchema.parse({ gpu: 'dgx' });
    const raw = { ...rawOffer(), gpu_name: gpu, gpu_ram: 180*1024, cpu_ram: 480000, cpu_arch: 'arm64' };
    expect(normalizeOffer(raw, settings)).toMatchObject({ compatible: true, vram: 180, ram: 480 });
    expect(normalizeOffer({ ...raw, gpu_ram: null }, settings).compatible).toBe(false);
    expect(normalizeOffer({ ...raw, cpu_arch: 'amd64' }, settings).compatible).toBe(false);
    expect(matchesGpuProbe(raw, `NVIDIA ${gpu}, 184320\n`)).toBe(true);
  });
  it.each(['GB10', 'GB200', 'GB300'] as const)('can select %s directly without the API default hiding ARM offers', async gpu => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    await client.offers(offerFiltersSchema.parse({ gpu }));
    expect(fixture.calls[0].body).toMatchObject({ gpu_name: { eq: gpu }, cpu_arch: { in: ['amd64', 'arm64'] } });
  });
  it('searches the A-series family using provider model names and keeps the hardware constraints', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    await client.offers(offerFiltersSchema.parse({ gpu: 'a-series', disk: 96, ram: 64 }));
    const query = fixture.calls[0].body;
    expect(query.gpu_name.in).toEqual(expect.arrayContaining(['A10', 'A30', 'A40', 'A100 PCIE', 'A100 SXM4', 'A800 PCIE', 'RTX A6000']));
    expect(query.gpu_name.in).not.toContain('RTX 5090');
    expect(query).toMatchObject({ num_gpus: { eq: 1 }, allocated_storage: 96, cpu_ram: { gte: 64000 }, gpu_ram: { gte: 24000 }, cuda_max_good: { gte: 13 }, verified: { eq: true } });
  });
  it('searches one datacenter family including PRO, Ada, L, A and DGX without hiding shared-memory hosts', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    await client.offers(offerFiltersSchema.parse({ gpu: 'datacenter', disk: 128, ram: 64 }));
    const query = fixture.calls[0].body;
    expect(query.gpu_name.in).toEqual(expect.arrayContaining(['RTX PRO 5000', 'RTX PRO 6000 S', 'RTX PRO 6000 Max-Q', 'RTX A6000', 'RTX 5000Ada', 'L40S', 'L4', 'A40', 'A100 PCIE', 'H200 NVL', 'B200', 'GB10']));
    expect(query.gpu_name.in).not.toContain('RTX 5090');
    expect(query).toMatchObject({ allocated_storage: 128, cpu_ram: { gte: 64000 }, num_gpus: { eq: 1 }, cpu_arch: { in: ['amd64', 'arm64'] } });
    expect(query.gpu_ram).toBeUndefined();
  });
  it.each(['RTX PRO 5000', 'L4', 'L40', 'L40S'])('can search and verify %s while retaining discrete VRAM checks', async gpu => {
    const fixture = provider(), client = new VastClient(async () => 'fixture-secret', fixture.fetcher);
    const settings = offerFiltersSchema.parse({ gpu }); await client.offers(settings);
    expect(fixture.calls[0].body).toMatchObject({ gpu_name: { eq: gpu }, gpu_ram: { gte: 24000 } });
    const raw = { ...rawOffer(), gpu_name: gpu, gpu_ram: 49152 };
    expect(normalizeOffer(raw, settings).compatible).toBe(true);
    expect(normalizeOffer({ ...raw, gpu_ram: 16384 }, settings).compatible).toBe(false);
    expect(matchesGpuProbe(raw, `NVIDIA ${gpu}${gpu.startsWith('RTX PRO') ? ' Blackwell' : ''}, 49000\n`)).toBe(true);
  });
  it('distinguishes L-series and PRO 6000 variants in the setup hardware probe', () => {
    expect(matchesGpuProbe({ gpu_name: 'L4', gpu_ram: 24576 }, 'NVIDIA L40S, 46068\n')).toBe(false);
    expect(matchesGpuProbe({ gpu_name: 'L40', gpu_ram: 49152 }, 'NVIDIA L40S, 49000\n')).toBe(false);
    expect(matchesGpuProbe({ gpu_name: 'RTX PRO 6000 WS', gpu_ram: 98304 }, 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 97800\n')).toBe(true);
    expect(matchesGpuProbe({ gpu_name: 'RTX PRO 6000 S', gpu_ram: 98304 }, 'NVIDIA RTX PRO 6000 Blackwell Server Edition, 97800\n')).toBe(true);
    expect(matchesGpuProbe({ gpu_name: 'RTX PRO 6000 Max-Q', gpu_ram: 98304 }, 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition, 97800\n')).toBe(true);
    expect(matchesGpuProbe({ gpu_name: 'RTX PRO 6000 WS', gpu_ram: 98304 }, 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition, 97800\n')).toBe(false);
    expect(matchesGpuProbe({ gpu_name: 'RTX PRO 6000 S', gpu_ram: 98304 }, 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 97800\n')).toBe(false);
  });
  it.each([
    ['A10', 24576], ['A30', 24576], ['A40', 49152], ['A100 PCIE', 40960], ['A100 SXM4', 81920], ['A800 PCIE', 81920],
  ])('admits compatible %s offers without requiring RTX branding', (gpu, memory) => {
    const offer = normalizeOffer({ ...rawOffer(), gpu_name: gpu, gpu_ram: memory }, filters);
    expect(offer.compatible).toBe(true);
    expect(offer.gpu).toBe(gpu);
    expect(offer.totalHourly).toBe(.23);
  });
  it('keeps unsupported cards, insufficient memory and old drivers out of A-series rentals', () => {
    expect(normalizeOffer({ ...rawOffer(), gpu_name: 'Tesla V100', gpu_ram: 32768 }, filters).compatible).toBe(false);
    expect(normalizeOffer({ ...rawOffer(), gpu_name: 'A40', gpu_ram: 16384 }, filters).compatible).toBe(false);
    expect(normalizeOffer({ ...rawOffer(), gpu_name: 'A100 PCIE', driver_version: '570.195.03' }, filters).compatible).toBe(false);
  });
  it('recognizes nvidia-smi A100 naming while checking the selected model and memory class', () => {
    const expected = { gpu_name: 'A100 PCIE', gpu_ram: 81920 };
    expect(matchesGpuProbe(expected, 'NVIDIA A100 80GB PCIe, 81159\n')).toBe(true);
    expect(matchesGpuProbe(expected, 'NVIDIA A100-PCIE-40GB, 40536\n')).toBe(false);
    expect(matchesGpuProbe(expected, 'NVIDIA A100-SXM4-80GB, 81159\n')).toBe(false);
    expect(matchesGpuProbe(expected, 'NVIDIA A40, 46068\n')).toBe(false);
    expect(matchesGpuProbe(expected, 'NVIDIA A100 80GB PCIe MIG 1g.10gb, 81159\n')).toBe(false);
    expect(matchesGpuProbe({ gpu_name: 'A100 SXM4', gpu_ram: 81920 }, 'NVIDIA A100-SXM4-80GB, 81159\n')).toBe(true);
    expect(matchesGpuProbe({ gpu_name: 'RTX 5090', gpu_ram: 32768 }, 'NVIDIA GeForce RTX 5090, 32607\n')).toBe(true);
    expect(matchesGpuProbe({ gpu_name: 'A10', gpu_ram: 24576 }, 'NVIDIA RTX A1000, 24576\n')).toBe(false);
  });
  it('returns and launches an A-series offer through the same single-rental lifecycle', async () => {
    const { cloud, fixture, provision } = await manager(); fixture.setGpu('A100 PCIE', 81920);
    const { offers } = await cloud.offers(offerFiltersSchema.parse({ gpu: 'a-series' }));
    expect(offers).toHaveLength(1); expect(offers[0].gpu).toBe('A100 PCIE'); expect(fixture.createCount).toBe(0);
    const launch = cloud.launch(offers[0].quote, .23, 'a-series-once');
    await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(fixture.createCount).toBe(1); expect(provision).toHaveBeenCalledTimes(1);
    expect(fixture.calls.filter(call => call.url.pathname === '/api/v0/asks/123/')).toHaveLength(1);
  });
  it('creates once, provisions the pinned image, connects, stops and requires exact destroy confirmation', async () => {
    const { cloud, fixture, provision, connection } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'rent-once'); expect(cloud.launch(offers[0].quote, .23, 'rent-once').id).toBe(launch.id); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(fixture.createCount).toBe(1); expect(provision).toHaveBeenCalledTimes(1); expect(connection.connect).toHaveBeenCalledWith('http://127.0.0.1:8188', false);
    expect(fixture.calls.find(c => c.url.pathname === '/api/v0/asks/123/')!.body).toMatchObject({ disk: 80, image: RENTAL_IMAGE, runtype: 'ssh_direct', cancel_unavail: true, onstart: SSH_ONSTART });
    await cloud.action(777, 'stop'); expect(launch.phase).toBe('stopped'); expect(cloud.state.instances[0].state).toBe('stopped');
    await expect(cloud.action(777, 'destroy', 'wrong-id')).rejects.toThrow('confirm'); expect(fixture.calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
    await cloud.action(777, 'destroy', '777'); expect(launch.phase).toBe('destroyed'); expect(cloud.state.instances).toHaveLength(0);
  });
  it('rejects a higher refreshed price before creating a rental', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); fixture.setPrice(.4);
    const launch = cloud.launch(offers[0].quote, .23, 'repriced'); await until(() => !cloud.state.busy); expect(launch.phase).toBe('failed'); expect(launch.message).toContain('price increased'); expect(fixture.createCount).toBe(0);
  });
  it('recovers a rental whose create response was lost and resumes it without renting again', async () => {
    const { cloud, fixture, provision } = await manager(); const { offers } = await cloud.offers(filters); fixture.loseCreateResponse();
    const launch = cloud.launch(offers[0].quote, .23, 'uncertain'); await until(() => !cloud.state.busy && launch.instanceId !== null);
    expect(launch.instanceId).toBe(777); expect(fixture.createCount).toBe(1); await cloud.continue(launch); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(provision).toHaveBeenCalledTimes(1); expect(fixture.createCount).toBe(1);
  });
  it('retries a pre-rental SSH failure, including old saved attempts, without creating an extra rental', async () => {
    const { cloud, fixture } = await manager(); vi.mocked(cloud.ensureSshKey).mockRejectedValueOnce(new VastError('The SSH key already exists on this account', 400));
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'preflight-retry'); await until(() => !cloud.state.busy);
    expect(launch.creationAttempted).toBe(false); expect(fixture.createCount).toBe(0);
    delete launch.creationAttempted; delete launch.approvedHourly; delete launch.filters;
    await cloud.continue(launch); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready'); expect(fixture.createCount).toBe(1);
  });
  it('does not create a second rental when an earlier create request is unconfirmed and absent from the list', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'unconfirmed'); await until(() => !cloud.state.busy);
    launch.instanceId = null; launch.label = 'unmatched-label'; launch.phase = 'unknown'; launch.creationAttempted = true;
    await expect(cloud.continue(launch)).rejects.toThrow('No existing rental'); expect(fixture.createCount).toBe(1);
  });
  it('keeps an unconfirmed stop visibly unresolved instead of claiming compute is stopped', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'stop-uncertain'); await until(() => !cloud.state.busy);
    fixture.loseStopResponse(); await expect(cloud.action(777, 'stop')).rejects.toThrow('NOT confirmed');
    expect(launch.phase).toBe('failed'); expect(launch.safetyStatus).toBe('unconfirmed'); expect(cloud.state.instances[0].state).toBe('running'); expect(fixture.createCount).toBe(1);
  });
  it('serializes an explicit retry after an in-flight stop so an old stop cannot race the resumed setup', async () => {
    const { cloud, fixture } = await manager({ stopPollAttempts: 1 }); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'retry-pending-stop'); await until(() => !cloud.state.busy); fixture.acknowledgeStopOnly();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); let hold = true; const instance = cloud.client.instance.bind(cloud.client);
    vi.spyOn(cloud.client, 'instance').mockImplementation(async id => { const value = await instance(id); if (hold) { hold = false; await wait; } return value; });
    const stopping = cloud.action(777, 'stop').catch(() => undefined); await until(() => launch.phase === 'stopping' && !hold);
    const retrying = cloud.continue(launch); release(); await stopping; await retrying; await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(fixture.createCount).toBe(1); expect(fixture.calls.filter(c => c.body?.state === 'stopped')).toHaveLength(1);
  });
  it('revalidates the rental ask ID rather than the nonmatching search id predicate', async () => {
    const fixture = provider(), client = new VastClient(async () => 'fixture', fixture.fetcher);
    const rows = await client.offers(filters, 123); expect(rows.map(row => row.ask_contract_id)).toEqual([123]);
    expect(fixture.calls[0].body.ask_contract_id).toEqual({ eq: 123 }); expect(fixture.calls[0].body.id).toBeUndefined();
    expect(fixture.calls[0].body.inet_down_cost).toBeUndefined(); // Read changed prices, then enforce the cap locally.
    expect(normalizeOffer({ ...rawOffer(), id: 999, ask_contract_id: 123 }, filters).id).toBe(123);
    expect(await client.offers(filters, 456)).toEqual([]);
  });
  it('excludes hosts reporting only 22 GB usable VRAM despite a 4090 model name', () => {
    expect(normalizeOffer({ ...rawOffer(), gpu_name: 'RTX 4090', gpu_ram: 23028 }, filters).compatible).toBe(false);
    expect(normalizeOffer({ ...rawOffer(), gpu_name: 'RTX 4090', gpu_ram: 24564 }, filters).compatible).toBe(true);
  });
  it('runs the production preflight without registering a key or creating a rental', async () => {
    const { cloud, fixture, preflight } = await manager(); const { offers } = await cloud.offers(filters); const report = await cloud.checkConfiguration(offers[0].quote);
    expect(report.ready).toBe(true); expect(report.checks).toHaveLength(3); expect(report.rentalRequests).toBe(0); expect(preflight).toHaveBeenCalledOnce();
    expect(fixture.calls.some(c => c.url.pathname.startsWith('/api/v0/asks/'))).toBe(false);
    expect(fixture.calls.some(c => c.method === 'POST' && c.url.pathname === '/api/v0/ssh/')).toBe(false);
  });
  it('stops before spending if local authentication or deployment preflight fails', async () => {
    const { cloud, fixture, preflight } = await manager(); preflight.mockRejectedValueOnce(new Error('SSH authentication unavailable'));
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'bad-local'); await until(() => !cloud.state.busy);
    expect(launch.creationAttempted).toBe(false); expect(launch.lastFailure).toContain('SSH authentication'); expect(fixture.createCount).toBe(0);
  });
  it('does not accept increased transfer fees at an unchanged GPU hourly price', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); fixture.setTransfer(.004);
    const launch = cloud.launch(offers[0].quote, .23, 'transfer-change'); await until(() => !cloud.state.busy);
    expect(launch.failureCode).toBe('transfer-changed'); expect(fixture.createCount).toBe(0);
  });
  it.each([.006, NaN])('never rents when exact-ask download pricing becomes invalid: %s', async price => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); fixture.setTransfer(price);
    // Even a stale saved approval of a higher rate cannot bypass the hard cap.
    offers[0].downloadPerGB = .1;
    const launch = cloud.launch(offers[0].quote, .23, 'transfer-cap'); await until(() => !cloud.state.busy);
    expect(launch.failureCode).toBe('transfer-changed'); expect(launch.message).toContain('$0.005/GB');
    expect(launch.creationAttempted).toBe(false); expect(fixture.createCount).toBe(0);
  });
  it('automatically stops compute after installer failure and retains the disk', async () => {
    const { cloud, fixture, provision } = await manager(); provision.mockRejectedValueOnce(new Error('CUDA kernel validation failed'));
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'failed-install'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('stopped'); expect(launch.lastFailure).toContain('CUDA kernel'); expect(launch.safetyStatus).toBe('stopped'); expect(fixture.createCount).toBe(1);
    expect(fixture.calls.some(c => c.method === 'PUT' && c.body?.state === 'stopped')).toBe(true); expect(fixture.calls.some(c => c.method === 'DELETE')).toBe(false);
  });
  it('waits through a transient offline status while the provider starts the existing container', async () => {
    const { cloud, fixture } = await manager();
    vi.spyOn(cloud.client, 'instance').mockResolvedValueOnce({ id: 777, actual_status: 'offline', intended_status: 'running', status_msg: 'Container is restarting' });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'transient-offline'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false); expect(fixture.createCount).toBe(1);
  });
  it('retries temporary provider status outages without stopping a healthy installation', async () => {
    const { cloud, fixture } = await manager(); vi.spyOn(cloud.client, 'instance').mockRejectedValueOnce(new VastError('Provider unavailable', 503));
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'transient-provider'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
  });
  it('continues through delayed provider status when SSH proves the selected GPU is reachable', async () => {
    const probe = vi.fn(async () => true); const { cloud, fixture, provision } = await manager({ probe });
    vi.spyOn(cloud.client, 'instance').mockResolvedValueOnce({ ...rawOffer(), id: 777, actual_status: 'offline', intended_status: 'running', ssh_host: 'fixture', ssh_port: 2222 });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'delayed-status'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready'); expect(probe).toHaveBeenCalledOnce(); expect(provision).toHaveBeenCalledOnce(); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
  });
  it('removes an explicit failed container before installation and confirms disk deletion', async () => {
    const { cloud, fixture, provision } = await manager();
    fixture.setCreationState({ actual_status: 'loading', status_msg: 'docker_build() error writing dockerfile' });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'fatal-builder');
    await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('destroyed'); expect(launch.failureCode).toBe('host-unresponsive');
    expect(launch.autoCleanup?.state).toBe('confirmed'); expect(provision).not.toHaveBeenCalled();
    expect(fixture.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(fatalContainerStatus('Still pulling image; taking longer than usual')).toBeNull();
  });
  it('removes a new host with a fatal CDI device injection error and excludes it for 24 hours', async () => {
    const { cloud, fixture, provision } = await manager();
    fixture.setCreationState({ actual_status: 'created', status_msg: 'Error response from daemon: failed to create task for container:\nOCI runtime create failed: failed to inject CDI devices: unresolvable CDI devices D.fixture/gpu=3: unknown\nError: failed to start containers: C.777' });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'fatal-cdi');
    await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('destroyed'); expect(launch.autoCleanup?.state).toBe('confirmed');
    expect(provision).not.toHaveBeenCalled(); expect(fixture.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect((await cloud.offers(filters)).offers).toHaveLength(0);
    expect(fatalContainerStatus('Installing NVIDIA CDI tooling; image pull in progress')).toBeNull();
    expect(fatalContainerStatus('Error response from daemon: waiting for container resources')).toBeNull();
  });
  it('retains an installed disk if a later restart reports a CDI failure', async () => {
    const { cloud, fixture, provision } = await manager();
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'installed-cdi');
    await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready');
    fixture.updateInstance({ actual_status: 'loading', status_msg: 'Error response from daemon: failed to inject CDI devices: unresolvable CDI devices D.fixture/gpu=3: unknown' });
    await cloud.action(777, 'connect'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('stopped'); expect(launch.autoCleanup).toBeUndefined();
    expect(provision).toHaveBeenCalledOnce(); expect(fixture.calls.some(call => call.method === 'DELETE')).toBe(false);
  });
  it('removes a silent empty host only after repeated missing signals and independent SSH checks', async () => {
    const sshReachable = vi.fn(async () => false);
    const { cloud, fixture, provision } = await manager({ hostSilenceMs: 25, probe: async () => false, sshReachable });
    fixture.setCreationState({ actual_status: null, status_msg: null, direct_port_start: -1, direct_port_end: -1 });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'silent-host');
    await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('destroyed'); expect(launch.autoCleanup?.state).toBe('confirmed');
    expect(sshReachable).toHaveBeenCalledTimes(2); expect(provision).not.toHaveBeenCalled();
    expect(fixture.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect((await cloud.offers(filters)).offers).toHaveLength(0);
  });
  it('does not destroy a quiet image pull or an installed disk because time passes', async () => {
    const { cloud, fixture } = await manager({ hostSilenceMs: 10, probe: async () => false });
    fixture.setCreationState({ actual_status: 'loading', status_msg: '', direct_port_start: -1, direct_port_end: -1 });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'quiet-pull');
    await until(() => launch.phase === 'waiting'); await new Promise(resolve => setTimeout(resolve, 35));
    expect(fixture.calls.some(call => call.method === 'DELETE')).toBe(false); expect(launch.hostWatch).toBeUndefined();
    launch.emptyRental = false; launch.engineSetupStartedAt = new Date().toISOString(); fixture.updateInstance({ actual_status: null });
    await new Promise(resolve => setTimeout(resolve, 35)); expect(fixture.calls.some(call => call.method === 'DELETE')).toBe(false);
    fixture.updateInstance({ actual_status: 'running' }); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready');
  });
  it('does not remove a host if its SSH service is reachable despite missing provider status', async () => {
    const { cloud, fixture } = await manager({ hostSilenceMs: 10, probe: async () => false, sshReachable: async () => true });
    fixture.setCreationState({ actual_status: null, status_msg: null, direct_port_start: -1, direct_port_end: -1 });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'reachable-ssh');
    await until(() => launch.phase === 'waiting'); await new Promise(resolve => setTimeout(resolve, 35));
    expect(fixture.calls.some(call => call.method === 'DELETE')).toBe(false);
    fixture.updateInstance({ actual_status: 'running' }); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready');
  });
  it('keeps unconfirmed deletion pending and retries cleanup even after compute stops', async () => {
    const { cloud, fixture } = await manager({ hostSilenceMs: 10, probe: async () => false, sshReachable: async () => false });
    fixture.setCreationState({ actual_status: null, status_msg: null, direct_port_start: -1, direct_port_end: -1 }); fixture.acknowledgeDeleteOnly();
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'delete-pending');
    await until(() => !cloud.state.busy);
    expect(launch.autoCleanup?.state).toBe('pending'); expect(launch.phase).toBe('failed'); expect(launch.safetyStatus).toBe('unconfirmed');
    await expect(cloud.continue(launch)).rejects.toThrow('removal');
    fixture.acknowledgeDeleteOnly(false); await cloud.enforceSafety();
    expect(launch.phase).toBe('destroyed'); expect(launch.autoCleanup?.state).toBe('confirmed');
  });
  it('follows an already running rental without sending another provider start request', async () => {
    const { cloud, fixture } = await manager();
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'follow-existing');
    await until(() => !cloud.state.busy);
    await cloud.action(777, 'connect'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('ready');
    expect(fixture.calls.filter(call => call.url.pathname === '/api/v0/instances/777/' && call.method === 'PUT')).toHaveLength(0);
    expect(fixture.createCount).toBe(1);
  });
  it('warns about a long installer without stopping it or converting elapsed time to failure', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const { cloud, fixture, provision } = await manager({ setupWarningMs: 25 }); provision.mockImplementationOnce(async () => wait);
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'slow'); await until(() => launch.setupSlow === true);
    expect(launch.phase).toBe('installing'); expect(launch.warning).toContain('Taking longer'); expect(launch.lastFailure).toBeUndefined(); expect(launch.setupDeadline).toBeNull();
    launch.setupDeadline = new Date(Date.now() - 10000).toISOString(); await cloud.enforceSafety();
    expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false); expect(fixture.createCount).toBe(1);
    release(); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready'); expect(launch.setupSlow).toBe(false);
  });
  it('starts a blank engine without queuing weights and retains bounded setup logs', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const { cloud, provision } = await manager();
    const file = pinnedModels.find(file => file.destination === setupModelFiles[0])!;
    provision.mockImplementationOnce(async (_instance, log) => {
      log('RECAST_MODEL_PROGRESS ' + JSON.stringify({ destination: file.destination, downloaded: 1024, total: file.size, phase: 'downloading' }));
      for (let i = 0; i < 150; i++) log('Runtime package ' + i);
      log('RECAST_MODEL_PROGRESS ' + JSON.stringify({ destination: file.destination, downloaded: file.size + 1, total: file.size, phase: 'ready' }));
      log('RECAST_MODEL_PROGRESS ' + JSON.stringify({ destination: 'loras/' + SOCIAL_STYLE, downloaded: 10, total: 10, phase: 'ready' }));
      await wait;
    });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'setup-counters');
    await until(() => launch.logs.length === 120);
    expect(launch.phase).toBe('installing'); expect(launch.logs).toHaveLength(120);
    expect(launch.setupDownloads).toEqual([]);
    expect(launch.setupDownloads?.some(file => file.id.includes('Instagoon'))).toBe(false);
    release(); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready');
  });
  it('requires actual stopped state even if the stop API acknowledges success', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'ack-only'); await until(() => !cloud.state.busy);
    fixture.acknowledgeStopOnly(); await expect(cloud.action(777, 'stop')).rejects.toThrow('NOT confirmed');
    expect(launch.safetyStatus).toBe('unconfirmed'); expect(launch.phase).toBe('failed'); expect(cloud.state.instances[0].computeStopped).toBe(false);
  });
  it('does not treat a crashed container with intended running state as stopped billing', () => {
    expect(computeIsStopped({ actual_status: 'exited', intended_status: 'running', cur_state: 'running' })).toBe(false);
    expect(computeIsStopped({ actual_status: 'exited', intended_status: 'stopped' })).toBe(true);
  });
  it('keeps a known rental when the list is briefly stale and checks its individual status', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'list-lag'); await until(() => !cloud.state.busy);
    fixture.omitInstanceFromList(); await cloud.refresh(); expect(launch.phase).toBe('ready'); expect(cloud.state.instances[0].id).toBe(777); expect(fixture.createCount).toBe(1);
  });
  it('preserves known rentals on malformed provider responses instead of reporting their disks deleted', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'bad-list'); await until(() => !cloud.state.busy);
    fixture.invalidInstanceList(); await cloud.refresh(); expect(launch.phase).toBe('ready'); expect(cloud.state.instances[0].id).toBe(777); expect(cloud.state.error).toContain('invalid instance list');
  });
  it('refuses a second paid rental while a managed instance is already active', async () => {
    const { cloud, fixture } = await manager(); const first = await cloud.offers(filters); cloud.launch(first.offers[0].quote, .23, 'first'); await until(() => !cloud.state.busy);
    const second = await cloud.offers(filters); const launch = cloud.launch(second.offers[0].quote, .23, 'second'); await until(() => !cloud.state.busy);
    expect(launch.phase).toBe('failed'); expect(launch.message).toContain('still active'); expect(fixture.createCount).toBe(1);
  });
  it('cancels before creating a rental when preflight is still running', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const { cloud, fixture, preflight } = await manager(); preflight.mockImplementationOnce(async () => wait);
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'cancel-before'); await until(() => preflight.mock.calls.length > 0);
    await cloud.cancel(launch); release(); await until(() => !cloud.state.busy); expect(fixture.createCount).toBe(0); expect(launch.message).toContain('before any rental request');
  });
  it('stops the accepted rental if cancellation arrives before its create response', async () => {
    const { cloud, fixture } = await manager(); let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); const request = cloud.client.request.bind(cloud.client);
    vi.spyOn(cloud.client, 'request').mockImplementation(async (route, method, body, timeout) => { const result = await request(route, method, body, timeout); if (route.startsWith('/api/v0/asks/')) await wait; return result; });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'cancel-pending'); await until(() => fixture.createCount === 1);
    await cloud.cancel(launch); release(); await until(() => !cloud.state.busy); expect(launch.phase).toBe('stopped'); expect(fixture.createCount).toBe(1);
  });
  it('recovers and stops a rental with an ambiguous create response without repeating creation', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); fixture.loseCreateResponse();
    const launch = cloud.launch(offers[0].quote, .23, 'recover-stop'); await until(() => !cloud.state.busy); await cloud.enforceSafety();
    expect(launch.phase).toBe('stopped'); expect(fixture.createCount).toBe(1);
  });
  it('recovers and stops the paid rental if Vast returns null after accepting creation', async () => {
    const { cloud, fixture } = await manager(); const fetcher = cloud.client.fetcher;
    cloud.client.fetcher = async (input, init) => { const response = await fetcher(input, init); return String(input).includes('/api/v0/asks/') ? new Response('null', { headers: { 'Content-Type': 'application/json' } }) : response; };
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'null-create'); await until(() => !cloud.state.busy);
    expect(launch.failureCode).toBe('request-unconfirmed'); await cloud.enforceSafety(); expect(launch.phase).toBe('stopped'); expect(fixture.createCount).toBe(1);
  });
  it('keeps quotes from another tab valid when the marketplace is refreshed', async () => {
    const { cloud } = await manager(); const first = await cloud.offers(filters); await cloud.offers({ ...filters, disk: 128 });
    expect((await cloud.checkConfiguration(first.offers[0].quote)).ready).toBe(true);
  });
  it('keeps healthy remote setup after an app restart and offers reconnection without another rental or stop', async () => {
    const { cloud, fixture, connection } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'restart'); await until(() => !cloud.state.busy);
    launch.phase = 'installing'; launch.safetyStatus = 'armed'; launch.setupDeadline = new Date(Date.now() + 60000).toISOString(); cloud.emit(); cloud.dispose();
    const restarted = new CloudManager(store!, connection as unknown as ConnectionManager, { active: null } as Runner, process.cwd(), { fetcher: fixture.fetcher, backgroundSafety: false, pollMs: 1, stopPollAttempts: 2 }); tracked = restarted;
    expect(restarted.state.launches[0].needsReconnect).toBe(true); await restarted.enforceSafety();
    expect(restarted.state.launches[0].phase).toBe('waiting'); expect(restarted.state.launches[0].setupDeadline).toBeNull(); expect(fixture.createCount).toBe(1); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
  });
  it('keeps healthy unfinished setup and ready rentals running during graceful shutdown', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'shutdown'); await until(() => !cloud.state.busy);
    await cloud.shutdown(); expect(launch.phase).toBe('ready'); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
    launch.phase = 'installing'; launch.safetyStatus = 'armed'; cloud.emit(); await cloud.shutdown();
    expect(launch.phase).toBe('installing'); expect(launch.needsReconnect).toBe(true); expect(fixture.createCount).toBe(1); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
  });
  it('retains a rental accepted during shutdown for reconnection without duplicating it or stopping healthy compute', async () => {
    const { cloud, fixture } = await manager(); let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); const request = cloud.client.request.bind(cloud.client);
    vi.spyOn(cloud.client, 'request').mockImplementation(async (route, method, body, timeout) => { const result = await request(route, method, body, timeout); if (route.startsWith('/api/v0/asks/')) await wait; return result; });
    const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'shutdown-pending-create'); await until(() => fixture.createCount === 1);
    let closed = false; const closing = cloud.shutdown().then(() => { closed = true; }); await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false);
    release(); await closing; expect(launch.phase).toBe('waiting'); expect(launch.needsReconnect).toBe(true); expect(launch.instanceId).toBe(777); expect(fixture.createCount).toBe(1); expect(fixture.calls.some(c => c.body?.state === 'stopped')).toBe(false);
  });
  it('retains a requested resume across local shutdown without sending another stop', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'shutdown-pending-start'); await until(() => !cloud.state.busy); await cloud.action(777, 'stop');
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); const request = cloud.client.request.bind(cloud.client);
    vi.spyOn(cloud.client, 'request').mockImplementation(async (route, method, body, timeout) => { const result = await request(route, method, body, timeout); if (method === 'PUT' && (body as any)?.state === 'running') await wait; return result; });
    await cloud.continue(launch); await until(() => launch.phase === 'requesting');
    const stopsBefore = fixture.calls.filter(c => c.body?.state === 'stopped').length;
    let closed = false; const closing = cloud.shutdown().then(() => { closed = true; }); await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false);
    release(); await closing; expect(launch.phase).toBe('waiting'); expect(launch.needsReconnect).toBe(true); expect(fixture.createCount).toBe(1); expect(fixture.calls.filter(c => c.body?.state === 'stopped')).toHaveLength(stopsBefore);
  });
  it('retries an unconfirmed compute stop when the provider becomes reachable again', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'retry-stop'); await until(() => !cloud.state.busy);
    fixture.loseStopResponse(); await expect(cloud.action(777, 'stop')).rejects.toThrow('NOT confirmed');
    fixture.loseStopResponse(false); await cloud.enforceSafety(); expect(launch.phase).toBe('stopped'); expect(fixture.createCount).toBe(1);
  });
  it('can stop an owned rental even when the account listing endpoint is malformed', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'emergency-stop'); await until(() => !cloud.state.busy);
    fixture.invalidInstanceList(); await cloud.action(777, 'stop'); expect(launch.phase).toBe('stopped'); expect(launch.safetyStatus).toBe('stopped');
  });
  it('blocks a new paid request while an earlier accepted request cannot yet be located', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters);
    const launch = cloud.launch(offers[0].quote, .23, 'earlier-unresolved'); await until(() => !cloud.state.busy);
    launch.instanceId = null; launch.label = 'unresolved-label'; launch.phase = 'unknown'; launch.creationAttempted = true; launch.safetyStatus = 'unconfirmed'; cloud.emit();
    const next = cloud.launch(offers[0].quote, .23, 'new-request'); await until(() => !cloud.state.busy);
    expect(next.message).toContain('still unconfirmed'); expect(next.creationAttempted).toBe(false); expect(fixture.createCount).toBe(1);
  });
  it('saves a host from a trusted quote once and persists it without stale availability or quote tokens', async () => {
    const { cloud, fixture, connection } = await manager(); const { offers } = await cloud.offers(filters);
    cloud.saveFavourite({ quote: offers[0].quote }); cloud.saveFavourite({ quote: offers[0].quote });
    expect(cloud.state.favourites).toHaveLength(1); expect(cloud.state.favourites![0].machineId).toBe(99);
    expect(() => cloud.saveFavourite({ quote: 'invented' })).toThrow('current offer');
    const saved = store!.value<any[]>('cloud-favourites', []); expect(saved[0].offer).toBeUndefined(); expect(saved[0].quote).toBeUndefined();
    const restored = new CloudManager(store!, connection as unknown as ConnectionManager, { active: null } as Runner, process.cwd(), { fetcher: fixture.fetcher, backgroundSafety: false });
    expect(restored.state.favourites![0]).toMatchObject({ machineId: 99, status: 'unchecked', checkedAt: null, offer: null }); restored.dispose();
  });
  it('finds a fresh offer on the same saved machine and GPU using the selected resources', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); cloud.saveFavourite({ quote: offers[0].quote });
    fixture.setPrice(.21); await cloud.checkFavourites({ ...filters, disk: 128, ram: 64 });
    const saved = cloud.state.favourites![0]; expect(saved.status).toBe('available'); expect(saved.offer?.machineId).toBe(99); expect(saved.offer?.totalHourly).toBe(.21); expect(saved.offer?.disk).toBe(128);
    const search = fixture.calls.filter(call => call.url.pathname === '/api/v0/bundles/').at(-1)!;
    expect(search.body.machine_id).toEqual({ eq: 99 }); expect(search.body.gpu_name).toEqual({ eq: 'RTX 3090' }); expect(search.body.cpu_ram).toEqual({ gte: 64000 });
    expect(search.body.inet_down_cost).toEqual({ lte: .005 });
    expect(fixture.createCount).toBe(0); expect(fixture.calls.some(call => call.method === 'DELETE')).toBe(false);
    const launch = cloud.launch(saved.offer!.quote, .21, 'favourite-rental'); await until(() => !cloud.state.busy); expect(launch.phase).toBe('ready');
  });
  it('does not replace a saved machine with a cheaper offer from another host', async () => {
    const { cloud } = await manager(); const { offers } = await cloud.offers(filters); cloud.saveFavourite({ quote: offers[0].quote });
    vi.spyOn(cloud.client, 'offers').mockResolvedValueOnce([{ ...rawOffer(), machine_id: 100 }]);
    await cloud.checkFavourites(filters); expect(cloud.state.favourites![0]).toMatchObject({ status: 'unavailable', offer: null });
  });
  it('keeps a saved host unavailable when its download fee exceeds the cap', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); cloud.saveFavourite({ quote: offers[0].quote });
    fixture.setTransfer(.0390625); await cloud.checkFavourites(filters);
    expect(cloud.state.favourites![0]).toMatchObject({ status: 'unavailable', offer: null });
    expect(cloud.state.favourites![0].message).toContain('$0.005/GB'); expect(fixture.createCount).toBe(0);
  });
  it('distinguishes a failed availability request from an unavailable host', async () => {
    const { cloud } = await manager(); const { offers } = await cloud.offers(filters); cloud.saveFavourite({ quote: offers[0].quote });
    const query = vi.spyOn(cloud.client, 'offers').mockResolvedValueOnce([]); await cloud.checkFavourites(filters); expect(cloud.state.favourites![0].status).toBe('unavailable');
    query.mockRejectedValueOnce(new VastError('Provider unavailable', 503)); await cloud.checkFavourites(filters); expect(cloud.state.favourites![0].status).toBe('error');
    query.mockRestore(); await cloud.checkFavourites(filters); expect(cloud.state.favourites![0].status).toBe('available');
  });
  it('retains favourites after a rental is destroyed and removes only the bookmark on unfavourite', async () => {
    const { cloud, fixture } = await manager(); const { offers } = await cloud.offers(filters); const launch = cloud.launch(offers[0].quote, .23, 'past-rental'); await until(() => !cloud.state.busy);
    await cloud.action(777, 'destroy', '777'); cloud.saveFavourite({ launchId: launch.id }); expect(cloud.state.favourites![0].machineId).toBe(99);
    const deletes = fixture.calls.filter(call => call.method === 'DELETE').length;
    cloud.removeFavourite(cloud.state.favourites![0].id); expect(cloud.state.favourites).toHaveLength(0); expect(fixture.calls.filter(call => call.method === 'DELETE')).toHaveLength(deletes);
  });
  it('ignores stale availability responses when a newer settings check finishes first', async () => {
    const { cloud } = await manager(); const { offers } = await cloud.offers(filters); cloud.saveFavourite({ quote: offers[0].quote });
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const query = vi.spyOn(cloud.client, 'offers').mockImplementationOnce(async () => { await wait; return [rawOffer()]; });
    const older = cloud.checkFavourites(filters); await cloud.checkFavourites({ ...filters, disk: 128 }); release(); await older;
    expect(cloud.state.favourites![0].offer?.disk).toBe(128); query.mockRestore();
  });

});
