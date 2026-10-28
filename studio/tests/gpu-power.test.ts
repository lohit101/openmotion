import { describe, expect, it } from 'vitest';
import type { CloudInstance, CloudLaunch, CloudState } from '../shared/cloud';
import { gpuPowerTarget } from '../shared/gpu-power';

const instance = { id: 1, managed: true, connected: true, state: 'running', intendedState: 'running', computeStopped: false } as CloudInstance;
const launch = { instanceId: 1, phase: 'ready', offer: { totalHourly: .3 } } as CloudLaunch;
const cloud = { instances: [instance], launches: [launch], busy: false } as CloudState;

describe('header GPU power target', () => {
  it('pauses the connected managed instance', () => {
    expect(gpuPowerTarget(cloud)).toMatchObject({ instance: { id: 1 }, action: 'stop', blocked: false });
  });
  it('resumes a confirmed paused rental even when the connection is offline', () => {
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, connected: false, computeStopped: true, state: 'exited', intendedState: 'stopped' }] })).toMatchObject({ action: 'start', blocked: false });
  });
  it('does not interpret a failed or unknown provider state as permission to resume', () => {
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, state: 'offline', connected: false }] })?.action).toBeNull();
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, state: 'exited', connected: false }] })?.action).toBeNull();
  });
  it('does not guess between disconnected rentals or control unmanaged rentals', () => {
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, connected: false }, { ...instance, id: 2, connected: false }] })).toBeNull();
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, managed: false }] })).toBeNull();
    expect(gpuPowerTarget({ ...cloud, instances: [] })).toBeNull();
  });
  it('prefers the connected rental over other retained disks', () => {
    expect(gpuPowerTarget({ ...cloud, instances: [{ ...instance, id: 2, connected: false, computeStopped: true }, instance] })?.instance.id).toBe(1);
  });
  it('blocks duplicate stopping and resume during provisioning', () => {
    expect(gpuPowerTarget({ ...cloud, launches: [{ ...launch, phase: 'stopping' }] })?.blocked).toBe(true);
    expect(gpuPowerTarget({ ...cloud, busy: true, instances: [{ ...instance, computeStopped: true }] })?.blocked).toBe(true);
    expect(gpuPowerTarget({ ...cloud, busy: true, launches: [{ ...launch, phase: 'installing' }] })).toMatchObject({ action: 'stop', blocked: false });
  });
  it('never controls a destroyed or untracked rental', () => {
    expect(gpuPowerTarget({ ...cloud, launches: [{ ...launch, phase: 'destroyed' }] })).toBeNull();
    expect(gpuPowerTarget({ ...cloud, launches: [] })).toBeNull();
  });
});
