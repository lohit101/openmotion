import { emptyImageEditDraft } from '../shared/image-edit';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults,type Catalog } from '../shared/types';
import { sourceFrameImageSettings,imageDefaults } from '../shared/image-replacement';
import { emptyModels,imageFilesForSettings,modelDefinitions,modelFilesForSettings,upscaleModelFiles,type ModelsState } from '../shared/models';
import { moduleDownloadPlan,moduleDownloadProgress,planFromRequest,moduleDownloadRequestSchema,type ModuleDownloadRequest } from '../shared/module-downloads';
import { ModelManager,ModelDownloadError,type downloadPinnedModels } from '../server/models';
import type { ConnectionManager } from '../server/comfy';
import { Store } from '../server/store';
import ModuleAction from '../src/ModuleAction';
import ModuleSetupQueue from '../src/ModuleSetupQueue';

const video={...defaults,engine:'viggle' as const,referencePreparation:'prepared' as const,facialConsistency:'off' as const};
const photo=sourceFrameImageSettings(imageDefaults);
describe('module-specific download presentation',()=>{
  it('requests the minimal selected recipe rather than every model family',()=>{
    const motion=moduleDownloadPlan('remotion',video),image=moduleDownloadPlan('imagen',photo),clarity=moduleDownloadPlan('clarity');
    expect(motion.files).toEqual(modelFilesForSettings(video));expect(motion.files).toHaveLength(4);expect(motion.runtimes).toEqual(['viggle-tools']);
    expect(image.files).toEqual(imageFilesForSettings(photo));expect(image.files.some(f=>f.includes('bfs_head'))).toBe(false);
    expect(clarity.files).toEqual(upscaleModelFiles);expect(clarity.runtimes).toEqual(['clarity']);
    const face=moduleDownloadPlan('remotion',{...video,facialConsistency:'perform-onnx60',facialFeatureCleanup:true,facialEyeCalibration:false});
    expect(face.runtimes).toEqual(['viggle-tools','facial:source-face-v6']);expect(face.files.some(f=>f.includes('eye_finish'))).toBe(false);
    expect(moduleDownloadPlan('remotion',{...video,referencePreparation:'auto'}).files.some(f=>f.includes('klein'))).toBe(true);
    expect(moduleDownloadRequestSchema.safeParse({module:'clarity',files:['arbitrary']}).success).toBe(false);
  });
  it('uses byte-weighted progress, keeps a stable set and holds verification below 100%',()=>{
    const plan=moduleDownloadPlan('clarity'),state=emptyModels(),first=state.files.find(f=>f.id===plan.files[0])!,second=state.files.find(f=>f.id===plan.files[1])!;
    state.moduleSetup={...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:plan.files,status:'downloading',message:'',error:null,updatedAt:1};
    const size=modelDefinitions.find(f=>f.id===first.id)!.size;
    Object.assign(first,{status:'downloading',downloaded:size/2,percent:50});Object.assign(second,{status:'queued'});
    const a=moduleDownloadProgress(plan,state);expect(a.downloaded).toBe(size/2);expect(a.percent).toBeLessThan(50);
    Object.assign(first,{status:'installed'});expect(moduleDownloadProgress(plan,state).total).toBe(a.total);expect(moduleDownloadProgress(plan,state).percent).toBeGreaterThan(a.percent);
    for(const file of state.files.filter(f=>plan.files.includes(f.id)))Object.assign(file,{status:'downloading',downloaded:modelDefinitions.find(f=>f.id===file.id)!.size,percent:null});
    expect(moduleDownloadProgress(plan,state).percent).toBe(99);
    first.status='reconnecting';expect(moduleDownloadProgress(plan,state).reconnecting).toBe(true);
  });
  it('uses the same footer and exposes Download before inputs are filled in every module',()=>{
    const requests:ModuleDownloadRequest[]=[{module:'remotion',settings:video},{module:'imagen',settings:photo},{module:'clarity'}];
    const download=vi.fn(),prepare=vi.fn();
    for(const request of requests){
      const html=renderToStaticMarkup(<ModuleAction request={request} controls={{state:emptyModels(),online:true,blocked:false,download,remove:()=>{},prepareModule:prepare}} generateDisabled onGenerate={()=>{}} onConnect={()=>{}} onManage={()=>{}}/>);
      expect(html).toContain('generate-footer module-action');expect(html).toContain('aria-label="Download '+({'smooth-motion':'Smooth Motion',remotion:'Remotion',openjutsu:'Remotion','openjutsu-face':'Fix Faces',imagen:'Imagen','image-edit':'Image Edit',clarity:'Clarity'}[request.module])+'"');
      expect(html.match(/<button[^>]+class="[^"]*primary-button generate module-primary-button"[^>]*>/)?.[0]).not.toContain('disabled');
    }
    expect(download).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();
  });
  it('keeps Generate separate and disabled during downloads or runtime preparation',()=>{
    const plan=moduleDownloadPlan('clarity'),state=emptyModels();
    for(const file of state.files)if(plan.files.includes(file.id))file.status='installed';
    const render=(runtimeReady:boolean)=>renderToStaticMarkup(<ModuleAction request={{module:'clarity'}} controls={{state,online:true,blocked:false,download:()=>{},remove:()=>{}}} runtimeReady={runtimeReady} onGenerate={()=>{}} onConnect={()=>{}} onManage={()=>{}}/>);
    expect(render(false)).toContain('aria-label="Download Clarity"');expect(render(true)).toContain('aria-label="Generate"');
    state.busy=true;state.moduleSetup={...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:[],status:'preparing',message:'Preparing required runtime',error:null,updatedAt:1};
    const html=render(false);expect(html).toContain('Preparing tools');expect(html).toContain('aria-busy="true"');
  });
  it('offers queuing another module without enabling generation and lists independent queue controls',()=>{
    const plan=moduleDownloadPlan('clarity'),other=moduleDownloadPlan('image-edit',emptyImageEditDraft().settings),state=emptyModels();
    state.busy=true;state.moduleSetup={...other,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:other.files,status:'downloading',message:'Downloading',error:null,updatedAt:1};
    const controls={state,online:true,blocked:false,download:()=>{},remove:()=>{},prepareModule:vi.fn(),moduleAction:vi.fn()};
    const html=renderToStaticMarkup(<ModuleAction request={{module:'clarity'}} controls={controls} runtimeReady={false} onGenerate={()=>{}} onConnect={()=>{}} onManage={()=>{}}/>);
    expect(html).toContain('aria-label="Queue Clarity"');expect(html.match(/<button[^>]+module-primary-button[^>]*>/)?.[0]).not.toContain('disabled');
    const pending={...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:plan.files,status:'paused' as const,message:'Paused',error:null,updatedAt:2};
    state.moduleQueue=[state.moduleSetup,pending];
    const list=renderToStaticMarkup(<ModuleSetupQueue controls={controls}/>);
    expect(list).toContain('Pause Imagen setup');expect(list).toContain('Resume Clarity setup');expect(list).toContain('Cancel Clarity setup');
    pending.status='paused';state.moduleSetup.activeRuntime='openjutsu-tools';state.moduleSetup.status='paused';
    expect(renderToStaticMarkup(<ModuleSetupQueue controls={controls}/>)).toContain('Waiting for tool installation to finish');
  });
});

describe('module setup ownership and recovery',()=>{
  let root='',store:Store,manager:ModelManager;
  afterEach(async()=>{manager?.dispose();await manager?.cancel();store?.close();if(root)await rm(root,{recursive:true,force:true});});
  async function fixture(saved?:unknown){
    root=await mkdtemp(path.join(os.tmpdir(),'module-downloads-'));store=new Store(root);store.set('cloud-connected-instance',123);if(saved)store.set('model-download-state-v1',saved);
    const installed=new Set<string>(),controls=new Map<string,{resolve:()=>void;reject:(error:Error)=>void}>();
    const connection={status:{state:'online',endpoint:'http://127.0.0.1:8188',loras:[]},catalog:{},client:()=>({json:async()=>({Loader:{input:{required:{files:[[...installed].map(id=>id.split('/').at(-1))]}},output:[]}}as Catalog)}),emit:()=>{},recoverTransport:vi.fn(async()=>true)};
    const worker=vi.fn<typeof downloadPinnedModels>(async(_repo,_instance,_endpoint,files,signal,progress)=>{
      const id=files[0];progress('Downloading',25,{downloaded:modelDefinitions.find(f=>f.id===id)!.size/4,total:modelDefinitions.find(f=>f.id===id)!.size});
      await new Promise<void>((resolve,reject)=>{controls.set(id,{resolve:()=>{installed.add(id);resolve();},reject});signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true});});
    });
    const storage=vi.fn(async()=>({freeBytes:10**12,files:[...installed].map(id=>({id,size:modelDefinitions.find(f=>f.id===id)!.size,verified:true})),loras:[]}));
    manager=new ModelManager(store,connection as unknown as ConnectionManager,path.resolve(import.meta.dirname,'../..'),worker,storage);
    const until=async(test:()=>boolean)=>{for(let i=0;i<200&&!test();i++)await new Promise(r=>setTimeout(r,5));expect(test()).toBe(true);};
    const complete=async()=>{await until(()=>controls.size>0);for(const c of controls.values())c.resolve();await until(()=>!manager.state.busy);};
    return {worker,controls,connection,complete,until,installed};
  }
  it('finishes only selected Imagen files without downloading other families or generating',async()=>{
    const f=await fixture(),plan=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false});
    await manager.prepareModule(plan);await f.complete();expect(manager.state.moduleSetup?.status).toBe('complete');
    expect(f.worker.mock.calls.flatMap(c=>c[3]).sort()).toEqual([...plan.files].sort());expect(manager.state.moduleSetup?.runtimes).toEqual([]);
  });
  it('finishes Smooth Motion preparation with a native COMBO model list and reuses its downloaded weight',async()=>{
    const f=await fixture(),plan=moduleDownloadPlan('smooth-motion');
    for(const id of plan.files)f.installed.add(id);
    const live:Catalog={FrameInterpolationModelLoader:{input:{required:{model_name:['COMBO',{options:['rife_v4.25.safetensors']}]}},output:['INTERP_MODEL']},RecastSmoothVideoV1:{input:{required:{}},output:[]}};
    f.connection.client=()=>({json:async()=>live});
    await manager.prepareModule(plan);await f.until(()=>!manager.state.busy);
    expect(manager.state.moduleSetup?.status).toBe('complete');expect(manager.state.smoothMotionToolsReady).toBe(true);
    expect(manager.state.files.find(file=>file.id===plan.files[0])?.status).toBe('installed');expect(f.worker).not.toHaveBeenCalled();
  });
  it('chains Clarity setup after verified files and keeps the whole operation busy',async()=>{
    const f=await fixture();let finish!:(value:{ready:boolean;preparing:boolean;missing:string[]})=>void;
    manager.checkClarity=vi.fn(async()=>({ready:false,preparing:false,missing:['runtime']}));
    manager.prepareClarity=vi.fn(async()=>{expect(upscaleModelFiles.every(id=>manager.state.files.find(f=>f.id===id)?.status==='installed')).toBe(true);expect(manager.preparingClarity).toBe(true);return await new Promise<{ready:boolean;preparing:boolean;missing:string[]}>(resolve=>{finish=resolve;});});
    await manager.prepareModule(moduleDownloadPlan('clarity'));await f.until(()=>f.controls.size===3);for(const c of f.controls.values())c.resolve();
    await f.until(()=>!!finish);expect(manager.state.busy).toBe(true);expect(manager.state.moduleSetup?.status).toBe('preparing');finish({ready:true,preparing:false,missing:[]});
    await f.until(()=>!manager.state.busy);expect(manager.state.moduleSetup?.status).toBe('complete');
  });
  it('keeps failed files retryable without preparing a runtime or deleting successful files',async()=>{
    const f=await fixture();manager.checkClarity=vi.fn();manager.prepareClarity=vi.fn();
    await manager.prepareModule(moduleDownloadPlan('clarity'));await f.until(()=>f.controls.size===3);
    const first=[...f.controls][0];first[1].reject(new Error('Synthetic network failure'));for(const[id,c]of f.controls)if(id!==first[0])c.resolve();
    await f.until(()=>!manager.state.busy);expect(manager.state.moduleSetup?.status).toBe('failed');expect(manager.prepareClarity).not.toHaveBeenCalled();
    expect(manager.state.files.filter(f=>f.status==='installed')).toHaveLength(2);
  });
  it('restores pending ownership without starting anything on another GPU',async()=>{
    const id=upscaleModelFiles[0],saved={instanceId:123,endpoint:'http://127.0.0.1:8188',startedAt:500,files:[{id,status:'downloading',remoteActive:true,downloaded:123,percent:1,message:'',error:null}]};
    const f=await fixture(saved);store.set('cloud-connected-instance',999);await manager.recoverPending();expect(f.worker).not.toHaveBeenCalled();expect(manager.state.busy).toBe(true);
    manager.observeProviderStop(999,1000);expect(manager.state.busy).toBe(true);manager.observeProviderStop(123,400);expect(manager.state.busy).toBe(true);
    manager.observeProviderStop(123,1000);expect(manager.state.busy).toBe(false);expect(manager.state.files.find(f=>f.id===id)?.remoteActive).toBe(false);
  });
  it('retains unknown remote cancellation until independent stop confirmation',async()=>{
    const f=await fixture();await manager.start([upscaleModelFiles[0]]);await f.until(()=>f.controls.size===1);
    const error=new ModelDownloadError('Remote cancellation unknown');error.remoteActive=true;f.controls.values().next().value!.reject(error);
    await manager.settle();expect(manager.state.busy).toBe(true);expect(manager.state.files.find(f=>f.id===upscaleModelFiles[0])?.status).toBe('reconnecting');
    manager.observeProviderStop(123,Date.now()+1000);expect(manager.state.busy).toBe(false);
  });
  it('reattaches a persisted file only on its original rental',async()=>{
    const id=upscaleModelFiles[0],f=await fixture({instanceId:123,endpoint:'http://127.0.0.1:8188',startedAt:1,files:[{id,status:'downloading',remoteActive:true,downloaded:10,percent:1,message:'',error:null}]});
    await manager.recoverPending();await f.until(()=>f.worker.mock.calls.length===1);
    expect(f.worker.mock.calls[0][1]).toBe(123);expect(f.worker.mock.calls[0][6]).toBe(true);
    f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);expect(manager.state.files.find(f=>f.id===id)?.status).toBe('installed');
  });
  it('checks a cancelled runtime after restart without running setup again',async()=>{
    const plan=moduleDownloadPlan('clarity'),f=await fixture({instanceId:123,endpoint:'http://127.0.0.1:8188',startedAt:1,cancelled:true,files:[],moduleSetup:{...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:[],status:'cancelled',message:'',error:null,updatedAt:1,activeRuntime:'clarity'}});
    manager.checkClarity=vi.fn(async()=>({ready:false,preparing:true,missing:[]}));manager.prepareClarity=vi.fn();
    await manager.recoverPending();expect(manager.state.busy).toBe(true);expect(f.worker).not.toHaveBeenCalled();
    await expect(manager.start([upscaleModelFiles[0]])).rejects.toThrow('confirm its status');
    manager.checkClarity=vi.fn(async()=>({ready:true,preparing:false,missing:[]}));await manager.recoverPending();
    expect(manager.state.busy).toBe(false);expect(manager.prepareClarity).not.toHaveBeenCalled();
  });
  it('queues a second module immediately and starts it only after the first settles',async()=>{
    const f=await fixture(),image=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false}),clarity=moduleDownloadPlan('clarity');
    manager.checkClarity=vi.fn(async()=>({ready:true,preparing:false,missing:[]}));manager.prepareClarity=vi.fn();
    await manager.prepareModule(image);await f.until(()=>f.controls.size===image.files.length);
    await manager.prepareModule(clarity);expect(manager.state.moduleQueue?.find(x=>x.key===clarity.key)?.status).toBe('queued');expect(manager.state.moduleSetup?.key).toBe(image.key);
    expect(f.worker.mock.calls.flatMap(c=>c[3])).toEqual(expect.arrayContaining(image.files));expect(f.worker.mock.calls.flatMap(c=>c[3]).some(x=>clarity.files.includes(x))).toBe(false);
    for(const id of image.files)f.controls.get(id)!.resolve();await f.until(()=>manager.state.moduleSetup?.key===clarity.key&&f.controls.size===image.files.length+clarity.files.length);
    for(const id of clarity.files)f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);
    expect(manager.state.moduleSetup?.status).toBe('complete');expect(manager.state.moduleSetup?.readyAt).toBeGreaterThanOrEqual(manager.state.moduleSetup!.filesReadyAt!);
  });
  it('pauses and cancels queued modules without cancelling the active transfers',async()=>{
    const f=await fixture(),image=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false}),clarity=moduleDownloadPlan('clarity');
    await manager.prepareModule(image);await f.until(()=>f.controls.size===image.files.length);await manager.prepareModule(clarity);
    await manager.moduleAction(clarity.key,'pause');expect(manager.state.moduleQueue?.find(x=>x.key===clarity.key)?.status).toBe('paused');
    expect(f.worker.mock.calls.every(c=>!c[4].aborted)).toBe(true);await manager.moduleAction(clarity.key,'cancel');
    for(const id of image.files)f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);
    expect(f.worker.mock.calls).toHaveLength(image.files.length);expect(manager.state.moduleQueue?.find(x=>x.key===clarity.key)?.status).toBe('cancelled');
  });
  it('deduplicates queued requests and reuses shared files when a different recipe follows',async()=>{
    const f=await fixture(),settings={...emptyImageEditDraft().settings,consistency:false,bfs:false,quality:'native' as const};
    const a=moduleDownloadPlan('image-edit',settings),b=moduleDownloadPlan('image-edit',{...settings,consistency:true});
    await manager.prepareModule(a);await f.until(()=>f.controls.size===a.files.length);await manager.prepareModule(b);await manager.prepareModule(b);
    expect(manager.state.moduleQueue?.filter(x=>x.key===b.key)).toHaveLength(1);
    for(const id of a.files)f.controls.get(id)!.resolve();await f.until(()=>f.controls.size===b.files.length);
    for(const id of b.files)f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);
    const requests=f.worker.mock.calls.flatMap(c=>c[3]);expect(new Set(requests).size).toBe(requests.length);expect(requests.sort()).toEqual([...b.files].sort());
  });
  it('keeps a paused setup inactive and resumes it explicitly on its bound GPU',async()=>{
    const plan=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false});
    const saved={instanceId:123,endpoint:'http://127.0.0.1:8188',moduleQueue:[{...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:plan.files,status:'paused',message:'Paused',error:null,updatedAt:1}]};
    const f=await fixture(saved);await manager.recoverPending();expect(f.worker).not.toHaveBeenCalled();expect(manager.state.busy).toBe(false);
    store.set('cloud-connected-instance',999);await expect(manager.moduleAction(plan.key,'resume')).rejects.toThrow('same GPU');expect(f.worker).not.toHaveBeenCalled();
    store.set('cloud-connected-instance',123);await manager.moduleAction(plan.key,'resume');await f.complete();expect(manager.state.moduleSetup?.status).toBe('complete');
  });
  it('restores an accepted queue without submitting anything on another rental',async()=>{
    const plan=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false});
    const item={...plan,instanceId:123,endpoint:'http://127.0.0.1:8188',transferFiles:plan.files,status:'queued',message:'Queued',error:null,updatedAt:1};
    const f=await fixture({moduleQueue:[item]});f.connection.status.state='offline';
    expect(manager.canReconnect('http://127.0.0.1:8188')).toBe(true);expect(manager.canReconnect('http://another:8188')).toBe(false);
    f.connection.status.state='online';store.set('cloud-connected-instance',999);await manager.recoverPending();expect(f.worker).not.toHaveBeenCalled();
    store.set('cloud-connected-instance',123);await manager.recoverPending();await f.complete();expect(manager.state.moduleSetup?.status).toBe('complete');
  });
  it('a confirmed provider stop pauses pending modules instead of starting another setup',async()=>{
    const f=await fixture(),image=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false});
    await manager.prepareModule(image);await f.until(()=>f.controls.size===image.files.length);await manager.prepareModule(moduleDownloadPlan('clarity'));
    manager.observeProviderStop(123,Date.now()+1000);await manager.settle();await f.until(()=>!manager.state.busy);
    expect(manager.state.moduleQueue?.find(x=>x.module==='clarity')?.status).toBe('paused');expect(f.worker.mock.calls).toHaveLength(image.files.length);
  });
  it('pauses active transfers, advances the queue and resumes only the paused module',async()=>{
    const f=await fixture(),image=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false}),clarity=moduleDownloadPlan('clarity');
    manager.checkClarity=vi.fn(async()=>({ready:true,preparing:false,missing:[]}));
    await manager.prepareModule(image);await f.until(()=>f.controls.size===image.files.length);await manager.prepareModule(clarity);
    await manager.moduleAction(image.key,'pause');await f.until(()=>manager.state.moduleSetup?.key===clarity.key&&f.controls.size===image.files.length+clarity.files.length);
    expect(manager.state.moduleQueue?.find(x=>x.key===image.key)?.status).toBe('paused');
    for(const id of clarity.files)f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);
    const before=f.worker.mock.calls.length;await manager.moduleAction(image.key,'resume');await f.until(()=>f.worker.mock.calls.length>before);
    for(const id of image.files)f.controls.get(id)!.resolve();await f.until(()=>!manager.state.busy);expect(manager.state.moduleSetup?.status).toBe('complete');
  });
  it('cannot advance a queued module while cancellation remains remotely unconfirmed',async()=>{
    const f=await fixture(),image=moduleDownloadPlan('image-edit',{...emptyImageEditDraft().settings,consistency:false,bfs:false});
    await manager.prepareModule(image);await f.until(()=>f.controls.size===image.files.length);await manager.prepareModule(moduleDownloadPlan('clarity'));
    const error=new ModelDownloadError('Cancellation unconfirmed');error.remoteActive=true;
    const [first,...others]=[...f.controls.values()];first.reject(error);for(const c of others)c.resolve();
    await manager.settle();await f.until(()=>manager.state.moduleSetup?.status==='reconnecting');
    expect(manager.state.busy).toBe(true);expect(f.worker.mock.calls).toHaveLength(image.files.length);
    expect(manager.state.moduleQueue?.find(x=>x.module==='clarity')?.status).toBe('queued');
  });

});
