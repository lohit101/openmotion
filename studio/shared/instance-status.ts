import type { CloudInstance, CloudLaunch } from './cloud';

export const setupPhases = ['checking', 'requesting', 'waiting', 'installing', 'connecting'];
export function instancePresentation(instance: CloudInstance, launch?: CloudLaunch) {
  const stopped = instance.computeStopped ?? (instance.state === 'stopped' || (instance.state === 'exited' && instance.intendedState === 'stopped'));
  const ending = launch?.phase === 'stopping' || launch?.phase === 'destroying';
  const preparing = !stopped && !ending && !launch?.needsReconnect && !['failed', 'unknown', 'destroyed', 'stopped'].includes(launch?.phase || '') && (setupPhases.includes(launch?.phase || '') || ['loading', 'creating', 'created', 'starting'].includes(instance.state));
  const failed = !!launch?.failureCode && ['failed', 'stopped', 'unknown'].includes(launch.phase);
  const connected = instance.connected && !stopped && !ending && !preparing && !failed && !launch?.needsReconnect;
  const label = ending ? launch?.phase === 'destroying' ? 'Deleting instance' : 'Pausing compute'
    : stopped ? failed ? 'Paused after error' : 'Paused'
    : connected ? 'Connected'
    : launch?.needsReconnect ? 'Reconnect setup'
    : preparing ? launch?.phase === 'installing' ? 'Installing engine' : launch?.phase === 'connecting' ? 'Connecting' : 'Starting container'
    : failed ? 'Needs attention' : instance.state === 'running' ? 'Ready to connect' : 'Status unavailable';
  const tone = failed ? 'error' : connected ? 'connected' : preparing || ending ? 'pending' : launch?.needsReconnect || instance.state === 'running' && !stopped ? 'warning' : 'neutral';
  const quoted = launch?.approvedHourly ?? launch?.offer.totalHourly ?? null;
  const reported = instance.totalHourly;
  const providerHasCompute = reported !== null && (instance.storageHourly === null || reported > instance.storageHourly + 0.000001);
  const useQuote = !stopped && quoted !== null && (!providerHasCompute || reported === null);
  const hourly = stopped ? instance.storageHourly : useQuote ? quoted : reported;
  const diskUsed = instance.diskUsed !== null && Number.isFinite(instance.diskUsed) && instance.diskUsed >= 0 ? instance.diskUsed : null;
  return { stopped, ending, preparing, failed, connected, label, tone, hourly, useQuote, diskUsed };
}

export function setupDescription(launch: CloudLaunch) {
  if (launch.autoCleanup) return launch.message;
  if (launch.phase === 'waiting' && launch.hostWatch) return 'The host has not reported a container or assigned direct ports. Remotion is checking reachability; five minutes of confirmed silence removes this empty rental automatically.';
  if (launch.needsReconnect) return 'Reconnect to follow the existing setup. Downloaded files stay on this instance.';
  if (launch.phase === 'checking' || launch.phase === 'requesting') return 'Checking the offer and creating your rental.';
  if (launch.phase === 'waiting') return 'Vast is downloading and unpacking the container image. Workflow installation starts when the container is ready.';
  if (launch.phase === 'installing') return 'Installing ComfyUI and its runtime. Model weights stay on demand; existing files are retained.';
  if (launch.phase === 'connecting') return 'Checking ComfyUI and opening your connection to the GPU.';
  if (launch.phase === 'ready') return 'The ComfyUI engine is online. Prepare only the model files required by your selected settings.';
  return launch.message;
}

export function setupElapsed(launch: CloudLaunch, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(launch.setupStartedAt || launch.createdAt)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}
