import type { CloudLaunch } from './cloud';

export function setupNotice(launch: CloudLaunch) {
  const attempt = launch.setupStartedAt || launch.createdAt;
  if (launch.autoCleanup) return { key: `${launch.id}:cleanup:${launch.autoCleanup.state}:${launch.autoCleanup.lastError || ''}`, tone: 'error' as const, title: launch.autoCleanup.state === 'confirmed' ? 'Failed host removed' : 'Removing failed host', message: launch.autoCleanup.state === 'confirmed' ? 'Rental and remote disk deletion confirmed. Choose another host; this machine is hidden for 24 hours.' : launch.autoCleanup.lastError ? launch.message : launch.autoCleanup.reason };
  if (['failed', 'stopping', 'stopped', 'unknown'].includes(launch.phase) && launch.failureCode) return { key: `${launch.id}:${attempt}:error:${launch.lastFailure || launch.message}`, tone: 'error' as const, title: launch.phase === 'unknown' ? 'Rental request unconfirmed' : 'GPU setup failed', message: launch.lastFailure || launch.message };
  if (launch.phase === 'ready') return { key: `${launch.id}:${attempt}:ready`, tone: 'success' as const, title: 'ComfyUI engine is online', message: 'Download the files for your selected settings, or reuse models already on this GPU.' };
  if (['checking', 'requesting', 'waiting', 'installing', 'connecting'].includes(launch.phase) && (launch.warning || launch.setupSlow || launch.needsReconnect)) return { key: `${launch.id}:${attempt}:warning:${launch.warning || 'slow'}`, tone: 'warning' as const, title: launch.needsReconnect ? 'Reconnect to follow setup' : launch.setupSlow ? 'Taking longer than usual' : 'Connection update', message: launch.warning?.replace(/^Taking longer than usual\.\s*/, '') || 'Setup is still running. Elapsed time will not stop this instance.' };
  return null;
}

export function activeDownloads(lines: string[]) {
  const active = new Map<string, number>();
  for (const line of lines) {
    const progress = line.match(/^\s+([^:]+\.safetensors):\s*(\d+)%\s*$/);
    const verified = line.match(/^Verified:\s+(.+)$/);
    const ready = line.match(/^Ready:\s+(?:.*\/)?([^/]+)$/);
    if (progress) active.set(progress[1], Math.min(100, Math.max(0, Number(progress[2]))));
    if (verified) active.delete(verified[1]);
    if (ready) active.delete(ready[1]);
  }
  return [...active].map(([name, percent]) => ({ name, percent, label: name.startsWith('wan2.1_14B_') ? 'Main video model' : name.startsWith('umt5_') ? 'Text encoder' : name.startsWith('clip_') ? 'Vision encoder' : name.startsWith('sam3.') ? 'Person tracker' : name.includes('relight') ? 'Relighting adapter' : name.includes('DPO') ? 'Detail adapter' : name.includes('lightx2v') ? 'Speed adapter' : name.startsWith('Wan2_1_VAE') ? 'Video decoder' : name }));
}
