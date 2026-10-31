import type { CloudState } from './cloud';
import { instancePresentation } from './instance-status';

/** Never guess between rentals, or start a rental whose provider state is unknown. */
export function gpuPowerTarget(cloud: CloudState) {
  const instances = cloud.instances.filter(instance => instance.managed && !['destroyed', 'deleted'].includes(instance.state));
  const connected = instances.filter(instance => instance.connected);
  const selected=instances.find(instance=>instance.id===cloud.selectedInstanceId);
  const instance = connected.length === 1 ? connected[0] : connected.length>1?null:selected || (instances.length === 1 ? instances[0] : null);
  if (!instance) return null;
  const launch = cloud.launches.find(item => item.instanceId === instance.id);
  if (!launch || launch.phase === 'destroyed') return null;
  const view = instancePresentation(instance, launch);
  const action: 'start' | 'stop' | null = view.stopped ? 'start' : ['running', 'loading', 'creating', 'created', 'starting'].includes(instance.state) ? 'stop' : null;
  const starting=action==='start'&&cloud.busy&&['checking','requesting','waiting','installing','connecting'].includes(launch.phase)&&!launch.needsReconnect;
  return { instance, action,view,starting, blocked: view.ending || (action === 'start' && cloud.busy) };
}
