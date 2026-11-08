import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { copyFile, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApplication } from '../server/index';
import { Store, publicJob } from '../server/store';
import { Runner } from '../server/runner';
import { compileSmoothMotion, automaticSmoothMotion } from '../server/smooth-motion';
import { fileSHA256 } from '../server/openjutsu-runner';
import { compileOpenjutsu, openjutsuGraphHash } from '../server/openjutsu-workflow';
import { openjutsuDefaults, emptyOpenjutsuDraft } from '../shared/openjutsu';
import { smoothMotionFiles, smoothMotionDraftSchema } from '../shared/smooth-motion';
import { defaults, type Asset, type Catalog, type Job } from '../shared/types';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { emptyModels } from '../shared/models';
import { overallProgressEstimate, outputReady } from '../shared/generation-progress';
import { command } from '../server/media';
import type { ConnectionManager } from '../server/comfy';
import { runSummary } from '../shared/library';
import { applyProgress } from '../server/comfy';
import Sidebar from '../src/Sidebar';
import PostProcessingWorkspace from '../src/PostProcessingWorkspace';
import ModuleAction from '../src/ModuleAction';

const repo=path.resolve(import.meta.dirname,'../..');
const catalog:Catalog={RecastSmoothVideoV1:{input:{required:{video:['STRING'],source_sha256:['STRING'],target_fps:[[30,48,60]],run_id:['STRING'],model_name:['STRING']}},output:[]},FrameInterpolationModelLoader:{input:{required:{model_name:[['rife_v4.25.safetensors']]}},output:['INTERP_MODEL']}};
const folders:string[]=[];const stores:Store[]=[];
afterEach(async()=>{for(const s of stores.splice(0))s.close();for(const f of folders.splice(0))await rm(f,{recursive:true,force:true});});
async function folder(){const f=await mkdtemp(path.join(os.tmpdir(),'recast-smooth-'));folders.push(f);return f;}
function job(id:string,sourceFile:string,hash:string,fps:30|48|60=30):Job{
 const graph=compileSmoothMotion(id,hash,fps);
 return {id,title:'Smooth test',status:'queued',sourceId:randomUUID(),referenceId:'',settings:{...defaults},width:64,height:96,createdAt:new Date().toISOString(),favorite:false,deleted:false,origin:'render',workflow:graph,progress:{stage:'Queued',node:null,value:null,max:null,unit:'frames',segment:1,segments:1,completedFrames:0,targetFrames:30,updatedAt:0},segments:[],context:'',pendingPrompt:null,uploads:null,error:null,output:null,poster:null,cancelRequested:false,elapsedSeconds:null,
 smoothMotion:{version:'smooth-motion-v1',targetFPS:fps,sourceFile,sourceSHA256:hash,sourceSeconds:1,instanceId:123,endpoint:'http://127.0.0.1:8188',graph,graphSHA256:openjutsuGraphHash(graph)}};
}
async function fixture(){
 const root=await folder(),store=new Store(root);stores.push(store);store.set('cloud-connected-instance',123);
 const input=path.join(root,'source.mp4');await writeFile(input,'immutable-input');const j=job(randomUUID(),input,await fileSHA256(input));store.addJob(j,'one');
 const client={json:vi.fn(async(route:string,_body?:unknown):Promise<any>=>route==='/object_info'?catalog:route==='/prompt'?{prompt_id:'finish-once'}:route.startsWith('/history/finish-once')?{'finish-once':{status:{status_str:'success'},outputs:{'1':{videos:[{filename:'final.mp4',subfolder:'recast-smooth/'+j.id,type:'output'}]}}}}:route==='/queue'?{queue_running:[],queue_pending:[]}:{}),upload:vi.fn(async()=> 'uploaded.mp4'),download:vi.fn(),watch:vi.fn(async()=>({close:()=>{}})),cancel:vi.fn()};
 const connection={status:{state:'online',endpoint:'http://127.0.0.1:8188'},client:()=>client}as unknown as ConnectionManager;
 const runner=new Runner(store,connection,{},repo);vi.spyOn(runner,'kick').mockResolvedValue();
 return{root,store,j,client,connection,runner};
}
async function video(file:string,fps:number,frames:number){await command('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=blue:size=64x96:rate=${fps}`,'-frames:v',String(frames),'-c:v','libx264','-pix_fmt','yuv420p',file]);}

describe('Smooth Motion finishing',()=>{
 it('adds only one small weight when higher FPS is selected; leaves the native graph identical',()=>{
  const plain=moduleDownloadPlan('openjutsu',openjutsuDefaults),smooth=moduleDownloadPlan('openjutsu',openjutsuDefaults,60);
  expect(smooth.files.filter(f=>!plain.files.includes(f))).toEqual(smoothMotionFiles);
  expect(smooth.runtimes).toEqual(['openjutsu-tools','smooth-motion-tools']);expect(moduleDownloadPlan('smooth-motion').files).toEqual(smoothMotionFiles);
  const a=emptyOpenjutsuDraft(),b={...a,outputFPS:60};expect(compileOpenjutsu(a.settings,{start:0,length:6})).toEqual(compileOpenjutsu(b.settings,{start:0,length:6}));
  expect(smoothMotionDraftSchema.safeParse({sourceId:randomUUID(),fps:25}).success).toBe(false);
 });
 it('has one independent output node with no H3, appearance or audio-generation nodes',()=>{
  const graph=compileSmoothMotion(randomUUID(),'a'.repeat(64),60);
  expect(Object.values(graph).map(n=>n.class_type)).toEqual(['RecastSmoothVideoV1']);expect(graph['1'].inputs.target_fps).toBe(60);
 });
 it('does not expose local paths or saved graphs in bootstrap records',()=>{
  const j=job(randomUUID(),'/private/video.mp4','b'.repeat(64));const p=publicJob(j);
  expect(p.smoothMotion?.sourceFile).toBe('');expect(p.smoothMotion?.graph).toEqual({});expect(p.workflow).toBeNull();
 });
 it('keeps one progress lifecycle and reserves the final finishing range',()=>{
  const j=job(randomUUID(),'', 'c'.repeat(64));expect(overallProgressEstimate(j)).toBe(0);
  j.status='running';j.smoothMotion!.automatic=true;Object.assign(j.progress,{node:'1',value:50,max:100});
  j.workflow={'1':{class_type:'UNETLoader',inputs:{},_meta:{title:'Native model'}}};
  applyProgress(j,{type:'progress',data:{node:'1',value:50,max:100}});expect(j.progress.unit).toBe('frames');expect(j.progress.stage).toBe('Smoothing motion');
  expect(overallProgressEstimate(j)).toBeGreaterThan(90);expect(overallProgressEstimate(j)).toBeLessThan(100);expect(outputReady(j)).toBe(false);
  j.status='completed';j.output='saved';expect(overallProgressEstimate(j)).toBe(100);expect(runSummary(j)).toContainEqual(['Frame rate','30 fps']);
 });
 it('saves the native receipt and recovers a failed transfer without submitting again',async()=>{
  const f=await fixture(),output=path.join(f.root,'fixture.mp4');await video(output,30,30);
  f.client.download.mockRejectedValueOnce(new Error('network loss')).mockImplementationOnce(async(_d,dest)=>copyFile(output,dest));
  await f.runner.run(f.j,new AbortController().signal);expect(f.store.job(f.j.id)?.status).toBe('interrupted');
  const submissions=()=>f.client.json.mock.calls.filter(c=>c[0]==='/prompt');expect(submissions()).toHaveLength(1);
  f.client.json.mockImplementation(async()=>{throw new Error('saved receipt must suffice');});
  await f.runner.run(f.store.job(f.j.id)!,new AbortController().signal);const final=f.store.job(f.j.id)!;
  expect(final.status).toBe('completed');expect(final.smoothMotion?.actualFrames).toBe(30);expect(submissions()).toHaveLength(1);
  expect(await readFile(final.output!)).toEqual(await readFile(output));
  final.status='interrupted';f.connection.status.state='offline';await f.runner.run(final,new AbortController().signal);expect(f.store.job(final.id)?.status).toBe('completed');
 });
 it('keeps a lost finishing acknowledgement ambiguous instead of resubmitting',async()=>{
  const f=await fixture();f.client.json.mockImplementation(async(route)=>{if(route==='/object_info')return catalog;if(route==='/prompt')throw new Error('acknowledgement lost');if(route==='/queue')return{queue_running:[],queue_pending:[]};return{};});
  await f.runner.run(f.j,new AbortController().signal);await f.runner.run(f.store.job(f.j.id)!,new AbortController().signal);
  expect(f.client.json.mock.calls.filter(c=>c[0]==='/prompt')).toHaveLength(1);expect(f.store.job(f.j.id)?.status).toBe('interrupted');
 });
 it('finishes a saved Remotion native video without running H3 again',async()=>{
  const f=await fixture(),native=path.join(f.root,'native-original.mp4'),output=path.join(f.root,'smooth-fixture.mp4');await video(native,24,24);await video(output,60,60);
  const h3=compileOpenjutsu(openjutsuDefaults,{start:0,length:1});delete f.j.smoothMotion;f.j.workflow=h3;f.j.referenceId=randomUUID();
  f.j.openjutsu={version:'openjutsu-simple-v1',outputFPS:60,settings:structuredClone(openjutsuDefaults),section:{start:0,length:1},sourceSHA256:'old-driving-hash',referenceSHA256:'old-photo-hash',graphSHA256:openjutsuGraphHash(h3),instanceId:123,endpoint:'http://127.0.0.1:8188',nativeFile:native,nativeSHA256:await fileSHA256(native)};
  f.store.saveJob(f.j);f.client.download.mockImplementation(async(_d,dest)=>copyFile(output,dest));
  await f.runner.run(f.j,new AbortController().signal);const final=f.store.job(f.j.id)!;
  expect(final.status).toBe('completed');expect(final.openjutsu?.nativeFile).toBe(native);expect(final.workflow).toEqual(h3);expect(final.smoothMotion?.automatic).toBe(true);
  const prompts=f.client.json.mock.calls.filter(c=>c[0]==='/prompt');expect(prompts).toHaveLength(1);expect(Object.values((prompts[0][1]as any).prompt).map((n:any)=>n.class_type)).toEqual(['RecastSmoothVideoV1']);
  expect(await fileSHA256(native)).toBe(final.openjutsu?.nativeSHA256);
 });
 it('requires an explicit retry for a terminal finishing error and retains the failed receipt',async()=>{
  const f=await fixture();f.client.json.mockImplementation(async(route)=>route==='/object_info'?catalog:route==='/prompt'?{prompt_id:'finish-once'}:route.startsWith('/history/')?{'finish-once':{status:{status_str:'error',messages:[['execution_error',{exception_message:'out of memory',node_type:'RecastSmoothVideoV1'}]]}}}:{});
  await f.runner.run(f.j,new AbortController().signal);const stopped=f.store.job(f.j.id)!;expect(stopped.retryRequired).toBe(true);
  await f.runner.resume(stopped);expect(f.runner.kick).not.toHaveBeenCalled();
  await f.runner.resume(stopped,true);expect(f.runner.kick).toHaveBeenCalledOnce();expect(stopped.pendingPrompt).toBeNull();
  expect(await readFile(path.join(f.root,'jobs',f.j.id,'smooth-motion-failure-finish-once.json'),'utf8')).toContain('out of memory');
 });
});

it('exposes a distinct Post-processing tab and a shared download-first footer',()=>{
 const html=renderToStaticMarkup(<Sidebar view="post" select={()=>{}} collapsed={false} toggle={()=>{}} libraryCount={0}/>);expect(html).toContain('Post-processing');expect(html).toContain('aria-current="page"');
 const footer=renderToStaticMarkup(<ModuleAction request={{module:'smooth-motion'}} controls={{state:emptyModels(),online:true,blocked:false,download:()=>{},remove:()=>{}}} runtimeReady={false} onGenerate={()=>{}} onConnect={()=>{}} onManage={()=>{}}/>);
 expect(footer).toContain('Download Smooth Motion');
 const data={assets:[],jobs:[],connection:{state:'offline'},models:emptyModels()} as any;
 const props={data,downloads:{state:data.models,online:false,blocked:false,download:()=>{},remove:()=>{}},selectedId:null,select:()=>{},asset:()=>{},job:()=>{},openGPU:()=>{},openDownloads:()=>{},library:()=>{},back:()=>{},changeMode:()=>{}};
 const smooth=renderToStaticMarkup(<PostProcessingWorkspace {...props} mode="motion"/>),face=renderToStaticMarkup(<PostProcessingWorkspace {...props} mode="face"/>);
 expect(smooth).toContain('Smooth Motion frame rate');expect(smooth).toContain('Video to smooth');expect(face).toContain('Face reference');expect(face).toContain('Face correction');
});

it('admits only prepared finishing jobs, deduplicates requests, and keeps parents immutable',async()=>{
 const root=await folder(),app=await createApplication({dataRoot:root,repo,seed:false,allowSSH:false,cloudOptions:{backgroundSafety:false,fetcher:vi.fn().mockRejectedValue(new Error('No provider request expected'))}});stores.push(app.store);
 try{
  const file=path.join(root,'source.mp4');await video(file,24,24);
  const source:Asset={id:randomUUID(),kind:'video',name:'Source.mp4',path:file,width:64,height:96,fps:24,duration:1,hasAudio:false,size:123,poster:'',createdAt:new Date().toISOString()};app.store.addAsset(source);
  app.store.set('cloud-connected-instance',123);Object.assign(app.connection.status,{state:'online',endpoint:'http://127.0.0.1:8188'});vi.spyOn(app.runner,'kick').mockResolvedValue();
  const body={sourceId:source.id,parentId:null,fps:60};
  const denied=await request(app.app).post('/api/smooth-motion/jobs').set('Idempotency-Key','missing-model').send(body);expect(denied.status).toBeGreaterThanOrEqual(400);expect(app.store.jobs()).toHaveLength(0);
  app.models.state.smoothMotionToolsReady=true;for(const f of app.models.state.files)if(smoothMotionFiles.includes(f.id))f.status='installed';
  const result=await request(app.app).post('/api/smooth-motion/jobs').set('Idempotency-Key','finish-one').send(body);expect(result.status).toBe(202);expect(result.body.smoothMotion.targetFPS).toBe(60);expect(result.body.smoothMotion.sourceFile).toBe('');
  const again=await request(app.app).post('/api/smooth-motion/jobs').set('Idempotency-Key','finish-one').send(body);expect(again.body.id).toBe(result.body.id);expect(app.store.jobs()).toHaveLength(1);
  expect((await request(app.app).post('/api/smooth-motion/jobs').set('Idempotency-Key','finish-one').send({...body,fps:30})).status).toBeGreaterThanOrEqual(400);
  const parent=app.store.job(result.body.id)!;parent.status='completed';parent.output=file;app.store.saveJob(parent);const immutable=JSON.stringify(app.store.job(parent.id));
  const picked=await request(app.app).post('/api/smooth-motion/use').send({jobId:parent.id});expect(picked.status).toBe(200);expect(picked.body.draft.parentId).toBe(parent.id);expect(JSON.stringify(app.store.job(parent.id))).toBe(immutable);
  expect((await request(app.app).get('/api/smooth-motion/draft')).body.sourceId).toBe(picked.body.asset.id);
 }finally{app.cloud.dispose();}
});
