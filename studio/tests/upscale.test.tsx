import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { ClipEditor } from '../server/clip-editor';
import { command } from '../server/media';
import { UpscaleManager, clarityFingerprint, type UpscaleCommand } from '../server/upscale';
import type { ConnectionManager } from '../server/comfy';
import { defaults, type Bootstrap, type Job } from '../shared/types';
import { emptyModels, modelBytes, upscaleModelFiles } from '../shared/models';
import { modelUsage } from '../shared/downloads';
import { upscaleGeometry, upscaleRequestSchema } from '../shared/upscale';
import { savedRunSettings, runSummary } from '../shared/library';
import { overallProgressEstimate } from '../shared/generation-progress';
import ClarityWorkspace from '../src/ClarityWorkspace';

const repo = path.resolve(import.meta.dirname, '../..');
const hash = async (file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
let root:string, store:Store, clips:ClipEditor, source:Job, manager:UpscaleManager;
let connection:ConnectionManager, calls:string[], mode:'complete'|'unknown'|'forged';
async function settled(jobId:string){
  for(let i=0;i<400;i++){const j=store.job(jobId)!;if(!['running','queued','reconnecting'].includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}
  throw new Error('Upscale fixture did not settle.');
}
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'clarity-contract-'));store=new Store(path.join(root,'data'));clips=new ClipEditor(store);calls=[];mode='complete';
  store.set('cloud-connected-instance',123);
  connection={status:{state:'online',endpoint:'http://127.0.0.1:8188'}}as ConnectionManager;
  const file=path.join(root,'source.mp4');
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x96:rate=24:duration=0.5','-c:v','libx264','-pix_fmt','yuv420p',file]);
  source={id:randomUUID(),title:'Synthetic source',status:'completed',settings:{...defaults,fps:24,seconds:.5},sourceId:'',referenceId:'',createdAt:new Date().toISOString(),favorite:false,deleted:false,width:64,height:96,
    progress:{stage:'Complete',node:null,value:100,max:100,unit:'%',segment:1,segments:1,completedFrames:12,targetFrames:12,updatedAt:0},segments:[],context:'',pendingPrompt:null,uploads:null,error:null,output:file,poster:null,cancelRequested:false,elapsedSeconds:1,origin:'import',workflow:null};store.addJob(source);
  const execute:UpscaleCommand=async(_repo,args,_signal,progress)=>{
    const arg=(name:string)=>args[args.indexOf(name)+1],action=arg('--action');calls.push(action);
    if(action==='status')return 'RECAST_UPSCALE '+JSON.stringify({ready:true,preparing:false,processing:false,missing:[],profileSHA256:clarityFingerprint(repo)});
    if(action==='cancel')return 'RECAST_UPSCALE '+JSON.stringify({running:false});
    if(action==='run'){
      if(mode==='unknown')throw new Error('Disconnected; activity unknown.');
      const frozen=JSON.parse(await readFile(arg('--request'),'utf8')),dest=arg('--output');await mkdir(dest,{recursive:true});
      const output=path.join(dest,'final.mp4'),g=frozen.geometry;
      await command('ffmpeg',['-v','error','-y','-i',arg('--source'),'-vf',`scale=${g.outputWidth}:${g.outputHeight}`,'-c:v','libx264','-pix_fmt','yuv420p',output]);
      const receipt=path.join(dest,'receipt.json');await writeFile(receipt,JSON.stringify({complete:true,request:frozen,outputSHA256:mode==='forged'?'bad':await hash(output),frames:12,fps:'24',width:g.outputWidth,height:g.outputHeight,audioPreserved:true,framingPreserved:true,attention:'sdpa',workerSeconds:.5}));
      await writeFile(path.join(dest,'transport.json'),JSON.stringify({jobId:arg('--job'),instanceId:123,receiptSHA256:await hash(receipt)}));progress?.(90,'Verifying saved upscale');return '';
    }
    throw new Error('Unexpected fixture command '+action);
  };
  manager=new UpscaleManager(store,repo,connection,clips,()=>{},execute);
});
afterEach(async()=>{await manager?.shutdown();await clips?.shutdown();store?.close();await rm(root,{recursive:true,force:true});});
const request=()=>({source:{jobId:source.id},settings:{height:720,motion:'fast',matchColors:true},requestKey:randomUUID()});

describe('Clarity video upscaling',()=>{
  it('pads the complete image on a chroma-aligned grid rather than cropping and rejects downscaling',()=>{
    for(const [w,h]of[[864,480],[480,854],[480,833],[704,1248]]){
      const g=upscaleGeometry(w,h,1080);expect(g.workWidth%128).toBe(0);expect(g.workHeight%128).toBe(0);expect(g.padX%2).toBe(0);expect(g.padY%2).toBe(0);
      expect(g.workWidth-g.outputWidth-g.padX).toBeGreaterThanOrEqual(0);expect(g.workHeight-g.outputHeight-g.padY).toBeGreaterThanOrEqual(0);
      expect(Math.abs(g.outputWidth/g.outputHeight-w/h)).toBeLessThan(.002);
    }
    expect(()=>upscaleGeometry(1920,1080,720)).toThrow('larger');
    expect(()=>upscaleGeometry(8000,100,1080)).toThrow('processing limit');
  });
  it('requires exactly one saved source and reports the actual optional model footprint',()=>{
    const v=request();expect(upscaleRequestSchema.safeParse({...v,source:{}}).success).toBe(false);
    expect(upscaleRequestSchema.safeParse({...v,source:{jobId:source.id,assetId:randomUUID()}}).success).toBe(false);
    expect(modelBytes(upscaleModelFiles)).toBe(7016472997);expect(upscaleModelFiles).toHaveLength(3);
    expect(upscaleModelFiles.every(id=>modelUsage(id)[0].workflow==='Clarity')).toBe(true);
  });
  it('creates a separate idempotent result and preserves both drafts, source bytes and timing',async()=>{
    const original=await hash(source.output!),drafts=JSON.stringify([store.draft(),store.imageDraft()]),input=request();
    const job=await manager.create(input),completed=await settled(job.id);expect(completed.status).toBe('completed');
    expect(completed.origin).toBe('upscale');expect(completed.upscale).toMatchObject({fps:'24',frames:12,progress:100,remoteActive:false});
    expect((await manager.create(input)).id).toBe(job.id);expect(calls.filter(c=>c==='run')).toHaveLength(1);expect(calls).not.toContain('prepare');
    expect(await hash(source.output!)).toBe(original);expect(store.job(source.id)).toEqual(source);expect(JSON.stringify([store.draft(),store.imageDraft()])).toBe(drafts);
    expect(savedRunSettings(completed)).not.toHaveProperty('seed');expect(runSummary(completed)[0][1]).toContain('Clarity');
    expect(overallProgressEstimate(completed)).toBe(100);expect(overallProgressEstimate({...completed,status:'running'})).toBe(99);
    await manager.cancel(completed);expect(store.job(job.id)!.status).toBe('completed');
    await expect(manager.create({...input,settings:{...input.settings,height:1080}})).rejects.toThrow('request key');
  });
  it('recovers already-downloaded output offline without launching inference again',async()=>{
    const job=await manager.create(request());expect((await settled(job.id)).status).toBe('completed');
    const saved=store.job(job.id)!;saved.status='interrupted';saved.output=null;store.saveJob(saved);connection.status.state='offline';calls=[];
    await manager.recover(saved);expect((await settled(job.id)).status).toBe('completed');expect(calls).toEqual([]);
  });
  it('retains unconfirmed remote work as busy and requires positive cancellation evidence',async()=>{
    mode='unknown';const job=await manager.create(request());const failed=await settled(job.id);
    expect(failed.upscale!.remoteActive).toBe(true);expect(manager.busy).toBe(true);await expect(manager.create(request())).rejects.toThrow('existing upscale');
    await manager.cancel(failed);expect(manager.busy).toBe(false);expect(store.job(job.id)!.upscale!.cancellationConfirmed).toBe(true);
  });
  it('rejects a forged output receipt and preserves files for inspection',async()=>{
    mode='forged';const job=await manager.create(request()),failed=await settled(job.id);
    expect(failed.status).toBe('interrupted');expect(failed.error).toContain('validation failed');expect(failed.output).toBeNull();
    expect((await readFile(path.join(store.root,'jobs',job.id,'upscale/final.mp4'))).length).toBeGreaterThan(0);
  });
  it('clears unknown workers only with a provider stop newer than that attempt',async()=>{
    mode='unknown';const job=await manager.create(request()),failed=await settled(job.id);expect(manager.busy).toBe(true);
    manager.observeProviderStop(123,Date.parse(failed.createdAt)-1000);expect(manager.busy).toBe(true);
    manager.observeProviderStop(999,Date.now()+1000);expect(manager.busy).toBe(true);
    manager.observeProviderStop(123,Date.now()+1000);expect(manager.busy).toBe(false);expect(store.job(job.id)!.upscale).toMatchObject({remoteActive:false,cancellationConfirmed:true});
  });
  it('checks host-bound readiness without installing, renting or resuming anything',async()=>{
    expect((await manager.status()).ready).toBe(true);expect(calls).toEqual(['status']);connection.status.state='offline';
    await expect(manager.create(request())).rejects.toThrow('Connect');expect(calls).toEqual(['status']);
    const python=await command('python3',['-c','import sys;sys.path.insert(0,sys.argv[1]);from upscale_worker import profile_hash;print(profile_hash())',path.join(repo,'scripts')]);
    expect(python.trim()).toBe(clarityFingerprint(repo));
  });
  it('renders the independent empty workspace and manual model/runtime controls',()=>{
    const models=emptyModels(),data={jobs:[source],assets:[],connection:{state:'offline'},cloud:{refreshedAt:null},models}as unknown as Bootstrap;
    const html=renderToStaticMarkup(<ClarityWorkspace data={data} downloads={{state:models,online:false,blocked:false,settingUp:false,download:()=>{},remove:()=>{}}} selectedId={null} select={()=>{}} added={()=>{}} assetAdded={()=>{}} openGPU={()=>{}} openDownloads={()=>{}} library={()=>{}}/>);
    expect(html).toContain('Clarity');expect(html).toContain('Prepare Clarity runtime');expect(html).toContain('Empty video workspace');expect(html).toContain('Upscale resolution');expect(html).not.toContain('Character reference');
    expect(readFileSync(path.join(repo,'config/upscale-runtime.lock.json'),'utf8')).toContain('pending managed GPU comparison');
  });
});
