import type { CloudState } from './cloud';
import { instancePresentation } from './instance-status';

/** Never guess between rentals, or start a rental whose provider state is unknown. */
export function gpuPowerTarget(cloud: CloudState) {
  const instances = cloud.instances.filter(instance => instance.managed && !['destroyed', 'deleted'].includes(instance.state));
  const connected = instances.filter(instance => instance.connected);
  const instance = connected.length === 1 ? connected[0] : instances.length === 1 ? instances[0] : null;
  if (!instance) return null;
  const launch = cloud.launches.find(item => item.instanceId === instance.id);
  if (!launch || launch.phase === 'destroyed') return null;
  const view = instancePresentation(instance, launch);
  const action: 'start' | 'stop' | null = view.stopped ? 'start' : ['running', 'loading', 'creating', 'created', 'starting'].includes(instance.state) ? 'stop' : null;
  return { instance, action, blocked: view.ending || (action === 'start' && cloud.busy) };
}
