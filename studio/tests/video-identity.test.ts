import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/store';
import { VideoIdentity } from '../server/video-identity';
import { command } from '../server/media';
import { defaults, type Job } from '../shared/types';
import { runSummary, savedRunSettings } from '../shared/library';
import type { GpuFaceBackend } from '../server/gpu-video-identity';

const managers: VideoIdentity[]=[],stores: Store[]=[],roots: string[]=[];
afterEach(async()=>{for(const manager of managers)await manager.shutdown();for(const store of stores)store.close();for(const root of roots)rmSync(root,{recursive:true,force:true});managers.length=stores.length=roots.length=0;});
const hash=(file: string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
async function waitFor(check:()=>boolean){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Local fixture did not settle');}
async function fixture() {
  const root=mkdtempSync(path.join(os.tmpdir(),'face-video-'));roots.push(root);const store=new Store(path.join(root,'data'));stores.push(store);
  const parentFolder=path.join(store.root,'jobs','parent');mkdirSync(parentFolder);const video=path.join(parentFolder,'final.mp4');
  await command('ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i','color=c=blue:s=64x96:r=24','-frames:v','2','-c:v','libx264','-pix_fmt','yuv420p',video]);
  const reference=path.join(root,'reference.png');writeFileSync(reference,'reference fixture bytes');
  store.addAsset({id:'reference',kind:'image',name:'Character',path:reference,poster:reference,size:23,width:64,height:96,duration:0,fps:24,hasAudio:false,createdAt:'2026-10-28'});
  const parent:Job={id:'parent',title:'Paid nine-second source',status:'completed',settings:{...defaults,engine:'viggle',fps:24,seconds:2/24,seed:321},sourceId:'source',referenceId:'reference',
    createdAt:'2026-10-28',favorite:true,deleted:false,width:64,height:96,progress:{stage:'Complete',node:null,value:null,max:null,unit:'frames',segment:1,segments:1,completedFrames:2,targetFrames:2,updatedAt:0},
    segments:[],context:'',uploads:null,pendingPrompt:null,error:null,output:video,poster:null,cancelRequested:false,elapsedSeconds:300,origin:'render',workflow:{}};
  store.addJob(parent);const repo=path.resolve(import.meta.dirname,'../..');let runs=0,failMode='';let pause=false;
  const execute=async(args:{reference:string;target:string;folder:string;method?:string;performanceSource?:string},signal:AbortSignal,progress:(frame:number,frames:number)=>void)=>{
    runs++;mkdirSync(args.folder,{recursive:true});progress(1,2);
    if(pause){await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('fixture cancelled')),{once:true}));return;}
    const frames=[0,1].map(frame=>{const file=path.join(args.folder,`frame-${String(frame).padStart(6,'0')}.png`);writeFileSync(file,'saved frame '+frame);return {frame,sha256:hash(file),action:'refined',protectedPixelsExact:true};});
    writeFileSync(path.join(args.folder,'final.mp4'),readFileSync(video));
    const source=args.method==='source-performance';
    const receipt={complete:true,execution:'local CPU',newPaidInference:false,model:'hyperswap_1a_256',inputs:{version:source?'face-source-v1':'face-finish-v1',...(source?{method:'source-performance',performanceSHA256:hash(args.performanceSource!),performanceProfile:hash(path.join(repo,'config/face-source-profile.json'))}:{}),profile:hash(path.join(repo,'config/local-video-identity.lock.json')),baseProfile:hash(path.join(repo,'config/local-identity.lock.json')),parentSHA256:hash(video),referenceSHA256:hash(reference),width:64,height:96,frames:2,fps:failMode==='fps'?'30':'24'},
      outputSHA256:hash(video),elapsedSeconds:.2,refinedFrames:2,skippedFrames:0,records:frames};
    if(source){Object.assign(receipt,{performanceFrames:1,fallbackFrames:1});Object.assign(frames[0],{performance:'source-features'});Object.assign(frames[1],{performance:'identity-only'});}
    if(failMode==='tamper')writeFileSync(path.join(args.folder,'frame-000001.png'),'tampered frame');
    writeFileSync(path.join(args.folder,'identity-video.json'),JSON.stringify(receipt));progress(2,2);
  };
  const status=async()=>({ready:true,missing:[],bytes:1,readyBytes:1,setup:'explicit local setup',license:'private evaluation'});
  const manager=new VideoIdentity(store,repo,execute,status);managers.push(manager);
  return {store,parent,manager,video,execute,status,runs:()=>runs,fail:(mode:string)=>{failMode=mode;},pause:(value:boolean)=>{pause=value;}};
}
it('refines offline as a separate CPU derivative and preserves paid settings and pixels',async()=>{
  const f=await fixture(),before=hash(f.video),job=await f.manager.create('parent');await waitFor(()=>f.store.job(job.id)?.status==='completed');
  const done=f.store.job(job.id)!;expect(done).toMatchObject({origin:'import',workflow:null,pendingPrompt:null,segments:[],faceRefinement:{parentJobId:'parent',execution:'local CPU',refinedFrames:2,skippedFrames:0}});
  expect(f.store.job('parent')).toEqual(f.parent);expect(hash(f.video)).toBe(before);expect(savedRunSettings(done)).not.toHaveProperty('seed');
  expect(runSummary(done)).toContainEqual(['Local processing','0.2 seconds']);expect(done.elapsedSeconds).not.toBe(f.parent.elapsedSeconds);
});
it('deduplicates concurrent requests before any second local worker can start',async()=>{
  const f=await fixture();const [a,b]=await Promise.all([f.manager.create('parent'),f.manager.create('parent')]);expect(a.id).toBe(b.id);await waitFor(()=>f.store.job(a.id)?.status==='completed');expect(f.runs()).toBe(1);
  expect((await f.manager.create('parent')).id).toBe(a.id);expect(f.runs()).toBe(1);
});
it('cancels and resumes locally without altering the parent or requiring a GPU',async()=>{
  const f=await fixture();f.pause(true);const job=await f.manager.create('parent');await waitFor(()=>f.runs()===1);await f.manager.cancel(f.store.job(job.id)!);
  expect(f.store.job(job.id)).toMatchObject({status:'cancelled',cancellationConfirmed:true});f.pause(false);await f.manager.resume(f.store.job(job.id)!);await waitFor(()=>f.store.job(job.id)?.status==='completed');expect(f.runs()).toBe(2);expect(f.store.job('parent')).toEqual(f.parent);
});
it.each(['tamper','fps'])('rejects %s after execution and keeps the original recoverable',async(mode)=>{
  const f=await fixture();f.fail(mode);const job=await f.manager.create('parent');await waitFor(()=>f.store.job(job.id)?.status==='interrupted');
  expect(f.store.job(job.id)?.output).toBeNull();expect(f.store.job(job.id)?.error).toMatch(mode==='tamper'?/frame changed/:/frame rate/);expect(f.store.job('parent')).toEqual(f.parent);
});
it('does not queue or download when local weights are missing',async()=>{
  const f=await fixture();const manager=new VideoIdentity(f.store,path.resolve(import.meta.dirname,'../..'),f.execute,async()=>({...await f.status(),ready:false}));managers.push(manager);
  await expect(manager.create('parent')).rejects.toThrow(/one-time setup/);expect(f.store.jobs()).toHaveLength(1);expect(f.runs()).toBe(0);
});
it('startup recovery touches local refinement only and leaves paid GPU work alone',async()=>{
  const f=await fixture();const paid={...structuredClone(f.parent),id:randomUUID(),status:'running' as const};f.store.addJob(paid);
  const local={...structuredClone(f.parent),id:randomUUID(),origin:'import' as const,status:'running' as const,faceRefinement:{version:'face-finish-v1' as const,parentJobId:'parent',referenceAssetId:'reference',execution:'local CPU' as const}};f.store.addJob(local);
  const manager=new VideoIdentity(f.store,path.resolve(import.meta.dirname,'../..'),f.execute,f.status);managers.push(manager);
  expect(f.store.job(local.id)?.status).toBe('interrupted');expect(f.store.job(paid.id)).toEqual(paid);
});

async function gpuFixture() {
  const f=await fixture();let instance=42,setupCalls=0,blocked=false,fallback=false;
  const backend:GpuFaceBackend={
    instance:()=>instance,assertIdle:()=>{if(blocked)throw new Error('GPU render is active');},
    status:async()=>({...await f.status(),available:true,instanceId:instance,sourcePerformanceReady:true}),setup:async()=>{setupCalls++;},
    run:async(args,signal,progress)=>{
      await f.execute(args,signal,progress);
      const file=path.join(args.folder,'identity-video.json'),r=JSON.parse(readFileSync(file,'utf8'));
      Object.assign(r,{execution:'remote CUDA',newPaidInference:true,framesVerified:true,gpu:'fixture GPU',sessionProviders:{'hyperswap_1a_256.onnx':[fallback?'CPUExecutionProvider':'CUDAExecutionProvider']}});
      Object.assign(r.inputs,{provider:'cuda',gpuProfile:hash(path.resolve(import.meta.dirname,'../../config/gpu-video-identity.lock.json'))});
      writeFileSync(file,JSON.stringify(r));
      writeFileSync(path.join(args.folder,'gpu-transport.json'),JSON.stringify({instanceId:args.instanceId,jobId:args.jobId,receiptSHA256:hash(file)}));
    },
  };
  const manager=new VideoIdentity(f.store,path.resolve(import.meta.dirname,'../..'),f.execute,f.status,backend);managers.push(manager);
  return {...f,gpuManager:manager,instance:(value:number)=>{instance=value;},block:()=>{blocked=true;},fallback:()=>{fallback=true;},setupCalls:()=>setupCalls};
}
it('records CUDA provenance and saves a separate GPU variant without implicit setup',async()=>{
  const f=await gpuFixture(),cpu=await f.manager.create('parent');await waitFor(()=>f.store.job(cpu.id)?.status==='completed');
  const gpu=await f.gpuManager.create('parent',undefined,'remote CUDA');await waitFor(()=>f.store.job(gpu.id)?.status==='completed');
  const done=f.store.job(gpu.id)!;expect(gpu.id).not.toBe(cpu.id);expect(done.faceRefinement).toMatchObject({execution:'remote CUDA',instanceId:42,gpu:'fixture GPU'});
  expect(f.setupCalls()).toBe(0);expect(f.store.job('parent')).toEqual(f.parent);expect(savedRunSettings(done)).toMatchObject({execution:'remote CUDA'});expect(runSummary(done)).toContainEqual(['GPU processing','0.2 seconds']);
});
it('rejects a GPU receipt whose swap session fell back to CPU',async()=>{
  const f=await gpuFixture();f.fallback();const job=await f.gpuManager.create('parent',undefined,'remote CUDA');await waitFor(()=>f.store.job(job.id)?.status==='interrupted');expect(f.store.job(job.id)?.error).toMatch(/CUDA provider verification/);
});
it('does not start refinement while another GPU render is active',async()=>{
  const f=await gpuFixture();f.block();await expect(f.gpuManager.create('parent',undefined,'remote CUDA')).rejects.toThrow(/GPU render/);expect(f.runs()).toBe(0);expect(f.store.jobs()).toHaveLength(1);
});
it('requires the original instance before resuming GPU face frames',async()=>{
  const f=await gpuFixture();f.pause(true);const job=await f.gpuManager.create('parent',undefined,'remote CUDA');await waitFor(()=>f.runs()===1);await f.gpuManager.cancel(f.store.job(job.id)!);f.instance(43);
  expect(f.store.job(job.id)?.status).toBe('interrupted');expect(f.store.job(job.id)?.cancellationConfirmed).toBe(false);
  await expect(f.gpuManager.resume(f.store.job(job.id)!)).rejects.toThrow(/same GPU instance/);expect(f.runs()).toBe(1);
});
it('finishes a downloaded GPU result locally without another worker or the original connection',async()=>{
  const f=await gpuFixture();const job=await f.gpuManager.create('parent',undefined,'remote CUDA');await waitFor(()=>f.store.job(job.id)?.status==='completed');
  const saved=f.store.job(job.id)!;saved.status='interrupted';f.store.saveJob(saved);f.instance(43);await f.gpuManager.resume(saved);
  expect(f.store.job(job.id)?.status).toBe('completed');expect(f.runs()).toBe(1);
});
it('saves a separate source-performance swap with the exact source hash and frame-coverage counts',async()=>{
  const f=await fixture(),file=path.join(path.dirname(f.video),'prepared-source.mp4');copyFileSync(f.video,file);
  const direct=await f.manager.create('parent');await waitFor(()=>f.store.job(direct.id)?.status==='completed');
  const job=await f.manager.create('parent',undefined,'local CPU','source-performance');await waitFor(()=>f.store.job(job.id)?.status==='completed');
  expect(job.id).not.toBe(direct.id);expect(f.store.job(job.id)?.faceRefinement).toMatchObject({version:'face-source-v1',method:'source-performance',performanceSHA256:hash(file),performanceFrames:1,fallbackFrames:1});
  writeFileSync(file,'changed source');await expect(f.manager.finish(f.store.job(job.id)!,path.join(f.store.root,'jobs',job.id,'face-refinement'))).rejects.toThrow(/source-performance provenance/);expect(f.store.job('parent')).toEqual(f.parent);
});
it('rejects missing or historically recovered motion sources before starting a worker',async()=>{
  const f=await fixture();await expect(f.manager.create('parent',undefined,'local CPU','source-performance')).rejects.toThrow(/exact unmodified prepared source/);expect(f.runs()).toBe(0);
  copyFileSync(f.video,path.join(path.dirname(f.video),'prepared-source.mp4'));const parent=f.store.job('parent')!;parent.videoRecovery={generatedFrames:1,leadingHoldFrames:1,reason:'trim-timestamp',originalFailedNode:'checkpoint',recoveredAt:'2026-10-28'};f.store.saveJob(parent);
  await expect(f.manager.create('parent',undefined,'local CPU','source-performance')).rejects.toThrow(/exact unmodified/);expect(f.runs()).toBe(0);
});
it('keeps source-performance provenance through the CUDA transport and receipt checks',async()=>{
  const f=await gpuFixture();copyFileSync(f.video,path.join(path.dirname(f.video),'prepared-source.mp4'));
  const job=await f.gpuManager.create('parent',undefined,'remote CUDA','source-performance');await waitFor(()=>f.store.job(job.id)?.status==='completed');
  expect(f.store.job(job.id)?.faceRefinement).toMatchObject({version:'face-source-v1',method:'source-performance',execution:'remote CUDA',instanceId:42,performanceFrames:1,fallbackFrames:1});expect(f.setupCalls()).toBe(0);
});
