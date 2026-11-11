import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';
import { normalizeOffer } from '../server/cloud';
import { rankGpuOffers } from '../shared/cloud-recommendations';
import { marketplaceFilters, offerFiltersSchema } from '../shared/cloud';
import GpuMarketplace, { RentalConfiguration } from '../src/GpuMarketplace';
import GpuOfferDetails from '../src/GpuOfferDetails';
import { GpuScoreDetails } from '../src/GpuHardwareDetails';
import { commitGpuNumber } from '../src/GpuFilterField';

const filters = marketplaceFilters({ disk: 112 });
function offer(id: number, changes: Record<string, unknown> = {}) {
  return normalizeOffer({ id, ask_contract_id: id, machine_id: id, gpu_name: 'RTX A6000', gpu_arch: 'nvidia', compute_cap: 860, num_gpus: 1,
    gpu_ram: 49152, cpu_ram: 65536, cpu_cores_effective: 16, cpu_arch: 'amd64', verification: 'verified', reliability2: .995, driver_version: '595.84', cuda_max_good: 13,
    disk_space: 1024, disk_bw: 1000, inet_down: 2000, inet_up: 500, inet_down_cost: .001, inet_up_cost: .002, direct_port_count: 2, pcie_bw: 24,
    dlperf: 100, gpu_mem_bw: 800, total_flops: 40, search: { gpuCostPerHour: .28, diskHour: .02, totalHour: .3 }, rentable: true, rented: false, ...changes }, filters, 68);
}
describe('GPU value per dollar', () => {
  it('prefers near-equivalent compute at one sixth the price despite slightly slower internet', () => {
    const expensive = offer(1, { dlperf: 110, gpu_mem_bw: 850, inet_down: 2200, search: { gpuCostPerHour: .58, diskHour: .02, totalHour: .6 } });
    const cheap = offer(2, { inet_down: 1800, search: { gpuCostPerHour: .08, diskHour: .02, totalHour: .1 } });
    const ranked = rankGpuOffers([expensive, cheap], filters);
    expect(ranked[0].id).toBe(2); expect(ranked[0].recommendation?.rank).toBe(1);
    expect(ranked[0].recommendation!.score - ranked[1].recommendation!.score).toBeGreaterThan(60);
  });
  it('ranks identical hardware monotonically by total GPU and disk cost', () => {
    const ranked = rankGpuOffers([.6, .4, .2].map((price, id) => offer(id + 1, { search: { gpuCostPerHour: price - .02, diskHour: .02, totalHour: price } })), filters);
    expect(ranked.map(row => row.id)).toEqual([3, 2, 1]);
    expect(ranked[0].recommendation!.workPerDollar).toBeGreaterThan(ranked[1].recommendation!.workPerDollar!);
  });
  it('does not reward excess VRAM or RAM and cannot let download speed dominate price', () => {
    const normal = offer(1), memory = offer(2, { gpu_ram: 196608, cpu_ram: 524288 });
    const hugeNetwork = offer(3, { inet_down: 100000, disk_bw: 100000, search: { gpuCostPerHour: .58, diskHour: .02, totalHour: .6 } });
    const ranked = rankGpuOffers([normal, memory, hugeNetwork], filters);
    expect(ranked.map(row => row.id)).toEqual([1, 2, 3]);
    expect(ranked[0].recommendation?.score).toBe(ranked[1].recommendation?.score);
  });
  it('gives a small cold-start advantage to faster downloads at identical compute and rates', () => {
    const ranked = rankGpuOffers([offer(1, { inet_down: 250 }), offer(2, { inet_down: 4000 })], filters);
    expect(ranked[0].id).toBe(2); expect(ranked[0].recommendation!.score - ranked[1].recommendation!.score).toBeLessThanOrEqual(10);
    expect(ranked[0].recommendation!.components.value).toBe(ranked[1].recommendation!.components.value);
  });
  it('keeps unreported/invalid performance unrated and handles zero ingress without NaN', () => {
    const ranked = rankGpuOffers([offer(1, { dlperf: null }), offer(2, { gpu_mem_bw: 0 }), offer(3, { dlperf: NaN }), offer(4, { inet_down_cost: 0 })], filters);
    expect(ranked.filter(row => row.recommendation?.rank).map(row => row.id)).toEqual([4]);
    for (const row of ranked) { expect(Number.isFinite(row.recommendation!.score)).toBe(true); expect(row.recommendation!.score).toBeGreaterThanOrEqual(0); expect(row.recommendation!.score).toBeLessThanOrEqual(100); }
    expect(ranked[0].recommendation?.sessionCost).not.toBeNull();
  });
  it('ranks the complete eligible pool deterministically without mutating accepted quotes', () => {
    const input = [offer(3), offer(1), offer(2), offer(4, { machine_id: 1 }), offer(5, { inet_down_cost: .006 })], before = JSON.stringify(input);
    const a = rankGpuOffers(input, filters), b = rankGpuOffers([...input].reverse(), filters);
    expect(a).toEqual(b); expect(JSON.stringify(input)).toBe(before); expect(a).toHaveLength(4);
    expect(new Set(a.filter(row => row.recommendation?.rank).map(row => row.machineId)).size).toBe(3);
    expect(rankGpuOffers(input, { ...filters, maxHourly: .2 })).toEqual([]);
  });
});

describe('common hardware filters and rental review', () => {
  it('migrates stored module/name filters while retaining explicit price and hardware limits', () => {
    const old = offerFiltersSchema.parse({ workflow: 'imagen', gpu: 'RTX 4090', ram: 48, disk: 80, minVram: 40, maxHourly: .35, minDownload: 500 });
    expect(marketplaceFilters(old)).toMatchObject({ gpu: 'all', workflow: 'all', ram: 64, disk: 96, minVram: 40, maxHourly: .35, minDownload: 500 });
    expect(old).toMatchObject({ ram: 48, workflow: 'imagen' });
  });
  it.each([['', 40, 'Enter a number.'], ['abc', 40, 'Enter a number.'], ['0', 24, 'Minimum 24.'], ['5000', 1024, 'Maximum 1024.'], ['40.4', 40, 'Whole numbers only.'], ['48', 48, '']])('commits a numeric draft %s safely on blur', (raw, value, issue) => {
    expect(commitGpuNumber(String(raw), 40, 24, 1024)).toEqual({ value, issue });
  });
  it('retains fractional prices rather than rounding them to integers', () => { expect(commitGpuNumber('.27', .7, .01, 10, false)).toEqual({ value: .27, issue: '' }); });
  it('renders labelled numeric capacity inputs with no module preset selector', () => {
    const html = renderToStaticMarkup(<RentalConfiguration filters={filters} onChange={() => {}}/>);
    for (const name of ['Minimum GPU VRAM', 'Minimum system RAM']) expect(html).toContain(`aria-label="${name}" type="number"`);
    for (const name of ['Workflow', 'Find a GPU for your workflow', 'Remotion', 'Imagen']) expect(html).not.toContain(name);
    expect(html).toContain('input-group'); expect(html).toContain('Filters');
  });
  it('keeps the rent action outside the scrolling body and hardware collapsed', () => {
    const chosen = rankGpuOffers([offer(1)], filters)[0];
    const html = renderToStaticMarkup(<GpuOfferDetails offer={chosen} busy={false} rent={() => {}}/>);
    expect(html.indexOf('gpu-review-scroll')).toBeLessThan(html.indexOf('<footer'));
    expect(html).toContain('Rent GPU'); expect(html).toContain('<details class="gpu-review-hardware">');
    for (const text of ['EXPERIMENTAL PLATFORM', 'Blank engine first', 'Check configuration', 'favourite', 'Unresponsive hosts']) expect(html).not.toContain(text);
    expect(html).toContain('storage stays billed when paused');
    expect(renderToStaticMarkup(<GpuOfferDetails offer={chosen} busy rent={() => {}}/>)).toMatch(/disabled=""/);
  });
  it('uses a focusable hover/tap score trigger instead of another details dropdown', () => {
    const chosen = rankGpuOffers([offer(1)], filters)[0], html = renderToStaticMarkup(<GpuScoreDetails offer={chosen}/>);
    expect(html).toContain('<button'); expect(html).toContain('Value score'); expect(html).not.toContain('<details');
    const limited = renderToStaticMarkup(<GpuScoreDetails offer={rankGpuOffers([offer(2, { dlperf: null })], filters)[0]}/>);
    expect(limited).toContain('Unrated');
  });
  it('does not duplicate recommended cards or expose favourites/timestamps', () => {
    const offers = rankGpuOffers([offer(1), offer(2), offer(3), offer(4)], filters);
    const html = renderToStaticMarkup(<GpuMarketplace filters={filters} onChange={() => {}} offers={offers} selected={null} select={() => {}} searching={false} searched searchError="" searchedAt="2026-11-11T12:00:00Z" refresh={() => {}} details={null}/>);
    expect(html.match(/data-review-gpu=/g)).toHaveLength(4);
    for (const text of ['Favourites', 'favourite', 'refreshed', '12:00', 'Account']) expect(html).not.toContain(text);
  });
});

let root = '', app: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => { app?.idle.dispose(); app?.models.dispose(); app?.cloud.dispose(); app?.connection.disconnect(); app?.store.close(); if (root) await rm(root, { recursive: true, force: true }); app = undefined; root = ''; });
it('retires GPU favourite actions without deleting saved records or contacting Vast', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gpu-cloud-v3-'));
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('No provider access allowed'); });
  app = await createApplication({ dataRoot: root, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false, fetcher } });
  app.store.set('cloud-favourites', [{ id: 'keep-me', machineId: 1 }]);
  for (const route of ['/api/cloud/favourites', '/api/cloud/favourites/check']) await request(app.app).post(route).send({}).expect(410);
  await request(app.app).delete('/api/cloud/favourites/keep-me').expect(410);
  expect(app.store.value('cloud-favourites', [])).toEqual([{ id: 'keep-me', machineId: 1 }]); expect(fetcher).not.toHaveBeenCalled();
});
