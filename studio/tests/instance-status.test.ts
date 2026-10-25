import { describe, expect, it } from 'vitest';
import type { CloudInstance, CloudLaunch } from '../shared/cloud';
import { instancePresentation, setupDescription } from '../shared/instance-status';

const instance = { state: 'loading', intendedState: 'running', connected: false, totalHourly: .002, storageHourly: .002, diskUsed: -1 } as CloudInstance;
const launch = { phase: 'waiting', approvedHourly: .242, offer: { totalHourly: .242 }, message: 'layer: Verifying Checksum' } as CloudLaunch;
describe('instance management presentation', () => {
  it('shows the accepted running quote when the provider reports only storage during startup', () => {
    expect(instancePresentation(instance, launch)).toMatchObject({ hourly: .242, useQuote: true, preparing: true, label: 'Starting container', diskUsed: null });
    expect(setupDescription(launch)).toContain('container image');
  });
  it('uses a full live running rate once the provider reports it', () => {
    expect(instancePresentation({ ...instance, totalHourly: .25 }, launch)).toMatchObject({ hourly: .25, useQuote: false });
  });
  it('shows storage billing and a paused state after a confirmed stop', () => {
    expect(instancePresentation({ ...instance, state: 'exited', intendedState: 'stopped', computeStopped: true }, { ...launch, phase: 'stopped' })).toMatchObject({ hourly: .002, stopped: true, preparing: false, label: 'Paused' });
  });
  it('does not call a stale connection connected while stopping or provisioning', () => {
    expect(instancePresentation({ ...instance, connected: true }, launch).connected).toBe(false);
    expect(instancePresentation({ ...instance, connected: true }, { ...launch, phase: 'stopping' })).toMatchObject({ connected: false, ending: true, label: 'Pausing compute' });
  });
  it('keeps reconnect available and reports failures separately from healthy slow setup', () => {
    expect(instancePresentation(instance, { ...launch, needsReconnect: true })).toMatchObject({ preparing: false, label: 'Reconnect setup', tone: 'warning' });
    expect(instancePresentation(instance, { ...launch, phase: 'failed', failureCode: 'setup-failed' })).toMatchObject({ failed: true, tone: 'error' });
    expect(instancePresentation(instance, { ...launch, setupSlow: true }).failed).toBe(false);
  });
});
