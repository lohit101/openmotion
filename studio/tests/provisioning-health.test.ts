import { describe, expect, it } from 'vitest';
import { hasNoContainerSignals, hostSilenceExpired, observeHostSilence } from '../server/provisioning-health';

const silent = { actual_status: null, status_msg: null, intended_status: 'running', direct_port_start: -1, direct_port_end: -1 };
describe('empty host provisioning evidence', () => {
  it('requires explicitly missing ports and status, not a quiet image pull or partial telemetry', () => {
    expect(hasNoContainerSignals(silent)).toBe(true);
    for (const change of [{ actual_status: 'loading' }, { status_msg: 'Pulling an image layer' }, { direct_port_start: 22000 }, { direct_port_end: undefined }, { intended_status: 'stopped' }]) expect(hasNoContainerSignals({ ...silent, ...change })).toBe(false);
  });
  it('requires repeated observations and resets evidence after an outage or local restart', () => {
    const start = Date.parse('2026-10-25T18:00:00Z');
    let watch = observeHostSilence(undefined, start);
    expect(hostSilenceExpired(watch, start + 300_000)).toBe(false);
    for (let i = 1; i <= 30; i++) watch = observeHostSilence(watch, start + i * 10_000);
    expect(hostSilenceExpired(watch, start + 300_000)).toBe(true);
    const reset = observeHostSilence(watch, start + 400_000);
    expect(reset.checks).toBe(1); expect(hostSilenceExpired(reset, start + 400_000)).toBe(false);
  });
});
