import { z } from 'zod';
import budget from '../../config/budget-profile.json';

export const GPU_COMPUTE_CEILING = budget.gpu_compute_ceiling_usd_per_hour;
export const DOWNLOAD_PRICE_CEILING = budget.download_ceiling_usd_per_gb;
export function withinDownloadBudget(perGB: number | null): boolean {
  return perGB !== null && Number.isFinite(perGB) && perGB >= 0 && perGB <= DOWNLOAD_PRICE_CEILING;
}
export function withinComputeBudget(hourly: number | null): boolean {
  return hourly !== null && Number.isFinite(hourly) && hourly >= 0 && hourly <= GPU_COMPUTE_CEILING + 1e-9;
}

// Provider model names, checked against Vast's /gpu_names/unique/ catalog.
export const aSeriesGpuNames = ['A10', 'A30', 'A40', 'A100 PCIE', 'A100 SXM4', 'A800 PCIE', 'RTX A5000', 'RTX A5500', 'RTX A6000'];
const rtxGpuNames = ['RTX 3090', 'RTX 3090 Ti', 'RTX 4090', 'RTX 5090'];
export const dgxGpuNames = ['GB10', 'GB200', 'GB300', 'B200', 'B300', 'B300 PC', 'H100 NVL', 'H100 PCIE', 'H100 SXM', 'H200', 'H200 NVL', 'A100 PCIE', 'A100 SXM4', 'A800 PCIE'] as const;
export const datacenterGpuNames = [
  'RTX PRO 5000', 'RTX PRO 6000 WS', 'RTX PRO 6000 S', 'RTX PRO 6000 Max-Q', 'RTX PRO 4500', 'RTX PRO 4000',
  'RTX 6000Ada', 'RTX 5880Ada', 'RTX 5000Ada', 'RTX A6000', 'RTX A5000',
  'L40S', 'L40', 'L4', 'A40', 'A30', 'A10',
  ...dgxGpuNames,
] as const;
const legacyGpuNames = ['RTX A5500', 'RTX 6000 Ada Generation'] as const;
export function isDgxSpark(name: string) { return /^(?:NVIDIA\s+)?GB10$/i.test(name.trim()); }
export function isGraceBlackwell(name: string) { return /^(?:NVIDIA\s+)?GB(?:10|200|300)$/i.test(name.trim()); }
export function isDgxGpu(name: string) { return dgxGpuNames.some(gpu => gpu === name.replace(/^NVIDIA\s+/i, '')); }
export function isDatacenterGpu(name: string) { return datacenterGpuNames.some(gpu => gpu === name.replace(/^NVIDIA\s+/i, '')) || legacyGpuNames.some(gpu => gpu === name); }
export function isDatacenterFilter(value: string) { return ['datacenter', 'dgx', 'a-series'].includes(value) || isDatacenterGpu(value); }
export function gpuDisplayName(name: string) { return isDgxSpark(name) ? 'DGX Spark / GB10' : name; }
export function gpuMemorySummary(device: { gpu: string; vram: number; ram: number }) {
  return isDgxSpark(device.gpu) ? `${device.vram.toFixed(0)} GB shared memory` : `${device.vram.toFixed(0)} GB VRAM · ${device.ram.toFixed(0)} GB RAM`;
}

export const offerFiltersSchema = z.object({
  gpu: z.enum(['all', 'RTX 3090', 'RTX 4090', 'RTX 5090', 'datacenter', 'a-series', 'dgx', ...datacenterGpuNames, ...legacyGpuNames]).default('all'),
  disk: z.number().int().min(64).max(2048).default(80),
  ram: z.union([z.literal(48), z.literal(64), z.literal(96)]).default(48),
  verified: z.boolean().default(true),
  minDownload: z.number().int().min(0).max(100000).default(0),
  sort: z.enum(['price', 'compute', 'setup']).default('price'),
});
export type OfferFilters = z.infer<typeof offerFiltersSchema>;
export const gpuFilterOptions: { value: OfferFilters['gpu']; label: string }[] = [
  { value: 'all', label: 'All GPUs' },
  { value: 'RTX 3090', label: '3090' },
  { value: 'RTX 4090', label: '4090' },
  { value: 'RTX 5090', label: '5090' },
  { value: 'datacenter', label: 'Datacenter' },
];
export function offerGpuFilter(gpu: OfferFilters['gpu']) {
  if (gpu === 'a-series') return { in: [...aSeriesGpuNames] };
  if (gpu === 'dgx') return { in: [...dgxGpuNames] };
  if (gpu === 'datacenter') return { in: [...datacenterGpuNames] };
  if (gpu === 'all') return { in: [...new Set([...rtxGpuNames, ...datacenterGpuNames, ...legacyGpuNames])] };
  return { eq: gpu };
}
export function supportedGpuName(name: string) { return /RTX/i.test(name) || isDatacenterGpu(name); }

export function sameGpuModel(expected: string, reported: string) {
  const compact = (value: string) => value.toUpperCase().replace(/NVIDIA|GEFORCE|TESLA|QUADRO|GENERATION/g, '').replace(/[^A-Z0-9]/g, '');
  const wanted = compact(expected), actual = compact(reported);
  if (!supportedGpuName(expected) || /\bMIG\b/i.test(reported)) return false;
  if (isDgxSpark(expected)) return isDgxSpark(reported);
  if (isGraceBlackwell(expected)) return wanted === actual;
  if (wanted === 'B300PC') return actual === 'B300' || actual === 'B300PC';
  if (/^L(?:4|40|40S)$/.test(wanted)) return wanted === actual;
  if (wanted.startsWith('RTXPRO6000')) {
    if (!actual.startsWith('RTXPRO6000')) return false;
    if (wanted.endsWith('MAXQ')) return actual.includes('MAXQ');
    if (wanted.endsWith('WS')) return /WORKSTATION|WS$/.test(actual) && !/MAXQ|SERVER/.test(actual);
    if (wanted.endsWith('S')) return /SERVER|RTXPRO6000S$/.test(actual);
  }
  if (/^H(?:100|200)/.test(wanted)) {
    if (wanted.startsWith('H100')) {
      const sxm = actual.includes('SXM') || actual.includes('HBM3');
      return actual.includes('H100') && (wanted.includes('NVL') ? actual.includes('NVL') : wanted.includes('SXM') ? sxm : actual.includes('PCIE') && !sxm && !actual.includes('NVL'));
    }
    return actual.includes('H200') && (!wanted.includes('NVL') || actual.includes('NVL'));
  }
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
export interface GpuFavourite {
  id: string; machineId: number; gpu: string; location: string; savedAt: string;
  sourceLaunchId?: string; lastHourly: number | null;
  status: 'unchecked' | 'checking' | 'available' | 'unavailable' | 'error' | 'cooldown';
  checkedAt: string | null; message?: string; offer?: GpuOffer | null;
}
export type LaunchPhase = 'checking' | 'requesting' | 'waiting' | 'installing' | 'connecting' | 'stopping' | 'destroying' | 'ready' | 'failed' | 'unknown' | 'stopped' | 'destroyed';
export interface CloudLaunch {
  id: string; requestKey: string; instanceId: number | null; label: string; offer: GpuOffer; phase: LaunchPhase; message: string;
  createdAt: string; updatedAt: string; logs: string[];
  creationAttempted?: boolean; approvedHourly?: number; filters?: OfferFilters;
  approvedTransfer?: { download: number | null; upload: number | null };
  setupTimeoutMinutes?: number; setupDeadline?: string | null; autoStopOnFailure?: boolean;
  setupStartedAt?: string; setupWarningAt?: string | null; setupSlow?: boolean; warning?: string | null; needsReconnect?: boolean;
  lastLogAt?: string;
  stageDetail?: string;
  emptyRental?: boolean; engineSetupStartedAt?: string;
  hostWatch?: { since: string; lastCheckedAt: string; checks: number };
  autoCleanup?: { state: 'pending' | 'confirmed'; reason: string; requestedAt: string; confirmedAt?: string; lastError?: string };
  safetyStatus?: 'armed' | 'stop_requested' | 'stopped' | 'unconfirmed' | 'disarmed';
  lastFailure?: string; failureCode?: 'offer-unavailable' | 'price-changed' | 'transfer-changed' | 'setup-failed' | 'request-unconfirmed' | 'host-unresponsive';
  setupDownloads?: { id: string; downloaded: number; total: number; phase: 'queued' | 'downloading' | 'verifying' | 'ready' }[];
}
export function canRetryRental(launch: CloudLaunch) {
  if (['offer-unavailable', 'price-changed', 'transfer-changed', 'host-unresponsive'].includes(launch.failureCode || '') || /offer.*(?:rented|no longer listed|unavailable)|price increased|transfer.*increased/i.test(launch.message)) return false;
  return !launch.instanceId && launch.phase !== 'destroyed' && (launch.creationAttempted === false ||
    (launch.creationAttempted === undefined && launch.phase === 'failed' && /SSH key already exists|offer was rented by someone else|hourly price increased/i.test(launch.message)));
}
export interface CloudState { configured: boolean; keySource: 'environment' | 'local' | null; instances: CloudInstance[]; launches: CloudLaunch[]; favourites?: GpuFavourite[]; refreshedAt: string | null; error: string | null; busy: boolean; }
