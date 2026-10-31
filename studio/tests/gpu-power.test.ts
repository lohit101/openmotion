import { describe, expect, it } from 'vitest';
import type { CloudInstance, CloudLaunch, CloudState } from '../shared/cloud';
import { gpuPowerTarget } from '../shared/gpu-power';
import {newestCloudState} from '../shared/cloud';

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
  it('keeps the explicitly selected rental after pause when other disks exist',()=>{
    const paused={...instance,connected:false,state:'exited',intendedState:'stopped',computeStopped:true};
    const value={...cloud,selectedInstanceId:1,instances:[{...paused,id:2},paused]};
    expect(gpuPowerTarget(value)).toMatchObject({instance:{id:1},action:'start'});
    expect(gpuPowerTarget({...value,selectedInstanceId:999})).toBeNull();
    expect(gpuPowerTarget({...cloud,selectedInstanceId:1,instances:[instance,{...instance,id:2}]})).toBeNull();
  });
  it('rejects stale HTTP snapshots after a newer live pause update',()=>{
    const running={...cloud,revision:100},paused={...cloud,revision:101,instances:[{...instance,connected:false,state:'stopped',computeStopped:true}]};
    expect(newestCloudState(paused,running)).toBe(paused);
    expect(newestCloudState(running,paused)).toBe(paused);
    expect(gpuPowerTarget(newestCloudState(paused,running))?.action).toBe('start');
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
