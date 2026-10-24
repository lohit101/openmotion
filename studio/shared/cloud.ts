import { z } from 'zod';

export const offerFiltersSchema = z.object({
  gpu: z.enum(['all', 'RTX 3090', 'RTX 4090', 'RTX 5090']).default('all'),
  disk: z.number().int().min(64).max(2048).default(80),
  ram: z.union([z.literal(48), z.literal(64), z.literal(96)]).default(48),
  verified: z.boolean().default(true),
  sort: z.enum(['price', 'compute', 'setup']).default('price'),
});
export type OfferFilters = z.infer<typeof offerFiltersSchema>;
export interface GpuOffer {
  id: number; machineId: number; gpu: string; vram: number; ram: number; cpus: number; cpu: string; location: string;
  verified: boolean; reliability: number; driver: string; cuda: number; diskMax: number; diskBandwidth: number;
  downloadMbps: number; uploadMbps: number; downloadPerGB: number | null; uploadPerGB: number | null; pcie: number;
  computeHourly: number | null; storageHourly: number | null; totalHourly: number | null; storageMonthly: number | null;
  modelDownloadCost: number | null; disk: number; expiresAt: string; quote: string; compatible: boolean; reasons: string[];
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
}
export function canRetryRental(launch: CloudLaunch) {
  if (['offer-unavailable', 'price-changed', 'transfer-changed'].includes(launch.failureCode || '') || /offer.*(?:rented|no longer listed|unavailable)|price increased|transfer.*increased/i.test(launch.message)) return false;
  return !launch.instanceId && launch.phase !== 'destroyed' && (launch.creationAttempted === false ||
    (launch.creationAttempted === undefined && launch.phase === 'failed' && /SSH key already exists|offer was rented by someone else|hourly price increased/i.test(launch.message)));
}
export interface CloudState { configured: boolean; keySource: 'environment' | 'local' | null; instances: CloudInstance[]; launches: CloudLaunch[]; refreshedAt: string | null; error: string | null; busy: boolean; }
