import type { Express } from 'express';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { command, poster, videoFrameInfo } from './media';
import { publicJob, type Store } from './store';
import type { GpuFaceBackend } from './gpu-video-identity';

const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const receiptSchema = z.object({
  complete: z.literal(true), execution: z.enum(['local CPU','remote CUDA']), newPaidInference: z.boolean(), model: z.literal('hyperswap_1a_256'),
  inputs: z.object({ version: z.literal('face-finish-v1'), profile: sha, baseProfile: sha, parentSHA256: sha, referenceSHA256: sha,
    width: z.number().int().positive(), height: z.number().int().positive(), frames: z.number().int().positive(), fps: z.string(), provider:z.literal('cuda').optional(),gpuProfile:sha.optional() }),
  framesVerified:z.boolean().optional(),gpu:z.string().optional(),sessionProviders:z.record(z.string(),z.array(z.string())).optional(),
  outputSHA256: sha, elapsedSeconds: z.number().finite().nonnegative(), refinedFrames: z.number().int().nonnegative(), skippedFrames: z.number().int().nonnegative(),
  records: z.array(z.object({ frame: z.number().int().nonnegative(), action: z.enum(['refined','preserved']), sha256: sha, protectedPixelsExact: z.boolean().optional() })),
});
export interface FaceToolsStatus { ready: boolean; missing: string[]; bytes: number; readyBytes: number; setup: string; license: string; }
type Progress = (frame: number, frames: number) => void;
type Execute = (args: { reference: string; target: string; folder: string }, signal: AbortSignal, progress: Progress) => Promise<void>;

/** A separate refinement queue. Optional CUDA backend cannot rent or resume compute. */
export class VideoIdentity {
  private active: string | null = null;
  private abort: AbortController | null = null;
  private task: Promise<void> | null = null;
  private closing = false;
  private gpuPreparing = false;
  constructor(public store: Store, public repo: string, private execute: Execute = (args, signal, progress) => this.process(args, signal, progress),
    private inspect: () => Promise<FaceToolsStatus> = () => this.inspectTools(), private gpu?: GpuFaceBackend) {
    for (const job of store.jobs()) if (job.faceRefinement && ['queued','running','reconnecting'].includes(job.status)) {
      job.status='interrupted'; job.error=job.faceRefinement.execution==='remote CUDA'?'GPU face refinement was interrupted. Reconnect the same instance to check its worker and saved frames before resuming.':'Local face refinement was interrupted. Resume on this computer; saved frames and the original video are kept. No GPU is required.';
      store.saveJob(job);
    }
  }
  get busy() { return !!this.active; }
  get gpuBusy() { return this.gpuPreparing || this.store.jobs().some(job=>job.faceRefinement?.execution==='remote CUDA' && ['queued','running','reconnecting'].includes(job.status)); }
  async status() { return this.inspect(); }
  async gpuStatus() { return {...await this.gpu?.status(),preparing:this.gpuPreparing}; }
  async setupGpu() {
    if (!this.gpu) throw new Error('GPU face backend is unavailable.');
    if(this.gpuBusy)throw new Error('GPU face setup or refinement is already active.');
    this.gpu.assertIdle();this.gpuPreparing=true;
    try{await this.gpu.setup();return await this.gpuStatus();}finally{this.gpuPreparing=false;}
  }
  private async inspectTools(): Promise<FaceToolsStatus> {
    return JSON.parse(await command('python3',[path.join(this.repo,'scripts/video_identity.py'),'status'],undefined,15000));
  }
  async create(parentId: string, referenceId?: string, execution: 'local CPU'|'remote CUDA'='local CPU') {
    const parent=this.store.job(parentId), reference=this.store.asset(referenceId || parent?.referenceId || '');
    if (!parent || parent.status!=='completed' || !parent.output || parent.deleted || parent.mediaType==='image' || parent.edit || parent.faceRefinement) throw new Error('Choose an original completed character video to refine. Its original stays unchanged.');
    if (!reference || reference.kind!=='image') throw new Error('Choose a saved character image with one clear face.');
    const gpu=execution==='remote CUDA';
    const key=`face-finish-v1:${parent.id}:${reference.id}${gpu?':cuda':''}`, existing=this.store.byKey(key);
    if (existing) return existing;
    if(gpu && (!this.gpu || this.gpuBusy))throw new Error('Wait for the GPU face operation to finish.');
    if(gpu)this.gpu!.assertIdle();
    const tools=gpu?await this.gpu!.status():await this.status(); if (!tools.ready) throw new Error(gpu?'Click Prepare GPU refinement first. No model was downloaded and no GPU worker was submitted.':'Local face refinement needs a one-time setup on this computer: '+tools.setup+'. Nothing was downloaded or sent to a GPU.');
    const instanceId=gpu?this.gpu!.instance():undefined;
    if (!existsSync(parent.output)) throw new Error('The original saved video is unavailable.');
    const info=await videoFrameInfo(parent.output), frames=info.frames;
    if (!Number.isSafeInteger(frames) || frames<1 || frames>720) throw new Error('Face refinement currently supports saved clips up to 720 frames.');
    const [width,height]=outputDimensions(parent), space=await statfs(this.store.root);
    if (space.bavail*space.bsize < (gpu?1024**3:frames*width*height*3*1.2 + 1024**3)) throw new Error('Free local storage for face refinement. No GPU job was submitted.');
    // Recheck after async preflight so a double click cannot create two workers.
    const duplicate=this.store.byKey(key); if (duplicate) return duplicate;
    if(gpu){this.gpu!.assertIdle();if(this.gpuBusy)throw new Error('Another GPU face operation started. Try after it finishes.');}
    const id=randomUUID(), now=new Date().toISOString();
    const job: Job={...structuredClone(parent),id,title:(parent.title.slice(0,90)+' / face refinement'),status:'queued',createdAt:now,startedAt:undefined,finishedAt:undefined,
      origin:'import',favorite:false,deleted:false,workflow:null,hasWorkflow:false,segments:[],timings:[],context:'',uploads:null,pendingPrompt:null,output:null,poster:null,keyframe:undefined,
      error:null,cancelRequested:false,cancellationConfirmed:undefined,submitting:false,retryRequired:false,elapsedSeconds:null,framingCheck:undefined,videoRecovery:undefined,continuationSource:undefined,
      faceRefinement:{version:'face-finish-v1',parentJobId:parent.id,referenceAssetId:reference.id,execution,...(instanceId?{instanceId}:{})},referenceId:reference.id,
      progress:{stage:'Queued for local face refinement',node:null,value:0,max:frames,unit:'frames',segment:1,segments:1,completedFrames:0,targetFrames:frames,updatedAt:Date.now()}};
    this.store.addJob(job,key);void this.kick();return this.store.job(id)!;
  }
  async resume(job: Job) {
    if (!job.faceRefinement || !['interrupted','failed','cancelled'].includes(job.status)) throw new Error('Choose an interrupted local face refinement.');
    if(job.faceRefinement.execution==='remote CUDA'){
      const work=path.join(this.store.root,'jobs',job.id,'face-refinement');
      if(['identity-video.json','final.mp4','gpu-transport.json'].every(name=>existsSync(path.join(work,name)))){
        const saved=JSON.parse(await readFile(path.join(work,'identity-video.json'),'utf8'));
        const parent=this.store.job(job.faceRefinement.parentJobId);
        if(saved.complete && parent?.output && saved.inputs?.parentSHA256===hash(parent.output) && saved.outputSHA256===hash(path.join(work,'final.mp4'))){job.cancelRequested=false;job.cancellationConfirmed=undefined;this.store.saveJob(job,false);await this.finish(job,work);return;}
      }
      if(!this.gpu || this.gpuBusy)throw new Error('Wait for GPU face setup or refinement.');
      this.gpu.assertIdle();if(this.gpu.instance()!==job.faceRefinement.instanceId)throw new Error('Reconnect the same GPU instance to resume its saved refinement frames.');
    }
    job.status='queued';job.error=null;job.cancelRequested=false;job.cancellationConfirmed=undefined;this.store.saveJob(job,false);void this.kick();
  }
  async cancel(job: Job) {
    job.cancelRequested=true;this.store.saveJob(job,false);
    if (this.active===job.id) {this.abort?.abort();await this.task;}
    else {job.status='cancelled';job.cancellationConfirmed=true;job.progress.stage='Local refinement cancelled';this.store.saveJob(job,false);}
  }
  private async kick() {
    if (this.active || this.closing) return;
    const job=this.store.jobs().reverse().find(item=>item.faceRefinement && item.status==='queued' && !item.deleted);
    if (!job) return;
    this.active=job.id;this.abort=new AbortController();const signal=this.abort.signal;
    this.task=this.run(job,signal);
    try {await this.task;} finally {this.active=null;this.abort=null;this.task=null;if(!this.closing)void this.kick();}
  }
  private async run(job: Job, signal: AbortSignal) {
    const parent=this.store.job(job.faceRefinement!.parentJobId), reference=this.store.asset(job.faceRefinement!.referenceAssetId);
    try {
      if (!parent?.output || !reference) throw new Error('The saved parent video or character reference is missing.');
      job.status='running';job.startedAt ||=new Date().toISOString();job.progress.stage=job.faceRefinement!.execution==='remote CUDA'?'Transferring inputs and preparing GPU facial refinement':'Preparing local facial refinement';this.store.saveJob(job);
      const folder=path.join(this.store.root,'jobs',job.id), work=path.join(folder,'face-refinement');await mkdir(folder,{recursive:true});
      const gpu=job.faceRefinement!.execution==='remote CUDA';
      const execute=gpu?(args:Parameters<Execute>[0],signal:AbortSignal,progress:Progress)=>this.gpu!.run({...args,jobId:job.id,instanceId:job.faceRefinement!.instanceId!},signal,progress):this.execute;
      await execute({reference:reference.path,target:parent.output,folder:work},signal,(frame,frames)=>{
        if (!Number.isInteger(frame) || !Number.isInteger(frames) || frames!==job.progress.targetFrames || frame<0 || frame>frames) return;
        job.progress={...job.progress,stage:frame===frames?'Verifying refined video':gpu?'Refining facial identity on GPU':'Refining facial identity locally',value:frame,max:frames,completedFrames:frame,updatedAt:Date.now()};this.store.saveJob(job);
      });
      signal.throwIfAborted();await this.finish(job,work,signal);
    } catch (error) {
      const cancelled=this.store.job(job.id)?.cancelRequested && (job.faceRefinement?.execution!=='remote CUDA' || (error as Error & {cancellationConfirmed?:boolean}).cancellationConfirmed);
      job.status=cancelled?'cancelled':'interrupted';job.cancellationConfirmed=!!cancelled;
      job.error=cancelled?null:String((error as Error).message).slice(0,1800);job.progress.stage=cancelled?'Local refinement cancelled':'Local refinement needs attention';
      const latest=this.store.job(job.id)!;Object.assign(job,{title:latest.title,favorite:latest.favorite,deleted:latest.deleted,cancelRequested:latest.cancelRequested,cancellationConfirmed:!!cancelled});this.store.saveJob(job,false);
    }
  }
  /** Import only verified local output; never changes or re-renders its parent. */
  async finish(job: Job, work: string, signal?: AbortSignal) {
    const parent=this.store.job(job.faceRefinement!.parentJobId), reference=this.store.asset(job.faceRefinement!.referenceAssetId);
    if (!parent?.output || !reference) throw new Error('The original refinement inputs are missing.');
    const r=receiptSchema.parse(JSON.parse(await readFile(path.join(work,'identity-video.json'),'utf8'))), file=path.join(work,'final.mp4');
    const gpu=job.faceRefinement!.execution==='remote CUDA';
    if(r.execution!==job.faceRefinement!.execution || r.newPaidInference!==gpu)throw new Error('Refinement execution provenance does not match this job.');
    if(gpu){
      const transport=JSON.parse(await readFile(path.join(work,'gpu-transport.json'),'utf8'));
      if(r.inputs.provider!=='cuda' || r.inputs.gpuProfile!==hash(path.join(this.repo,'config/gpu-video-identity.lock.json')) || !r.framesVerified || transport.instanceId!==job.faceRefinement!.instanceId || transport.jobId!==job.id || transport.receiptSHA256!==hash(path.join(work,'identity-video.json')) || !r.sessionProviders?.['hyperswap_1a_256.onnx']?.includes('CUDAExecutionProvider'))throw new Error('GPU face receipt or CUDA provider verification failed.');
    }
    const [width,height]=outputDimensions(parent);
    const [n,d=1]=r.inputs.fps.split('/').map(Number);
    if (!Number.isFinite(n/d) || Math.abs(n/d-parent.settings.fps)>.00001) throw new Error('Face refinement frame rate does not match its original video.');
    if (r.inputs.profile!==hash(path.join(this.repo,'config/local-video-identity.lock.json')) || r.inputs.baseProfile!==hash(path.join(this.repo,'config/local-identity.lock.json')) ||
        r.inputs.parentSHA256!==hash(parent.output) || r.inputs.referenceSHA256!==hash(reference.path) || r.outputSHA256!==hash(file)) throw new Error('Face refinement receipt does not match the immutable inputs or output.');
    if (r.inputs.width!==width || r.inputs.height!==height || r.inputs.frames!==job.progress.targetFrames || r.refinedFrames+r.skippedFrames!==r.inputs.frames || r.records.length!==r.inputs.frames ||
        r.records.filter(item=>item.action==='refined').length!==r.refinedFrames || r.records.some((item,index)=>item.frame!==index || item.action==='refined' && !item.protectedPixelsExact)) throw new Error('Face refinement frame coverage is inconsistent. No missing frames were invented.');
    if(!gpu)for (const record of r.records) if(hash(path.join(work,`frame-${String(record.frame).padStart(6,'0')}.png`))!==record.sha256) throw new Error('A saved facial refinement frame changed after processing.');
    const info=await videoFrameInfo(file);
    if(info.frames!==r.inputs.frames || Math.abs(info.start)>.001 || Math.abs(info.duration-r.inputs.frames/parent.settings.fps)>.01) throw new Error('Face refinement changed the original duration or decoded frame count.');
    const folder=path.join(this.store.root,'jobs',job.id);await mkdir(folder,{recursive:true});
    const source=path.join(this.store.root,'jobs',parent.id,'prepared-source.mp4');if(existsSync(source) && !existsSync(path.join(folder,'prepared-source.mp4')))await copyFile(source,path.join(folder,'prepared-source.mp4'));
    const thumb=path.join(folder,'poster.jpg');await poster(file,thumb);
    signal?.throwIfAborted();
    job.faceRefinement={...job.faceRefinement!,...(gpu?{gpu:r.gpu}:{}),parentSHA256:r.inputs.parentSHA256,outputSHA256:r.outputSHA256,refinedFrames:r.refinedFrames,skippedFrames:r.skippedFrames};
    job.status='completed';job.finishedAt=new Date().toISOString();job.output=file;job.poster=thumb;job.elapsedSeconds=r.elapsedSeconds;job.error=null;
    job.progress={...job.progress,stage:r.skippedFrames?'Complete · review unmodified face frames':gpu?'GPU face refinement complete':'Local face refinement complete',value:r.inputs.frames,max:r.inputs.frames,completedFrames:r.inputs.frames,updatedAt:Date.now()};
    this.store.saveJob(job);
  }
  private process(args: {reference: string;target: string;folder: string},signal: AbortSignal,progress: Progress): Promise<void> {
    return new Promise((resolve,reject)=>{
      const python=path.join(this.repo,'.local/facefusion-venv/bin/python');
      const child=spawn(python,[path.join(this.repo,'scripts/video_identity.py'),'run','--reference',args.reference,'--target',args.target,'--output',args.folder],{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
      let buffer='',stderr='',last=0;
      const abort=()=>{try{if(process.platform!=='win32' && child.pid)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{/* Already exited. */}};
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop()!.slice(-200000);for(const line of lines){try{const value=JSON.parse(line);if(Date.now()-last>400 || value.frame===value.frames){progress(value.frame,value.frames);last=Date.now();}}catch{/* Only complete progress JSON changes state. */}}});
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});
      child.once('error',error=>{signal.removeEventListener('abort',abort);reject(error);});
      child.once('close',code=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(new Error('Local refinement interrupted; resumable frames kept.'));else if(code===0)resolve();else reject(new Error(stderr.trim() || `Local face refinement exited with code ${code}.`));});
    });
  }
  async shutdown(){this.closing=true;this.abort?.abort();await this.task;}
}

export function registerVideoIdentityRoutes(app: Express, store: Store, repo: string, gpu?:GpuFaceBackend) {
  const identity=new VideoIdentity(store,repo,undefined,undefined,gpu);
  app.get('/api/video-identity',async(_req,res)=>{
    const local=await identity.status();
    const gpu=await identity.gpuStatus().catch((error:Error)=>({ready:false,available:false,error:error.message}));
    res.json({...local,gpu});
  });
  app.post('/api/video-identity/gpu/setup',async(_req,res)=>res.json(await identity.setupGpu()));
  app.post('/api/jobs/:id/refine-face',async(req,res)=>{
    const value=z.object({referenceId:z.string().uuid().optional(),execution:z.enum(['local CPU','remote CUDA']).default('local CPU')}).parse(req.body || {});
    res.status(202).json(publicJob(await identity.create(z.string().uuid().parse(req.params.id),value.referenceId,value.execution)));
  });
  return identity;
}
