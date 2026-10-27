// Isolated visual QA only. No account credentials or paid operations.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';
import { VastClient } from '../server/cloud';
import { offerFiltersSchema } from '../shared/cloud';
const root = await mkdtemp(path.join(os.tmpdir(), 'recast-visual-qa-'));
const local = await createApplication({ dataRoot: root, seed: true, allowSSH: false });
const rows = [
  { id: 101, gpu_name: 'RTX 3090', gpu_ram: 24576, dph_base: .17, geolocation: 'Germany, EU', reliability2: .998 },
  { id: 102, gpu_name: 'RTX 4090', gpu_ram: 24576, dph_base: .29, geolocation: 'Virginia, US', reliability2: .995 },
  { id: 103, gpu_name: 'RTX 5090', gpu_ram: 32768, dph_base: .47, geolocation: 'Finland, EU', reliability2: .999 },
];
local.cloud.client = new VastClient(async () => 'unused-fixture', async (input, init) => {
  if (process.env.RECAST_QA_SCENARIO === 'favourites' && String(input).includes('/instances/') && (!init?.method || init.method === 'GET')) return new Response(JSON.stringify({ instances: [] }), { headers: { 'Content-Type': 'application/json' } });
  if (String(input).includes('/instances/')) return new Response(JSON.stringify({ error: 'LOCAL QA FIXTURE: example prices and hardware. No live rentals can be created.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const filters = JSON.parse(String(init?.body)); const disk = filters.allocated_storage;
  const offers = rows.filter(row => (!filters.gpu_name.eq || row.gpu_name === filters.gpu_name.eq) && (!filters.machine_id?.eq || row.id + 10 === filters.machine_id.eq)).map(row => ({ ...row, machine_id: row.id + 10, num_gpus: 1, cpu_ram: 96000, cpu_name: 'AMD EPYC 7443P 24-Core Processor', cpu_cores_effective: 12,
    driver_version: '595.84.0', cuda_max_good: 13, verification: 'verified', disk_space: 1000, disk_bw: 1800, direct_port_count: 8, pcie_bw: 25,
    inet_down: 1300, inet_up: 800, inet_down_cost: .001, inet_up_cost: .005, storage_cost: .12, rentable: true, rented: false,
    search: { gpuCostPerHour: row.dph_base, diskHour: .12 * disk / 720, totalHour: row.dph_base + .12 * disk / 720 } }));
  return new Response(JSON.stringify({ offers }), { headers: { 'Content-Type': 'application/json' } });
});
local.cloud.state.configured = true;
local.cloud.state.error = 'LOCAL QA FIXTURE: example prices and hardware. No live rentals can be created.';
local.cloud.state.instances = [
  { id: 801, label: 'recast-fixture', gpu: 'RTX 3090', count: 1, vram: 24, ram: 96, state: 'running', intendedState: 'running', message: 'LOCAL QA: example running instance', disk: 80, diskUsed: 44.2, location: 'Germany, EU', totalHourly: .1833, storageHourly: .0133, storageMonthly: 9.6, managed: true, connected: false, createdAt: null },
  { id: 802, label: 'recast-fixture-stopped', gpu: 'RTX 4090', count: 1, vram: 24, ram: 64, state: 'stopped', intendedState: 'stopped', message: 'LOCAL QA: example stopped instance', disk: 96, diskUsed: 44.2, location: 'Virginia, US', totalHourly: .306, storageHourly: .016, storageMonthly: 11.52, managed: true, connected: false, createdAt: null },
];
local.cloud.launch = () => { throw new Error('Paid operations are disabled in this isolated visual fixture.'); };
const scenario = process.env.RECAST_QA_SCENARIO;
if (scenario === 'favourites') {
  local.cloud.state.instances = []; local.cloud.state.error = null;
  const offers = (await local.cloud.offers(offerFiltersSchema.parse({}))).offers;
  local.cloud.saveFavourite({ quote: offers[0].quote }); local.cloud.saveFavourite({ quote: offers[2].quote });
  await local.cloud.checkFavourites(offerFiltersSchema.parse({}));
  const now = new Date().toISOString();
  local.cloud.state.launches = [{ id: 'qa-previous-host', requestKey: 'qa-only', instanceId: 801, label: 'recast-fixture', offer: offers[1], phase: 'destroyed', createdAt: now, updatedAt: now, message: 'LOCAL QA: previous rental', logs: [] }];
}
if (scenario === 'warning' || scenario === 'error') {
  const offer = (await local.cloud.offers(offerFiltersSchema.parse({}))).offers[0];
  const failed = scenario === 'error', now = new Date().toISOString();
  local.cloud.state.launches = [{ id: 'qa-status', requestKey: 'qa-only', instanceId: 801, label: 'recast-fixture', offer,
    phase: failed ? 'stopped' : 'installing', message: failed ? 'Model checksum failed. Compute is confirmed stopped; partial downloads are kept.' : 'Downloading model files.',
    createdAt: now, updatedAt: now, setupStartedAt: now, setupDeadline: null, setupSlow: !failed,
    warning: failed ? null : 'Taking longer than usual. Setup is still running; elapsed time will not stop this instance.',
    failureCode: failed ? 'setup-failed' : undefined, lastFailure: failed ? 'Model checksum failed.' : undefined,
    logs: ['  wan2.1_14B_SCAIL_2_int8_convrot.safetensors: 65%', '  lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors: 40%'] }];
  local.cloud.state.busy = !failed;
}
const server = local.app.listen(3002, '127.0.0.1', () => console.log('Visual QA only: http://127.0.0.1:3002'));
async function stop() { server.closeAllConnections(); server.close(); local.cloud.dispose(); local.store.close(); await rm(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
