import type { CloudLaunch } from '../shared/cloud';

export const HOST_SILENCE_MS = 5 * 60_000;
export class EmptyHostError extends Error {}

// A quiet Docker pull is not a dead host. Require all of the missing signals
// observed in the failed rental, and a separate SSH reachability check.
export function hasNoContainerSignals(instance: any) {
  const unassigned = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) < 1;
  return (!instance.actual_status || instance.actual_status === 'unknown') &&
    !String(instance.status_msg || '').trim() && instance.intended_status === 'running' &&
    unassigned(instance.direct_port_start) && unassigned(instance.direct_port_end);
}

export function observeHostSilence(previous: CloudLaunch['hostWatch'], now = Date.now()) {
  // An app restart or a provider outage is not continuous monitoring evidence.
  const fresh = previous && now - Date.parse(previous.lastCheckedAt) <= 60_000;
  return { since: fresh ? previous.since : new Date(now).toISOString(), lastCheckedAt: new Date(now).toISOString(), checks: fresh ? previous.checks + 1 : 1 };
}

export function hostSilenceExpired(watch: CloudLaunch['hostWatch'], now = Date.now(), interval = HOST_SILENCE_MS) {
  return !!watch && watch.checks >= 3 && now - Date.parse(watch.since) >= interval;
}
