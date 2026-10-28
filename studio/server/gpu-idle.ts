import { randomUUID } from 'node:crypto';
import type { CloudManager } from './cloud';
import type { ConnectionManager } from './comfy';
import type { Store } from './store';
import type { GpuIdleState } from '../shared/cloud';

export const GPU_IDLE_MS = 5 * 60_000;
/** Read-only, bounded probe. Unknown/malformed status must never mean idle. */
export async function gpuQueueEmpty(endpoint: string): Promise<boolean> {
  const response = await fetch(endpoint + '/queue', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('The GPU queue could not be checked.');
  const queue = await response.json() as Record<string, unknown>;
  if (!queue || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('The GPU queue returned an unknown status.');
  return !queue.queue_running.length && !queue.queue_pending.length;
}

/** Server-side timer: keeps working when the tab is hidden or closed. */
export class GpuIdleManager {
  readonly state: GpuIdleState;
  private since: number | null = null;
  private scope = '';
  private epoch = 0;
  private checking = false;
  private pausing = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private observe = () => { if (!this.pausing && (!this.candidate() || this.busy())) this.touch(); };
  constructor(private store: Store, private cloud: CloudManager, private connection: ConnectionManager, private busy: () => boolean,
    private queueEmpty = gpuQueueEmpty, private now = Date.now) {
    this.state = { enabled: store.value('gpu-idle-auto-pause', true) === true, timeoutSeconds: GPU_IDLE_MS / 1000, instanceId: null,
      idleSince: null, pauseAt: null, status: 'inactive', message: 'Starts after the connected GPU finishes its work.' };
    cloud.state.idle = this.state;
  }
  start() {
    if (this.timer || this.closed) return;
    this.store.on('event', this.observe);
    this.timer = setInterval(() => void this.tick(), 15_000); this.timer.unref(); void this.tick();
  }
  dispose() { this.closed = true; this.epoch++; if (this.timer) clearInterval(this.timer); this.timer = null; this.store.off('event', this.observe); }
  private emit() { this.store.emit('event', { type: 'cloud', data: this.cloud.state }); }
  configure(enabled: boolean) {
    this.state.enabled = enabled; this.store.set('gpu-idle-auto-pause', enabled); this.touch();
    if (!this.pausing) { this.state.status = 'inactive'; this.state.message = enabled ? 'Starts after the connected GPU finishes its work.' : 'Automatic idle pause is off.'; }
    this.emit(); return this.state;
  }
  /** New work resets idle time, including work that starts during a queue probe. */
  touch() { this.epoch++; this.since = null; this.state.idleSince = this.state.pauseAt = null; }
  private candidate() {
    const id = this.store.value<number | null>('cloud-connected-instance', null);
    if (!this.state.enabled || !id || !this.cloud.state.configured || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188') return null;
    const launch = this.cloud.state.launches.find(item => item.instanceId === id);
    return launch?.phase === 'ready' && !['unconfirmed', 'stop_requested'].includes(launch.safetyStatus || '') ? id : null;
  }
  private setStatus(status: GpuIdleState['status'], message: string) { if (this.state.status === status && this.state.message === message) return; this.state.status = status; this.state.message = message; this.emit(); }
  async tick() {
    if (this.closed || this.checking) return; this.checking = true;
    try {
      const last = this.state.lastPause;
      if (last && !last.confirmedAt) {
        const launch = this.cloud.state.launches.find(item => item.instanceId === last.instanceId);
        if (launch && ['stopped', 'destroyed'].includes(launch.phase) && ['stopped', 'disarmed'].includes(launch.safetyStatus || '')) {
          last.confirmedAt = new Date(this.now()).toISOString(); delete last.error;
          this.setStatus('paused', 'Compute is paused. Model files are kept; storage is still billed.'); this.emit();
        }
      }
      const id = this.candidate(), endpoint = this.connection.status.endpoint;
      const scope = `${id}:${endpoint}`;
      if (scope !== this.scope) { this.touch(); this.scope = scope; }
      this.state.instanceId = id;
      if (!id) { this.touch(); if (this.state.status !== 'paused' && this.state.status !== 'error') this.setStatus('inactive', this.state.enabled ? 'Waiting for a connected Recast GPU.' : 'Automatic idle pause is off.'); return; }
      if (this.cloud.state.busy || this.busy()) { this.touch(); this.setStatus('busy', 'GPU work is active. The idle timer is reset.'); return; }
      const epoch = this.epoch;
      const valid = () => !this.closed && this.epoch === epoch && this.candidate() === id && this.connection.status.endpoint === endpoint && !this.busy();
      const empty = await this.queueEmpty(endpoint);
      if (!valid() || !empty || this.cloud.state.busy) { this.touch(); this.setStatus('busy', 'GPU work is active or the connection changed.'); return; }
      this.since ??= this.now(); this.state.idleSince = new Date(this.since).toISOString(); this.state.pauseAt = new Date(this.since + GPU_IDLE_MS).toISOString();
      if (this.now() - this.since < GPU_IDLE_MS) { this.setStatus('watching', 'Pauses compute after five minutes without GPU work.'); this.emit(); return; }
      this.pausing = true;
      this.state.lastPause = { id: randomUUID(), instanceId: id, requestedAt: new Date(this.now()).toISOString() };
      this.setStatus('pausing', 'Checking the rental and GPU queue before pausing compute.');
      const result = await this.cloud.pauseIdle(id, valid, () => this.queueEmpty(endpoint));
      if (result === 'aborted') { delete this.state.lastPause; this.touch(); this.setStatus('busy', 'Automatic pause deferred because GPU readiness changed.'); }
      else if (result === 'confirmed') { this.state.lastPause.confirmedAt = new Date(this.now()).toISOString(); this.touch(); this.setStatus('paused', 'Compute is paused. Model files are kept; storage is still billed.'); }
      else { this.state.lastPause.error = 'The pause is not confirmed. Recast is checking; compute charges may continue.'; this.touch(); this.setStatus('error', this.state.lastPause.error); }
      this.emit();
    } catch {
      this.touch(); this.setStatus('checking', 'GPU activity could not be verified. No automatic pause was sent.');
    } finally { this.pausing = false; this.checking = false; }
  }
}
