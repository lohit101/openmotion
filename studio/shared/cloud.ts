import { z } from 'zod';

// Provider model names, checked against Vast's /gpu_names/unique/ catalog.
export const aSeriesGpuNames = ['A10', 'A30', 'A40', 'A100 PCIE', 'A100 SXM4', 'A800 PCIE', 'RTX A5000', 'RTX A5500', 'RTX A6000'];
const rtxGpuNames = ['RTX 3090', 'RTX 3090 Ti', 'RTX 4090', 'RTX 5090', 'RTX A5000', 'RTX A5500', 'RTX A6000', 'RTX 6000Ada', 'RTX 6000 Ada Generation', 'RTX PRO 6000 WS'];
export const dgxGpuNames = ['GB10'];
export function isDgxSpark(name: string) { return /^(?:NVIDIA\s+)?GB10$/i.test(name.trim()); }
export function gpuDisplayName(name: string) { return isDgxSpark(name) ? 'DGX Spark / GB10' : name; }
export function gpuMemorySummary(device: { gpu: string; vram: number; ram: number }) {
  return isDgxSpark(device.gpu) ? `${device.vram.toFixed(0)} GB shared memory` : `${device.vram.toFixed(0)} GB VRAM · ${device.ram.toFixed(0)} GB RAM`;
}

export const offerFiltersSchema = z.object({
  gpu: z.enum(['all', 'RTX 3090', 'RTX 4090', 'RTX 5090', 'a-series', 'dgx']).default('all'),
  disk: z.number().int().min(64).max(2048).default(80),
  ram: z.union([z.literal(48), z.literal(64), z.literal(96)]).default(48),
  verified: z.boolean().default(true),
  sort: z.enum(['price', 'compute', 'setup']).default('price'),
});
export type OfferFilters = z.infer<typeof offerFiltersSchema>;
export const gpuFilterOptions: { value: OfferFilters['gpu']; label: string }[] = [
  { value: 'all', label: 'All GPUs' },
  { value: 'RTX 3090', label: '3090' },
  { value: 'RTX 4090', label: '4090' },
  { value: 'RTX 5090', label: '5090' },
  { value: 'a-series', label: 'Datacenter / A-series' },
  { value: 'dgx', label: 'DGX Spark / GB10' },
];
export function offerGpuFilter(gpu: OfferFilters['gpu']) {
  if (gpu === 'a-series') return { in: [...aSeriesGpuNames] };
  if (gpu === 'dgx') return { in: [...dgxGpuNames] };
  if (gpu === 'all') return { in: [...new Set([...rtxGpuNames, ...aSeriesGpuNames, ...dgxGpuNames])] };
  return { eq: gpu };
}
export function supportedGpuName(name: string) { return /RTX/i.test(name) || aSeriesGpuNames.includes(name) || isDgxSpark(name); }

export function sameGpuModel(expected: string, reported: string) {
  const compact = (value: string) => value.toUpperCase().replace(/NVIDIA|GEFORCE|TESLA|QUADRO|GENERATION/g, '').replace(/[^A-Z0-9]/g, '');
  const wanted = compact(expected), actual = compact(reported);
  if (!supportedGpuName(expected) || /\bMIG\b/i.test(reported)) return false;
  if (isDgxSpark(expected)) return isDgxSpark(reported);
  if (/^A(?:10|30|40|100|800)(?!\d)/.test(wanted)) {
    const family = wanted.match(/^A\d+/)![0];
    if (!new RegExp(`(?:^|[^A-Z0-9])${family}(?:$|[^A-Z0-9])`, 'i').test(reported)) return false;
    // Vast: "A100 PCIE"; nvidia-smi: "NVIDIA A100 80GB PCIe".
    const interconnect = wanted.match(/PCIE|SXM\d*/)?.[0];
    return !interconnect || actual.includes(interconnect);
  }
  return actual.includes(wanted);
}
export interface GpuOffer {
  id: number; machineId: number; gpu: string; vram: number; ram: number; cpus: number; cpu: string; location: string;
  verified: boolean; reliability: number; driver: string; cuda: number; diskMax: number; diskBandwidth: number;
  downloadMbps: number; uploadMbps: number; downloadPerGB: number | null; uploadPerGB: number | null; pcie: number;
  computeHourly: number | null; storageHourly: number | null; totalHourly: number | null; storageMonthly: number | null;
  modelDownloadCost: number | null; modelDownloadGB?: number; disk: number; expiresAt: string; quote: string; compatible: boolean; reasons: string[];
}
export interface CloudInstance {
  id: number; label: string; gpu: string; count: number; vram: number; ram: number; state: string; intendedState: string; message: string;
  disk: number; diskUsed: number | null; location: string; totalHourly: number | null; storageHourly: number | null; storageMonthly: number | null;
  managed: boolean; connected: boolean; createdAt: string | null; computeStopped?: boolean;
}
export type LaunchPhase = 'checking' | 'requesting' | 'waiting' | 'installing' | 'connecting' | 'stopping' | 'destroying' | 'ready' | 'failed' | 'unknown' | 'stopped' | 'destroyed';
export interface CloudLaunch {
  id: string; requestKey: string; instanceId: number | null; label: string; offer: GpuOffer; phase: LaunchPhase; message: string;
  createdAt: string; updatedAt: string; logs: string[];
  creationAttempted?: boolean; approvedHourly?: number; filters?: OfferFilters;
  approvedTransfer?: { download: number | null; upload: number | null };
  setupTimeoutMinutes?: number; setupDeadline?: string | null; autoStopOnFailure?: boolean;
  setupStartedAt?: string; setupWarningAt?: string | null; setupSlow?: boolean; warning?: string | null; needsReconnect?: boolean;
  safetyStatus?: 'armed' | 'stop_requested' | 'stopped' | 'unconfirmed' | 'disarmed';
  lastFailure?: string; failureCode?: 'offer-unavailable' | 'price-changed' | 'transfer-changed' | 'setup-failed' | 'request-unconfirmed';
  setupDownloads?: { id: string; downloaded: number; total: number; phase: 'queued' | 'downloading' | 'verifying' | 'ready' }[];
}
export function canRetryRental(launch: CloudLaunch) {
  if (['offer-unavailable', 'price-changed', 'transfer-changed'].includes(launch.failureCode || '') || /offer.*(?:rented|no longer listed|unavailable)|price increased|transfer.*increased/i.test(launch.message)) return false;
  return !launch.instanceId && launch.phase !== 'destroyed' && (launch.creationAttempted === false ||
    (launch.creationAttempted === undefined && launch.phase === 'failed' && /SSH key already exists|offer was rented by someone else|hourly price increased/i.test(launch.message)));
}
export interface CloudState { configured: boolean; keySource: 'environment' | 'local' | null; instances: CloudInstance[]; launches: CloudLaunch[]; refreshedAt: string | null; error: string | null; busy: boolean; }
