import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Catalog, Graph } from '../shared/types';
import { emptyModels, IMAGE_IDENTITY, modelDefinitions, modelWorkingReserve, pinnedModels, type InstalledLora, type ModelInventory, type ModelsState, type ModelTransfer, type ModelFileState, type ModuleDownloadPlan, type ModuleDownloadState } from '../shared/models';
import { inventoryKey } from '../shared/downloads';
import type { Store } from './store';
import { lorasFrom, type ConnectionManager } from './comfy';
import { command } from './media';
import { facialCommand } from './facial-consistency';
import type { FacialConsistencyRun } from '../shared/facial-consistency';
import { isBoundaryFacialVersion, isGeometryFacialVersion, isEyeFinishedFacialVersion, isCalibratedFacialVersion, isCleanupFacialVersion } from '../shared/facial-consistency';
const transferring=(file:ModelFileState)=>['queued','downloading','reconnecting'].includes(file.status);
export class ModelDownloadError extends Error { remoteActive=false; }

export async function manageModelStorage(repo: string, instanceId: number, action: 'inventory' | 'delete', name?: string): Promise<{ loras?: InstalledLora[]; files?: { id: string; size: number; verified?: boolean }[]; name?: string; freedBytes?: number; freeBytes?: number; partials?: { id: string; size: number }[]; removed?: boolean; facialRuntimeReady?: boolean; facialCleanupRuntimeReady?: boolean; facialCalibratedRuntimeReady?: boolean; facialEyeFinishRuntimeReady?: boolean; facialGeometryRuntimeReady?: boolean; facialBoundaryRuntimeReady?: boolean;facialPreparing?:boolean }> {
  const args = ['-u', path.join(repo, 'scripts/managed_models.py'), '--instance-id', String(instanceId), '--action', action];
  if (action === 'delete') args.push('--lora', name!);
  const output = await command('python3', args, undefined, 45000);
  const line = output.split(/\r?\n/).find(line => line.startsWith('RECAST_MODEL_STORAGE '));
  if (!line) throw new Error('The GPU did not return a model storage result.');
  return JSON.parse(line.slice(21));
}

export function missingPinnedAdapters(graph: Graph, catalog: Catalog): string[] {
  const installed = catalog.LoraLoaderModelOnly?.input.required?.lora_name?.[0];
  if (!Array.isArray(installed)) throw new Error('ComfyUI did not return its installed LoRA list.');
  const wanted = [...new Set(Object.values(graph).filter(node => ['LoraLoaderModelOnly', 'SwapOptionalLoRA'].includes(node.class_type))
    .map(node => String(node.inputs.lora_name)).filter(name => name !== 'None' && !installed.includes(name)))];
  const files = wanted.map(name => pinnedModels.find(file => file.destination === 'loras/' + name)?.destination);
  const unknown = wanted.filter((_, index) => !files[index]);
  if (unknown.length) throw new Error('Upload the selected custom LoRA before generating: ' + unknown.join(', '));
  return files as string[];
}

// No elapsed-time cutoff for a healthy transfer. The downloader provides
// bounded retries, resumable partials and pinned SHA256 verification.
export function downloadPinnedModels(repo: string, instanceId: number | null, endpoint: string, files: string[], signal: AbortSignal,
  progress: (message: string, percent?: number | null, transfer?: ModelTransfer) => void, recover=false,cancelOnly=false): Promise<void> {
  signal.throwIfAborted();
  if (!instanceId || endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU through GPU cloud before downloading models.');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-u', path.join(repo, 'scripts/managed_models.py'), '--instance-id', String(instanceId),
      '--model-files', JSON.stringify(files),...(recover?['--recover']:[]),...(cancelOnly?['--cancel-transfer']:[])], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let buffer = '', tail = '',stopped=false;
    const aborted = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Already finished. */ } };
    signal.addEventListener('abort', aborted, { once: true });
    const receive = (chunk: Buffer) => {
      buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        tail = line.slice(-900);
        if(line==='RECAST_MODEL_STOPPED'){stopped=true;continue;}
        if (line.startsWith('RECAST_MODEL_PROGRESS ')) {
          try {
            const event = JSON.parse(line.slice(22));
            if (!files.includes(event.destination) || !Number.isFinite(event.downloaded) || event.downloaded < 0 || event.downloaded > event.total || event.total !== pinnedModels.find(file => file.destination === event.destination)?.size) continue;
            progress(event.phase === 'verifying' ? 'Verifying SHA256' : event.phase === 'ready' ? 'File verified' : event.phase==='reconnecting'?'Reconnecting to the saved download':'Downloading model file',
              event.phase === 'verifying' ? null : Math.min(100, Math.max(0, Math.floor(100 * event.downloaded / event.total))),
              { downloaded: event.downloaded, total: event.total, bytesPerSecond: Number.isFinite(event.bytesPerSecond) && event.bytesPerSecond >= 0 ? event.bytesPerSecond : undefined,phase:event.phase,remoteActive:event.running===true });
          } catch { /* Ignore malformed telemetry; normal process exit still decides success. */ }
          continue;
        }
        const counter = line.match(/^\s+(.+\.safetensors): (\d+)%$/);
        if (counter) progress('Downloading ' + counter[1], Math.min(100, Number(counter[2])));
        else if (line.startsWith('RECAST_FACIAL_STAGE ')) progress(line.slice(20), null);
        else if (line.startsWith('Downloading ')) progress(line.slice(0, 220));
        else if (line.startsWith('Verified: ')) progress('File verified');
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const cleanup = () => signal.removeEventListener('abort', aborted);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); if (code===0&&!signal.aborted)resolve();else{const error=new ModelDownloadError(signal.aborted?(stopped?'Cancelled. Partial files are retained.':'Cancelled locally; the remote stop is unconfirmed. Reconnect to check the saved transfer.'):'Model download failed. Partial files are retained for retry. '+(buffer.trim()||tail).slice(-900));error.remoteActive=!stopped;reject(error);} });
    if (signal.aborted) aborted();
  });
}

export function installedModelIds(catalog: Catalog): Set<string> {
  const choices = new Set<string>();
  for (const node of Object.values(catalog)) for (const rule of Object.values({ ...node.input.required, ...node.input.optional })) {
    if (Array.isArray(rule[0])) for (const value of rule[0]) if (typeof value === 'string') choices.add(value);
  }
  return new Set(modelDefinitions.filter(file => choices.has(file.filename)).map(file => file.id));
}

type DownloadWorker = typeof downloadPinnedModels;
export class ModelManager {
  state: ModelsState = emptyModels();
  private queue = new Set<string>(); private controller: AbortController | null = null;
  private work: Promise<void> | null = null; private refreshing: Promise<ModelsState> | null = null;
  private preparing = 0; private cancelEpoch = 0;
  private moduleWork:Promise<void>|null=null;private recovering:Promise<void>|null=null;private cancelled=false;
  private recoveryTimer:ReturnType<typeof setInterval>|null=null;private disposed=false;
  private runtimeController:AbortController|null=null;
  preparingClarity=false;
  prepareClarity?:()=>Promise<{ready:boolean;preparing:boolean;missing:string[]}>;
  checkClarity?:()=>Promise<{ready:boolean;preparing:boolean;missing:string[]}>;
  private connectionEvent=(event:{type:string})=>{if(event.type==='connection'&&this.connection.status.state==='online')void this.recoverPending();};
  constructor(public store: Store, public connection: ConnectionManager, public repo: string, private download: DownloadWorker = downloadPinnedModels, private storage: typeof manageModelStorage = manageModelStorage) {
    this.state.inventories = store.value<ModelInventory[]>('model-inventories', []);
    const saved=store.value<{instanceId?:number;endpoint?:string;startedAt?:number;transferFiles?:string[];files?:ModelFileState[];moduleSetup?:ModuleDownloadState;cancelled?:boolean}>('model-download-state-v1',{});
    this.state.transferFiles=saved.transferFiles;this.state.transferStartedAt=saved.startedAt;this.state.transferInstanceId=saved.instanceId;this.state.transferEndpoint=saved.endpoint;this.cancelled=saved.cancelled===true;
    this.state.moduleSetup=saved.moduleSetup;
    for(const old of saved.files||[]){const file=this.state.files.find(f=>f.id===old.id);if(!file)continue;
      Object.assign(file,old,...(old.remoteActive?[{status:'reconnecting',message:'Checking the saved transfer after reconnecting.'}]:[]));
      if(transferring(file)&&(!this.cancelled||file.remoteActive))this.queue.add(file.id);
    }
    if(this.state.moduleSetup&&(['downloading','preparing','reconnecting'].includes(this.state.moduleSetup.status)||this.state.moduleSetup.activeRuntime))this.state.moduleSetup.status='reconnecting';
    this.syncBusy();store.on('event',this.connectionEvent);
  }
  private syncBusy(){this.state.busy=!!this.work||!!this.moduleWork||this.preparing>0||!!this.state.deleting||!!this.state.facialPreparing||this.queue.size>0||this.state.files.some(f=>f.remoteActive===true)||!!this.state.moduleSetup&&(['downloading','preparing','reconnecting'].includes(this.state.moduleSetup.status)||!!this.state.moduleSetup.activeRuntime);}
  emit() { this.syncBusy();this.store.set('model-download-state-v1',{instanceId:this.state.transferInstanceId,endpoint:this.state.transferEndpoint,startedAt:this.state.transferStartedAt,transferFiles:this.state.transferFiles,
    files:this.state.files.filter(f=>transferring(f)||f.status==='failed'),moduleSetup:this.state.moduleSetup,cancelled:this.cancelled});this.store.emit('event', { type: 'models', data: this.state }); }
  canReconnect(endpoint:string){return this.state.busy&&this.connection.status.state!=='online'&&this.state.transferEndpoint===endpoint&&this.state.transferInstanceId===this.store.value('cloud-connected-instance',null)&&!this.state.deleting;}
  dispose(){this.disposed=true;this.store.off('event',this.connectionEvent);if(this.recoveryTimer)clearInterval(this.recoveryTimer);}
  startRecoveryMonitor(){if(this.recoveryTimer)return;this.recoveryTimer=setInterval(()=>void this.recoverPending(),10000);this.recoveryTimer.unref();}
  private scopeMatches(){return this.state.transferInstanceId===this.store.value('cloud-connected-instance',null)&&this.state.transferEndpoint===this.connection.status.endpoint;}
  async recoverPending(){
    if(this.disposed||this.recovering||this.work||this.moduleWork||this.preparing)return;
    const pending=this.state.files.filter(f=>transferring(f)||f.remoteActive);
    const module=this.state.moduleSetup;
    if(module?.activeRuntime?.startsWith('local')&&this.cancelled){
      try{const busy=JSON.parse(await command('python3',[path.join(this.repo,'scripts/prepare_local_models.py'),module.activeRuntime,'--status'],undefined,15000)).preparing===true;if(!busy){delete module.activeRuntime;module.status='cancelled';this.emit();}}catch{/* Keep an unknown local setup protected. */}return;
    }
    if(!this.scopeMatches())return;
    if(!pending.length&&(!module||!['downloading','preparing','reconnecting'].includes(module.status)&&!module.activeRuntime))return;
    this.recovering=(async()=>{
      if(this.connection.status.state!=='online'){
        if(!await this.connection.recoverTransport())return;
      }
      if(!this.scopeMatches())return;
      if(module?.activeRuntime&&this.cancelled){
        let preparing=true;
        try{
          if(module.activeRuntime==='clarity')preparing=(await this.checkClarity!()).preparing;
          else if(module.activeRuntime.startsWith('facial:')){await this.refresh();preparing=!!this.state.error||!!this.state.facialPreparing;}
          else preparing=JSON.parse(await command('python3',[path.join(this.repo,'scripts/prepare_local_models.py'),module.activeRuntime,'--status'],undefined,15000)).preparing===true;
        }catch{/* An unknown setup must remain protected. */}
        if(!preparing){delete module.activeRuntime;module.status='cancelled';module.message='Cancelled. Existing files are kept.';module.error=null;this.emit();}
        return;
      }
      if(module&&!this.cancelled&&['downloading','preparing','reconnecting'].includes(module.status)){this.beginModule(module,true);return;}
      await this.start(pending.map(f=>f.id),true,true);
    })().catch(error=>{this.state.error=(error as Error).message;this.emit();}).finally(()=>{this.recovering=null;});
    await this.recovering;
  }
  observeProviderStop(instanceId:number,confirmedAt:number){
    if(instanceId!==this.state.transferInstanceId||!Number.isFinite(confirmedAt))return;
    if(!this.work&&!this.moduleWork&&!this.queue.size&&!this.state.facialPreparing&&!this.state.files.some(f=>f.remoteActive)&&!this.state.moduleSetup?.activeRuntime&&!this.state.moduleSetup?.status.match(/^(downloading|preparing|reconnecting)$/))return;
    const module=this.state.moduleSetup;if(confirmedAt<(this.state.transferStartedAt??Infinity))return;
    this.cancelled=true;this.cancelEpoch++;this.queue.clear();this.controller?.abort(new Error('The provider confirmed compute stopped.'));this.runtimeController?.abort();
    for(const f of this.state.files)if(transferring(f)||f.remoteActive)Object.assign(f,{remoteActive:false,status:'missing',message:'Compute stopped. Partial files are retained for an explicit retry.'});
    this.state.facialPreparing=false;
    if(module){if(!module.activeRuntime?.startsWith('local'))delete module.activeRuntime;if(['downloading','preparing','reconnecting'].includes(module.status))Object.assign(module,{status:'cancelled',message:'Compute stopped. Files are kept.',error:null});}
    this.emit();
  }
  async prepareModule(plan:ModuleDownloadPlan){
    if(this.moduleWork){if(this.state.moduleSetup?.key===plan.key)return this.state;throw new Error('Finish or cancel the current module download first.');}
    if(this.state.busy)throw new Error('Finish or check the existing transfers first.');
    const instanceId=this.store.value<number|null>('cloud-connected-instance',null),endpoint=this.connection.status.endpoint;
    if(!instanceId||this.connection.status.state!=='online'||endpoint!=='http://127.0.0.1:8188')throw new Error('Connect the managed GPU before downloading this module.');
    if(!plan.files.length||plan.files.some(id=>!modelDefinitions.some(f=>f.id===id)))throw new Error('This module includes an unavailable model.');
    this.cancelled=false;this.state.transferStartedAt=Date.now();this.state.transferInstanceId=instanceId;this.state.transferEndpoint=endpoint;
    const state:ModuleDownloadState={...plan,instanceId,endpoint,transferFiles:plan.files.filter(id=>this.state.files.find(f=>f.id===id)?.status!=='installed'),status:'downloading',message:'Checking files for these settings',error:null,updatedAt:Date.now()};
    this.state.moduleSetup=state;this.beginModule(state,false);return this.state;
  }
  private beginModule(state:ModuleDownloadState,recover:boolean){
    this.moduleWork=this.runModule(state,recover).finally(()=>{this.moduleWork=null;this.preparingClarity=false;this.emit();});this.emit();
  }
  private facialReady(version:FacialConsistencyRun['version']){
    const s=this.state;
    return (!isBoundaryFacialVersion(version)||s.facialBoundaryRuntimeReady)&&(!isGeometryFacialVersion(version)||s.facialGeometryRuntimeReady)&&
      (isEyeFinishedFacialVersion(version)?s.facialEyeFinishRuntimeReady:isCalibratedFacialVersion(version)?s.facialCalibratedRuntimeReady:isCleanupFacialVersion(version)?s.facialCleanupRuntimeReady:s.facialRuntimeReady);
  }
  private async runModule(state:ModuleDownloadState,recover:boolean){
    const assertScope=()=>{if(this.cancelled)throw new Error('Module download cancelled. Installed and partial files are kept.');if(!this.scopeMatches()||this.connection.status.state!=='online')throw new Error('Reconnect the original GPU to finish the selected module setup.');};
    try{
      assertScope();await this.start(state.files,recover,true);await this.work;assertScope();
      const missing=state.files.filter(id=>this.state.files.find(f=>f.id===id)?.status!=='installed');
      if(missing.length)throw new Error(this.state.files.find(f=>missing.includes(f.id)&&f.error)?.error||'Some files are not ready. Retry downloads to resume partial files.');
      Object.assign(state,{status:'preparing',message:'Preparing required tools',updatedAt:Date.now()});this.emit();
      for(const runtime of state.runtimes){
        delete state.runtimePercent;
        state.activeRuntime=runtime;this.emit();
        assertScope();
        if(runtime.startsWith('facial:')){
          const version=runtime.slice(7)as FacialConsistencyRun['version'];await this.refresh();assertScope();
          while(this.state.facialPreparing){state.message='Waiting for the existing facial-tool setup';this.emit();await new Promise(r=>setTimeout(r,2000));await this.refresh();assertScope();}
          if(!this.facialReady(version)){
            if(recover)throw new Error('Facial setup was interrupted. Retry to finish preparing the existing files.');
            state.message='Preparing facial tools · installed weights are reused';this.emit();await this.prepareFacialTools(version,true);
          }
          if(!this.facialReady(version))throw new Error('The selected facial tools are not ready. Retry setup.');
        }else if(runtime==='clarity'){
          this.preparingClarity=true;if(!this.checkClarity||!this.prepareClarity)throw new Error('Clarity preparation is unavailable.');
          let tools=await this.checkClarity();
          while(tools.preparing){state.message='Preparing Clarity runtime';this.emit();await new Promise(r=>setTimeout(r,2000));assertScope();tools=await this.checkClarity();}
          if(!tools.ready){if(recover)throw new Error('Clarity setup was interrupted. Retry to finish preparing the existing files.');state.message='Preparing Clarity runtime · installed weights are reused';this.emit();tools=await this.prepareClarity();}
          if(!tools.ready)throw new Error(tools.missing.join(', ')||'Clarity runtime is not ready.');
        }else if(['localIdentity','localPose'].includes(runtime)){
          state.message=runtime==='localIdentity'?'Preparing optional identity tools on this computer':'Preparing optional pose tools on this computer';this.emit();
          await this.prepareLocal(runtime as 'localIdentity'|'localPose');
        }
        delete state.activeRuntime;
      }
      assertScope();Object.assign(state,{status:'complete',message:'Ready for these settings',error:null,updatedAt:Date.now()});
    }catch(error){
      let runtimeUnknown=!!state.activeRuntime&&this.connection.status.state!=='online';
      if(state.activeRuntime==='clarity'&&this.checkClarity){try{runtimeUnknown=(await this.checkClarity()).preparing;}catch{runtimeUnknown=true;}}
      if(state.activeRuntime?.startsWith('facial:')){await this.refresh();runtimeUnknown=!!this.state.error||!!this.state.facialPreparing;}
      const unknown=this.state.files.some(f=>state.files.includes(f.id)&&f.remoteActive)||this.state.facialPreparing||runtimeUnknown;
      if(!unknown)delete state.activeRuntime;
      Object.assign(state,{status:this.cancelled?'cancelled':unknown?'reconnecting':'failed',message:unknown?'Reconnecting to the existing setup':(error as Error).message,error:(error as Error).message,updatedAt:Date.now()});
    }
  }
  private async prepareLocal(kind:'localIdentity'|'localPose'){
    const file=path.join(this.repo,kind==='localIdentity'?'scripts/local_identity.py':'scripts/local_pose.py');
    const current=JSON.parse(await command('python3',[file,'status'],undefined,15000));
    if(!current.ready)await new Promise<void>((resolve,reject)=>{
      const child=spawn('python3',['-u',path.join(this.repo,'scripts/prepare_local_models.py'),kind],{stdio:['ignore','pipe','pipe']});let tail='',buffer='';
      child.stdout.on('data',chunk=>{buffer+=chunk.toString();const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)if(line.startsWith('RECAST_LOCAL_MODEL_PROGRESS '))try{const value=JSON.parse(line.slice(28));if(Number.isFinite(value.downloaded)&&value.total>0&&value.downloaded>=0&&value.downloaded<=value.total&&this.state.moduleSetup?.status==='preparing'){this.state.moduleSetup.runtimePercent=Math.min(99,Math.floor(value.downloaded/value.total*100));this.emit();}}catch{/* Ignore malformed telemetry. */}});child.stderr.on('data',chunk=>{tail=(tail+chunk).slice(-1500);});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(tail||'Optional local setup failed. Partial files are kept.')));
    });
    const ready=JSON.parse(await command('python3',[file,'status'],undefined,15000)).ready===true;
    if(kind==='localIdentity')this.state.localIdentityReady=ready;else this.state.localPoseReady=ready;
    if(!ready)throw new Error('The selected local runtime is not ready. Retry setup.');
  }
  async refresh(): Promise<ModelsState> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.state.refreshing = true; this.emit();
      try {
        const image=this.store.imageDraft().settings;
        for(const [kind,needed,file]of [['localIdentity',image.localIdentity,'local_identity.py'],['localPose',image.qwenRecipe==='body-identity'&&image.qwenBodyPose||image.qwenRecipe==='body-only'&&image.bodyOnlyStrategy==='staged'&&image.bodyOnlyPose,'local_pose.py']]as const){
          if(needed||this.state.moduleSetup?.runtimes.includes(kind)){
            try{const ready=JSON.parse(await command('python3',[path.join(this.repo,'scripts',file),'status'],undefined,15000)).ready===true;if(kind==='localIdentity')this.state.localIdentityReady=ready;else this.state.localPoseReady=ready;}catch{if(kind==='localIdentity')this.state.localIdentityReady=false;else this.state.localPoseReady=false;}
          }
        }
        if (this.connection.status.state !== 'online') {
          for (const file of this.state.files) if (!transferring(file)) Object.assign(file, { status: 'unknown', percent: null });
          this.state.error = null; this.state.checkedAt = null; this.state.installedLoras = []; this.state.diskFreeBytes = undefined; return this.state;
        }
        const instanceId = this.store.value<number | null>('cloud-connected-instance', null), endpoint = this.connection.status.endpoint;
        const catalog: Catalog = await this.connection.client().json('/object_info');
        const sameConnection = () => this.connection.status.state === 'online' && this.connection.status.endpoint === endpoint && this.store.value('cloud-connected-instance', null) === instanceId;
        if (!sameConnection()) throw new Error('The GPU changed during the inventory check. Refresh its files again.');
        const installed = installedModelIds(catalog);
        for (const file of this.state.files) if (!transferring(file)) {
          if (installed.has(file.id)) Object.assign(file, { status: 'installed', percent: 100, error: null, message: 'Available on this GPU' });
          else if (file.status !== 'failed') Object.assign(file, { status: 'missing', percent: null, message: '', downloaded: 0 });
        }
        this.connection.catalog = catalog;
        let inventory: Awaited<ReturnType<typeof manageModelStorage>> | undefined;
        if (instanceId && this.connection.status.endpoint === 'http://127.0.0.1:8188') {
          const result = await this.storage(this.repo, instanceId, 'inventory');
          inventory = result;
          this.state.installedLoras = result.loras || [];
          this.state.diskFreeBytes = Number.isFinite(result.freeBytes) && result.freeBytes! >= 0 ? result.freeBytes : undefined;
          this.state.facialPreparing=!!result.facialPreparing;
          this.state.facialRuntimeReady = !!result.facialRuntimeReady;
          this.state.facialCleanupRuntimeReady = !!result.facialCleanupRuntimeReady;
          this.state.facialCalibratedRuntimeReady = !!result.facialCalibratedRuntimeReady;
          this.state.facialEyeFinishRuntimeReady = !!result.facialEyeFinishRuntimeReady;
          this.state.facialGeometryRuntimeReady = !!result.facialGeometryRuntimeReady;
          this.state.facialBoundaryRuntimeReady = !!result.facialBoundaryRuntimeReady;
          for (const file of this.state.files.filter(item => (item.id.startsWith('face_consistency/') || item.id.startsWith('upscale/')))) {
            if (transferring(file)) continue;
            const present = result.files?.find(item => item.id === file.id);
            if (present?.verified && present.size === pinnedModels.find(item => item.destination === file.id)?.size) Object.assign(file, { status: 'installed', percent: 100, error: null, message: 'Verified on this GPU' });
          }
          if (result.partials) for (const file of this.state.files) if (file.status!=='installed'&&!transferring(file)) {
            const size = result.partials.find(partial => partial.id === file.id)?.size || 0;
            file.downloaded = Number.isFinite(size) && size >= 0 ? Math.min(size, pinnedModels.find(model => model.destination === file.id)!.size) : 0;
          }
        }
        if (!sameConnection()) throw new Error('The GPU changed during the inventory check. Refresh its files again.');
        const loras = lorasFrom(catalog);
        if (JSON.stringify(loras) !== JSON.stringify(this.connection.status.loras)) { this.connection.status.loras = loras; this.connection.emit(); }
        this.state.error = null; this.state.checkedAt = new Date().toISOString();
        // A saved inventory is informational. It never makes an offline GPU
        // ready or authorizes downloads on another rental.
        if (this.connection.status.state === 'online' && this.connection.status.endpoint === endpoint && this.store.value('cloud-connected-instance', null) === instanceId) {
          const files = new Map<string, { id: string; size: number; partialSize: number; measured: boolean }>();
          for (const id of installed) files.set(id, { id, size: pinnedModels.find(file => file.destination === id)!.size, partialSize: 0, measured: false });
          for (const file of inventory?.files || []) if (Number.isFinite(file.size) && file.size >= 0) files.set(file.id, { id: file.id, size: file.size, partialSize: 0, measured: true });
          for (const lora of inventory?.loras || []) files.set('loras/' + lora.name, { id: 'loras/' + lora.name, size: lora.size, partialSize: lora.partialSize || 0, measured: true });
          for (const partial of inventory?.partials || []) {
            const file = files.get(partial.id) || { id: partial.id, size: 0, partialSize: 0, measured: true };
            file.partialSize = partial.size; files.set(file.id, file);
          }
          const snapshot: ModelInventory = { key: inventoryKey(instanceId, endpoint), instanceId, endpoint, gpu: this.connection.status.gpu || null,
            checkedAt: this.state.checkedAt, files: [...files.values()], freeBytes: this.state.diskFreeBytes };
          this.state.inventories = [snapshot, ...(this.state.inventories || []).filter(item => item.key !== snapshot.key)];
          this.store.set('model-inventories', this.state.inventories);
        }
      } catch (error) {
        this.state.error = 'Model availability could not be checked. Reconnect the GPU and refresh. ' + (error as Error).message;
        for (const file of this.state.files) if (!transferring(file)) file.status = 'unknown';
      } finally { this.state.refreshing = false; this.emit(); }
      return this.state;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async start(files: string[], recovery=false, owned=false) {
    if(!owned&&(this.moduleWork||this.state.moduleSetup?.activeRuntime||this.state.facialPreparing))throw new Error('Wait for the current module setup to finish or confirm its status before downloading other files.');
    if (this.state.deleting) throw new Error('Wait for the LoRA removal to finish.');
    if (!files.length || files.length > modelDefinitions.length || files.some(id => !modelDefinitions.some(file => file.id === id))) throw new Error('Choose known model files from the download list.');
    if (this.connection.status.state !== 'online') throw new Error('Connect a running GPU before downloading models.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null), endpoint = this.connection.status.endpoint;
    if (!instanceId || endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU through GPU cloud before downloading models.');
    if(this.state.files.some(f=>f.remoteActive)||this.queue.size){if(this.state.transferInstanceId!==instanceId||this.state.transferEndpoint!==endpoint)throw new Error('Reconnect the original GPU to check pending downloads first.');}
    if(!this.work&&!this.moduleWork&&!this.queue.size&&!this.state.files.some(f=>f.remoteActive))this.state.transferStartedAt=Date.now();
    this.state.transferInstanceId=instanceId;this.state.transferEndpoint=endpoint;
    if(!recovery)this.cancelled=false;
    const epoch = this.cancelEpoch;
    this.preparing++; this.state.busy = true; this.emit();
    try {
      await this.refresh(); if (this.state.error) throw new Error(this.state.error);
      if (epoch !== this.cancelEpoch) throw new Error('Download request cancelled.');
      if (this.connection.status.state !== 'online' || this.store.value('cloud-connected-instance', null) !== instanceId) throw new Error('The GPU connection changed. Reconnect before downloading.');
      const planned = new Set([...files, ...this.queue, ...this.state.files.filter(transferring).map(file => file.id)]);
      this.state.transferFiles=[...new Set([...(this.work?this.state.transferFiles||[]:[]),...this.state.files.filter(file=>planned.has(file.id)&&file.status!=='installed').map(file=>file.id)])];
      const remaining = this.state.files.filter(file => planned.has(file.id) && file.status !== 'installed').reduce((sum, file) => {
        const size = pinnedModels.find(model => model.destination === file.id)!.size;
        return sum + size - Math.min(size, Math.max(0, file.downloaded || 0));
      }, 0);
      const required = remaining + modelWorkingReserve([...planned]);
      if (remaining && this.state.diskFreeBytes !== undefined && this.state.diskFreeBytes < required) throw new Error(`These files need ${(required / 1e9).toFixed(2)} GB free including working space; this GPU has ${(this.state.diskFreeBytes / 1e9).toFixed(2)} GB. No new download was started. Use a larger disk or remove unused extras first.`);
      for (const id of files) {
        const file = this.state.files.find(file => file.id === id)!;
        if(file.status==='installed')continue;
        if(transferring(file)){if(!this.work)this.queue.add(id);continue;}
        Object.assign(file, { status: 'queued', percent: null, error: null, message: 'Waiting to download' }); this.queue.add(id);
      }
      if (this.queue.size && !this.work) {
        this.controller = new AbortController(); this.state.busy = true;
        const signal = this.controller.signal;
        const worker = async () => {
          while (this.queue.size && !signal.aborted) {
            const id = this.queue.values().next().value!; this.queue.delete(id);
            const file = this.state.files.find(file => file.id === id)!;
            const recoverFile=file.remoteActive===true;
            Object.assign(file, { status:recoverFile?'reconnecting':'downloading',remoteActive:true,message:recoverFile?'Reconnecting to the saved download':'Connecting to download',percent:recoverFile?file.percent:null }); this.emit();
            const warning = setTimeout(() => { file.message = 'Taking longer than usual. Download is still running.'; this.emit(); }, 15 * 60000);
            try {
              await this.download(this.repo, instanceId, endpoint, [id], signal, (message, percent, transfer) => {
                if (signal.aborted) return;
                file.message = message; if (percent !== undefined) file.percent = percent; if (transfer) {Object.assign(file, transfer);file.status=transfer.phase==='reconnecting'?'reconnecting':'downloading';if(transfer.phase!=='reconnecting')file.error=null;} this.emit();
              },recoverFile,this.cancelled);
              Object.assign(file, {status:this.cancelled?'missing':'installed',remoteActive:false,percent:this.cancelled?null:100,message:this.cancelled?'Cancelled. Partial files are retained.':'Downloaded and SHA256 verified',error:null});
            } catch (error) {
              const unknown=(error as ModelDownloadError).remoteActive===true;
              Object.assign(file,{status:unknown?'reconnecting':signal.aborted?'missing':'failed',remoteActive:unknown,percent:unknown?file.percent:null,message:unknown?'Waiting to verify the saved transfer.':signal.aborted?'Cancelled. Partial files are kept for resume.':'Download failed',error:unknown||( !signal.aborted)?(error as Error).message:null});
            } finally { clearTimeout(warning); this.emit(); }
          }
        };
        this.work = Promise.all([worker(), worker(), worker(), worker()]).then(async () => {
          this.controller = null; this.work = null;this.syncBusy();await this.refresh();
        });
      }
      this.emit(); return this.state;
    } finally { this.preparing--; this.syncBusy();this.emit(); }
  }
  async cancel() {
    this.cancelEpoch++;this.cancelled=true;this.runtimeController?.abort();
    if(this.state.moduleSetup&&['downloading','preparing','reconnecting'].includes(this.state.moduleSetup.status)){this.state.moduleSetup.status='cancelled';this.state.moduleSetup.message='Cancellation requested. Installed and partial files are retained.';}
    this.queue.clear(); this.controller?.abort(new Error('Cancelled.'));
    for (const file of this.state.files) if (file.status === 'queued') Object.assign(file, { status: 'missing', message: 'Cancelled. Click download to resume.', percent: null });
    this.emit();
    await this.work; this.emit(); return this.state;
  }
  async prepareFacialTools(version: FacialConsistencyRun['version'] = 'source-face-v6',owned=false) {
    if (this.state.busy&&!owned) throw new Error('Wait for model storage work to finish.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null);
    if (!instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU before preparing facial tools.');
    this.preparing++; this.state.busy = true; this.emit();
    try {
      this.runtimeController=new AbortController();
      await facialCommand(this.repo, ['--instance-id', String(instanceId), '--action', 'prepare', '--version', version,'--tracked-setup'],this.runtimeController.signal);
      if (this.store.value('cloud-connected-instance', null) !== instanceId) throw new Error('GPU changed during facial-tool setup.');
      await this.refresh(); return this.state;
    } finally { this.runtimeController=null;this.preparing--; this.syncBusy();this.emit(); }
  }
  async settle(){await this.work;}
  async remove(name: string) {
    if (this.state.busy) throw new Error('Finish or cancel active transfers before removing a LoRA.');
    if (!name || name.length > 300 || /[\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || !name.endsWith('.safetensors')) throw new Error('Choose a valid LoRA filename.');
    const instanceId = this.store.value<number | null>('cloud-connected-instance', null);
    if (!instanceId || this.connection.status.state !== 'online' || this.connection.status.endpoint !== 'http://127.0.0.1:8188') throw new Error('Connect the managed GPU before removing LoRAs.');
    this.state.busy = true; this.state.deleting = name; this.emit();
    try {
      const result = await this.storage(this.repo, instanceId, 'delete', name);
      if (result.name !== name || !Number.isFinite(result.freedBytes) || result.freedBytes! < 0) throw new Error('The GPU did not confirm this LoRA removal. Refresh its storage before retrying.');
      const draft = this.store.draft();
      if (draft.settings.loraA === name) draft.settings.loraA = 'None';
      if (draft.settings.loraB === name) draft.settings.loraB = 'None';
      this.store.set('draft', draft);
      if (name === IMAGE_IDENTITY) { const imageDraft = this.store.imageDraft(); imageDraft.settings.identityRefine = false; this.store.set('image-draft', imageDraft); }
      const file = this.state.files.find(file => file.id === 'loras/' + name);
      if (file) Object.assign(file, { status: 'missing', percent: null, message: '', error: null });
      this.store.emit('event', { type: 'lora-removed', data: result });
      if (this.refreshing) await this.refreshing;
      await this.refresh(); return { ...result, models: this.state };
    } finally { this.state.busy = false; this.state.deleting = null; this.emit(); }
  }
}
