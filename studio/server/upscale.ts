import type { Express } from 'express';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { defaults, type Job, type Settings } from '../shared/types';
import { upscaleGeometry, upscaleRequestSchema, type UpscaleRun, type UpscaleTools } from '../shared/upscale';
import type { ConnectionManager } from './comfy';
import { poster, command } from './media';
import { publicJob, type Store } from './store';
import type { ClipEditor } from './clip-editor';

const active = ['queued','running','reconnecting'];
export const clarityFingerprint = (repo: string) => {
  const h=createHash('sha256');
  for(const name of ['config/upscale-runtime.lock.json','config/upscale-models.lock.json','scripts/upscale_worker.py','scripts/clarity_video.py']) h.update(readFileSync(path.join(repo,name)));
  return h.digest('hex');
};
async function fileHash(file: string) { const h=createHash('sha256'); for await(const part of createReadStream(file))h.update(part);return h.digest('hex'); }
async function exactVideoInfo(repo:string,file:string,source=false){
  return JSON.parse(await command('python3',['-c',`import sys,json;sys.path.insert(0,sys.argv[1]);from upscale_worker import ${source?'validate_source':'info'} as check;print(json.dumps(check(sys.argv[2])))`,path.join(repo,'scripts'),file],undefined,120000));
}
interface WorkerError extends Error { remoteStopped?: boolean; }
export type UpscaleCommand = (repo: string,args: string[],signal?: AbortSignal,progress?: (value:number,stage:string,frames?:number)=>void)=>Promise<string>;
export const upscaleCommand: UpscaleCommand = (repo,args,signal,progress)=>new Promise((resolve,reject)=>{
  const child=spawn('python3',['-u',path.join(repo,'scripts/managed_upscale.py'),...args],{stdio:['ignore','pipe','pipe']});
  let output='',errors='',buffer='';const abort=()=>{child.kill('SIGTERM');};signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-100000);buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines)try{const v=JSON.parse(line);if(Number.isFinite(v.progress)&&typeof v.stage==='string')progress?.(v.progress,v.stage,Number.isSafeInteger(v.frames)?v.frames:undefined);}catch{/* Package/status output is not progress. */}});
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-10000);});
  const clean=()=>signal?.removeEventListener('abort',abort);
  child.once('error',error=>{clean();reject(error);});
  child.once('close',code=>{clean();if(code===0&&!signal?.aborted)resolve(output);else{const error=new Error(errors.trim()||'Clarity interrupted. Original video and saved remote output are kept.')as WorkerError;error.remoteStopped=output.includes('RECAST_UPSCALE_STOPPED');reject(error);}});
  if(signal?.aborted)abort();
});

export class UpscaleManager {
  private starting=false; private setupPending:number|null; private remotePending:number|null; private task:Promise<void>|null=null;private controller:AbortController|null=null;private activeId:string|null=null;
  private statusWork:Promise<UpscaleTools>|null=null;
  constructor(private store:Store,private repo:string,private connection:ConnectionManager,private sources:ClipEditor,private assertIdle:()=>void,private execute:UpscaleCommand=upscaleCommand){
    this.setupPending=store.value<number|null>('clarity-setup-pending',null);
    this.remotePending=store.value<number|null>('clarity-remote-pending',null);
    for(const job of store.jobs())if(job.upscale&&active.includes(job.status)){job.status='interrupted';job.error='Clarity was interrupted. Recover checks its saved output without restarting inference.';store.saveJob(job);}
  }
  get busy(){return this.starting||!!this.task||!!this.setupPending||!!this.remotePending||this.store.jobs().some(j=>j.upscale&&(active.includes(j.status)||j.upscale.remoteActive&&j.upscale.instanceId===this.store.value('cloud-connected-instance',null)));}
  observeProviderStop(id:number,confirmedAt:number){
    if(!Number.isFinite(confirmedAt))return;
    if(this.setupPending===id&&confirmedAt>=this.store.value<number>('clarity-setup-started',Infinity)){this.setupPending=null;this.store.set('clarity-setup-pending',null);}
    if(this.remotePending===id&&confirmedAt>=this.store.value<number>('clarity-remote-started',Infinity)){this.remotePending=null;this.store.set('clarity-remote-pending',null);}
    for(const job of this.store.jobs())if(job.upscale?.instanceId===id&&job.upscale.remoteActive&&confirmedAt>=Date.parse(job.startedAt||job.createdAt)){
      if(this.activeId===job.id)this.controller?.abort();
      job.upscale.remoteActive=false;job.upscale.cancellationConfirmed=true;
      if(active.includes(job.status)){job.status='interrupted';job.error='The provider confirmed compute stopped. Saved inputs and outputs are kept; check the original attempt before retrying.';}
      this.store.saveJob(job);
    }
  }
  private instance(){const id=this.store.value<number|null>('cloud-connected-instance',null);if(!id||this.connection.status.state!=='online'||this.connection.status.endpoint!=='http://127.0.0.1:8188')throw new Error('Connect the managed GPU. Clarity never starts or resumes compute.');return id;}
  private args(id:number,action:string){return ['--instance-id',String(id),'--action',action];}
  async status():Promise<UpscaleTools>{
    if(this.statusWork)return this.statusWork;
    this.statusWork=(async()=>{
      let id:number;try{id=this.instance();}catch{return {ready:false,available:false,preparing:!!this.setupPending,missing:['Connected GPU'],modelBytes:7016472997,runtimeReserveBytes:10737418240};}
      const text=await this.execute(this.repo,this.args(id,'status'));if(this.instance()!==id)throw new Error('GPU changed during the Clarity check.');
      const line=text.split('\n').find(v=>v.startsWith('RECAST_UPSCALE '));if(!line)throw new Error('Clarity returned no tool status.');
      const value=JSON.parse(line.slice(15));
      if(value.preparing===false&&this.setupPending===id){this.setupPending=null;this.store.set('clarity-setup-pending',null);}
      const owned=Array.isArray(value.activeJobs)&&value.activeJobs.length>0&&value.activeJobs.every((jobId:string)=>this.store.job(jobId)?.upscale?.instanceId===id);
      if(value.processing===true&&!owned){if(this.remotePending!==id)this.store.set('clarity-remote-started',Date.now());this.remotePending=id;this.store.set('clarity-remote-pending',id);}
      else if(value.processing===false&&this.remotePending===id){this.remotePending=null;this.store.set('clarity-remote-pending',null);}
      return {...value,available:true,instanceId:id,ready:value.ready===true&&value.profileSHA256===clarityFingerprint(this.repo)};
    })().finally(()=>{this.statusWork=null;});return this.statusWork;
  }
  async prepare(){
    if(this.busy)throw new Error('Finish or check existing Clarity work first.');this.assertIdle();const id=this.instance();
    this.setupPending=id;this.store.set('clarity-setup-pending',id);this.store.set('clarity-setup-started',Date.now());
    try{await this.execute(this.repo,this.args(id,'prepare'));this.setupPending=null;this.store.set('clarity-setup-pending',null);return await this.status();}
    catch(error){try{await this.status();}catch{/* An unknown setup stays busy until checked on this same host. */}throw error;}
  }
  async create(input:unknown){
    const request=upscaleRequestSchema.parse(input),key='clarity:'+request.requestKey,previous=this.store.byKey(key);
    if(previous){if(JSON.stringify(previous.upscale?.source)!==JSON.stringify(request.source)||JSON.stringify(previous.upscale?.settings)!==JSON.stringify(request.settings))throw new Error('This request key was already used for different inputs.');return previous;}
    if(this.busy)throw new Error('Finish or check the existing upscale first.');this.assertIdle();const instance=this.instance();this.starting=true;
    try{
      const tools=await this.status();if(tools.preparing||tools.processing)throw new Error('Finish or check the existing Clarity work on this GPU first.');
      if(!tools.ready)throw new Error('Download Clarity’s three files and prepare its runtime first. Generate starts no downloads.');
      const source=await this.sources.source(request.source.assetId?'asset:'+request.source.assetId:request.source.jobId!);
      if(source.meta.duration>300)throw new Error('Clarity supports videos up to five minutes.');
      if(['smpte2084','arib-std-b67'].includes(source.meta.colorTransfer))throw new Error('Convert HDR footage to SDR before using Clarity.');
      const geometry=upscaleGeometry(source.meta.width,source.meta.height,request.settings.height),hash=await fileHash(source.file);
      this.assertIdle();if(this.instance()!==instance)throw new Error('GPU changed while checking the source. Nothing was queued.');
      const id=randomUUID(),folder=path.join(this.store.root,'jobs',id);await mkdir(folder,{recursive:true});
      const profile=clarityFingerprint(this.repo),fps=String(source.meta.fps),createdAt=new Date().toISOString();
      // Read exact rational timing using the same validator as the managed worker.
      const timing=await exactVideoInfo(this.repo,source.file,true);
      if(timing.width!==source.meta.width||timing.height!==source.meta.height||timing.frames!==source.meta.frames)throw new Error('Source geometry or timing changed while checking. Nothing was queued.');
      this.assertIdle();if(this.instance()!==instance)throw new Error('GPU changed during source validation.');
      const run:UpscaleRun={version:'clarity-flashvsr-turbo-v1',model:'FlashVSR+ Turbo',settings:request.settings,source:request.source,sourceTitle:source.meta.title,sourceSHA256:hash,
        sourceWidth:timing.width,sourceHeight:timing.height,instanceId:instance,profileSHA256:profile,fps:timing.fps||fps,frames:timing.frames,...geometry,remoteActive:false,progress:0,stage:'Preparing upscale'};
      const sourceId=request.source.assetId||randomUUID();
      if(!request.source.assetId){const file=await stat(source.file);this.store.addAsset({id:sourceId,kind:'video',name:source.meta.title,path:source.file,poster:this.store.job(request.source.jobId!)?.poster||'',width:timing.width,height:timing.height,fps:source.meta.fps,duration:source.meta.duration,hasAudio:source.meta.hasAudio,size:file.size,createdAt});}
      const job:Job={id,title:`${source.meta.title.replace(/\.[^.]+$/,'')} · Clarity ${request.settings.height}p`,status:'running',sourceId,referenceId:'',createdAt,startedAt:createdAt,favorite:false,deleted:false,origin:'upscale',upscale:run,
        settings:{...defaults,fps:source.meta.fps as Settings['fps'],seconds:source.meta.duration},width:geometry.outputWidth,height:geometry.outputHeight,progress:{stage:'Preparing upscale',node:null,value:0,max:timing.frames,unit:'frames',segment:1,segments:1,completedFrames:0,targetFrames:timing.frames,updatedAt:Date.now()},
        segments:[],context:'',pendingPrompt:null,uploads:null,error:null,output:null,poster:null,cancelRequested:false,elapsedSeconds:null,workflow:null};
      const frozen={jobId:id,profileSHA256:profile,sourceSHA256:hash,input:timing,geometry,settings:request.settings};
      await writeFile(path.join(folder,'upscale-request.json'),JSON.stringify(frozen));this.store.addJob(job,key);
      this.start(job,source.file,false);return job;
    }finally{this.starting=false;}
  }
  private start(job:Job,file:string|undefined,recover:boolean){
    this.controller=new AbortController();this.activeId=job.id;const signal=this.controller.signal;
    this.task=this.process(job,file,recover,signal).finally(()=>{this.task=null;this.controller=null;this.activeId=null;});
  }
  private async process(job:Job,file:string|undefined,recover:boolean,signal:AbortSignal){
    const u=job.upscale!,folder=path.join(this.store.root,'jobs',job.id),dest=path.join(folder,'upscale');
    try{
      let local=false;try{await stat(path.join(dest,'receipt.json'));await stat(path.join(dest,'final.mp4'));await stat(path.join(dest,'transport.json'));local=true;}catch{/* Check original rental below. */}
      if(!local){
        if(this.instance()!==u.instanceId)throw new Error('Reconnect the original GPU to recover this upscale.');
        u.remoteActive=true;job.status='running';this.store.saveJob(job);
        await this.execute(this.repo,[...this.args(u.instanceId,recover?'recover':'run'),'--job',job.id,'--request',path.join(folder,'upscale-request.json'),'--output',dest,...(file?['--source',file]:[])],signal,(value,stage,frames)=>{
          if(signal.aborted)return;
          u.progress=Math.max(u.progress,Math.min(99,Math.max(0,value)));u.stage=stage;Object.assign(job.progress,{stage,...(frames===undefined?{}:{value:Math.min(u.frames,Math.max(job.progress.value||0,frames))}),updatedAt:Date.now()});this.store.saveJob(job);
        });u.remoteActive=false;
      }
      const receipt=JSON.parse(await readFile(path.join(dest,'receipt.json'),'utf8')),transport=JSON.parse(await readFile(path.join(dest,'transport.json'),'utf8'));
      const frozen=JSON.parse(await readFile(path.join(folder,'upscale-request.json'),'utf8')),output=path.join(dest,'final.mp4');
      const actual=await exactVideoInfo(this.repo,output);
      if(!receipt.complete||JSON.stringify(receipt.request)!==JSON.stringify(frozen)||receipt.request.profileSHA256!==u.profileSHA256||receipt.request.sourceSHA256!==u.sourceSHA256||
        transport.jobId!==job.id||transport.instanceId!==u.instanceId||transport.receiptSHA256!==await fileHash(path.join(dest,'receipt.json'))||receipt.outputSHA256!==await fileHash(output)||
        actual.frames!==u.frames||actual.fps!==u.fps||actual.width!==u.outputWidth||actual.height!==u.outputHeight||receipt.frames!==u.frames||receipt.fps!==u.fps||receipt.width!==u.outputWidth||receipt.height!==u.outputHeight||!receipt.audioPreserved||!receipt.framingPreserved||receipt.attention!=='sdpa')throw new Error('Upscale provenance or timing validation failed. Existing files were preserved.');
      job.output=output;job.poster=path.join(folder,'poster.jpg');await poster(output,job.poster);job.status='completed';job.error=null;job.finishedAt=new Date().toISOString();job.elapsedSeconds=(Date.now()-Date.parse(job.startedAt||job.createdAt))/1000;
      Object.assign(u,{remoteActive:false,progress:100,stage:'Ready',outputSHA256:receipt.outputSHA256,workerSeconds:receipt.workerSeconds,attention:receipt.attention});Object.assign(job.progress,{stage:'Complete',value:u.frames,completedFrames:u.frames,updatedAt:Date.now()});this.store.saveJob(job);
    }catch(error){
      if((error as WorkerError).remoteStopped)u.remoteActive=false;
      const saved=this.store.job(job.id);if(saved?.upscale?.cancellationConfirmed){u.remoteActive=false;u.cancellationConfirmed=true;}
      job.cancelRequested=!!saved?.cancelRequested;job.status=job.cancelRequested&&!u.remoteActive?'cancelled':'interrupted';job.error=(error as Error).message;job.progress.stage=job.status==='cancelled'?'Cancelled':'Upscale needs attention';this.store.saveJob(job);
    }
  }
  async recover(job:Job){
    if(!job.upscale)throw new Error('Not a Clarity run.');if(job.status==='completed')return job;
    if(this.task||this.starting||this.setupPending||this.store.jobs().some(j=>j.id!==job.id&&j.upscale?.remoteActive))throw new Error('Wait for or check existing Clarity work.');this.assertIdle();
    job.cancelRequested=false;job.error=null;job.status='running';job.progress.stage='Checking saved upscale';this.store.saveJob(job,false);this.start(job,undefined,true);return job;
  }
  async cancel(job:Job){
    if(job.status==='completed')return;
    const u=job.upscale!;job.cancelRequested=true;this.store.saveJob(job,false);
    if(this.task&&this.activeId===job.id){this.controller?.abort();return;}
    if(!u.remoteActive){job.status='cancelled';job.error=null;this.store.saveJob(job);return;}
    if(this.instance()!==u.instanceId)throw new Error('Reconnect the original GPU to confirm cancellation.');
    const output=await this.execute(this.repo,[...this.args(u.instanceId,'cancel'),'--job',job.id]);
    const line=output.split('\n').find(v=>v.startsWith('RECAST_UPSCALE '));if(!line||JSON.parse(line.slice(15)).running!==false)throw new Error('Clarity cancellation is not confirmed.');
    u.remoteActive=false;u.cancellationConfirmed=true;job.status='cancelled';job.error=null;this.store.saveJob(job);
  }
  async shutdown(){this.controller?.abort();await this.task;}
}

export function registerUpscaleRoutes(app:Express,manager:UpscaleManager,store:Store){
  app.get('/api/upscale/status',async(_req,res)=>res.json(await manager.status()));
  app.post('/api/upscale/prepare',async(_req,res)=>res.json(await manager.prepare()));
  app.post('/api/upscale/jobs',async(req,res)=>res.status(201).json(publicJob(await manager.create(req.body))));
  app.post('/api/upscale/jobs/:id/recover',async(req,res)=>{const job=store.job(z.string().uuid().parse(req.params.id));if(!job?.upscale)return void res.sendStatus(404);res.json(publicJob(await manager.recover(job)));});
  app.post('/api/upscale/jobs/:id/cancel',async(req,res)=>{const job=store.job(z.string().uuid().parse(req.params.id));if(!job?.upscale)return void res.sendStatus(404);await manager.cancel(job);res.json(publicJob(store.job(job.id)!));});
}
