import { useRef, useState } from 'react';
import { CircleNotch, Pause, Play } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { CloudState } from '../shared/cloud';
import { gpuPowerTarget } from '../shared/gpu-power';
import { api, Modal } from './components';
import { browserAlerts } from './alerts';

export default function GpuPowerControl({ cloud, setCloud, activeWork, browse }: {
  cloud: CloudState; setCloud: (value: CloudState) => void; activeWork: boolean; browse: () => void;
}) {
  const target = gpuPowerTarget(cloud);
  const [pending, setPending] = useState<'start' | 'stop' | 'checking' | null>(null);
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const locked = useRef(false);
  const resume = target?.action === 'start';
  const transition=target?.view.ending;
  const disabled = !target?.action || target.blocked || !!pending || !!cloud.error;
  const label = pending === 'checking' ? 'Checking GPU status…' : pending === 'stop'||transition ? 'Pausing GPU…' : pending === 'start' ? 'Resuming GPU…' : !target?.action?'GPU power unavailable':resume ? 'Resume GPU' : 'Pause GPU';
  const title = cloud.error ? 'GPU status unavailable. Open GPU cloud to refresh.' : !target ? 'Select an instance in GPU cloud' : !target.action ? 'Check instance status in GPU cloud' : target.blocked ? 'Instance action in progress' : `${label} · ${target.instance.gpu} #${target.instance.id}${resume ? ' · resumes paid compute' : ' · retains disk; storage stays billed'}`;
  const execute = async (id: number, action: 'start' | 'stop') => {
    if (locked.current) return;
    locked.current = true; setPending('checking'); setConfirmation(null);
    const notice = `gpu-power:${crypto.randomUUID()}`;
    toast.loading('Checking GPU status', { id: notice });
    try {
      const fresh = await api<CloudState>('/cloud/refresh', {}); setCloud(fresh);
      if (fresh.error) throw new Error(fresh.error);
      const current = gpuPowerTarget(fresh);
      if (!current || current.instance.id !== id || current.action !== action || current.blocked) throw new Error('Instance status changed. Review the current GPU before trying again.');
      setPending(action);
      toast.loading(action === 'stop' ? 'Pausing GPU' : 'Resuming GPU', { id: notice, description: `${current.instance.gpu} · #${id}` });
      // Existing managed instance only. This never creates another rental.
      await api(`/cloud/instances/${id}/${action}`, {});
      toast.dismiss(notice);
      // The stop endpoint confirms provider shutdown; start acknowledges setup,
      // and the existing connection tracker announces actual engine readiness.
      void browserAlerts.notify({ id: notice, category: 'connection', tone: 'success', title: action === 'stop' ? 'GPU paused' : 'GPU resume started', body: action === 'stop' ? 'Compute stop confirmed. Your disk is kept; storage remains billed.' : 'Resuming your existing rental. You’ll be notified when the engine connects.', target: { view: 'gpu' } });
    } catch (error) {
      toast.dismiss(notice);
      void browserAlerts.notify({ id: notice, category: 'connection', tone: 'error', title: 'GPU action needs attention', body: (error as Error).message, target: { view: 'gpu' } });
    } finally {
      // Read the server snapshot even after a lost response. Never auto-retry a
      // paid action or mistake a failed status read for a successful stop.
      try { setCloud(await api<CloudState>('/cloud')); } catch { /* Existing SSE remains authoritative. */ }
      locked.current = false; setPending(null);
    }
  };
  return <>
    <span className="gpu-power-wrap" title={title}><button type="button" className={`gpu-power-button${resume ? ' is-paused' : ''}`} disabled={disabled} aria-label={label} aria-busy={!!pending} onClick={() => {
      if (!target?.action || disabled) return;
      if (target.action === 'stop' && activeWork) setConfirmation(target.instance.id);
      else void execute(target.instance.id, target.action);
    }}>{pending||transition ? <CircleNotch size={18} className="gpu-power-spin" /> : resume ? <Play size={17} weight="fill" /> : <Pause size={18} weight="fill" />}</button></span>
    <Modal open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }} title="Pause GPU and interrupt active work?" description="A generation or model download is active. Pausing stops compute and interrupts it. Completed local outputs and the remote disk are kept; storage remains billed.">
      <div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmation(null)}>Keep running</button><button className="danger-button" onClick={() => { if (confirmation !== null) void execute(confirmation, 'stop'); }}><Pause size={15} />Pause GPU</button><button className="secondary-button" onClick={() => { setConfirmation(null); browse(); }}>View activity</button></div>
    </Modal>
  </>;
}
