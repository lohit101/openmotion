import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Store } from './store';
import type { ConnectionManager } from './comfy';
import type { FaceToolsStatus } from './video-identity';

export interface GpuFaceBackend {
  instance(): number;
  assertIdle(): void;
  status(): Promise<FaceToolsStatus & { instanceId?: number; available: boolean }>;
  setup(): Promise<void>;
  run(args: { reference: string; target: string; folder: string; jobId: string; instanceId: number }, signal: AbortSignal, progress: (frame: number, frames: number) => void): Promise<void>;
}

export function createGpuFaceBackend(store: Store, repo: string, connection: ConnectionManager, idle: () => void): GpuFaceBackend {
  const instance = () => {
    const id=store.value<number|null>('cloud-connected-instance',null);
    if (!id || connection.status.state!=='online' || connection.status.endpoint!=='http://127.0.0.1:8188') throw new Error('Connect your managed GPU first. Face refinement never starts or resumes compute automatically.');
    return id;
  };
  const command = (args: string[], signal?: AbortSignal, progress?: (frame: number, frames: number) => void) => new Promise<string>((resolve,reject)=>{
    const child=spawn('python3',['-u',path.join(repo,'scripts/managed_video_identity.py'),...args],{stdio:['ignore','pipe','pipe']});
    let stdout='',buffer='',stderr='';
    const abort=()=>{child.kill('SIGTERM');};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-200000);buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop() || '';for(const line of lines){try{const row=JSON.parse(line);if(Number.isInteger(row.frame)&&Number.isInteger(row.frames))progress?.(row.frame,row.frames);}catch{/* Status and installer output are not frame progress. */}}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    child.once('error',error=>{cleanup();reject(error);});
    child.once('close',code=>{cleanup();if(code===0 && !signal?.aborted)resolve(stdout);else {
      const error=new Error(stderr.trim() || 'GPU refinement interrupted. Saved remote frames are retained; reconnect the same instance before resuming.') as Error & { cancellationConfirmed?: boolean };
      error.cancellationConfirmed=stdout.includes('RECAST_FACE_CANCELLED');reject(error);
    }});
  });
  return {
    instance, assertIdle: idle,
    async status() {
      let id: number;try{id=instance();}catch{return {ready:false,available:false,missing:['Connected GPU'],bytes:1292800048,readyBytes:0,setup:'Prepare GPU refinement',license:'Private evaluation only; existing model terms apply.'};}
      const output=await command(['--instance-id',String(id),'--action','status']);
      const row=output.split('\n').find(line=>line.startsWith('RECAST_FACE '));if(!row)throw new Error('GPU face runtime returned no status.');
      if(instance()!==id)throw new Error('The connected GPU changed during the face-runtime check.');
      return {...JSON.parse(row.slice(12)),available:true,instanceId:id,setup:'Prepare GPU refinement'};
    },
    async setup(){idle();const id=instance();await command(['--instance-id',String(id),'--action','setup']);if(instance()!==id)throw new Error('GPU changed during setup. Refresh availability before refining.');},
    async run(args,signal,progress){idle();if(instance()!==args.instanceId)throw new Error('Reconnect the original GPU instance to resume its face frames.');await command(['--instance-id',String(args.instanceId),'--action','run','--job',args.jobId,'--reference',args.reference,'--target',args.target,'--output',args.folder],signal,progress);},
  };
}
