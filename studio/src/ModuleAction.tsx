import { Button } from './ui/Button';
import { useEffect, useId, useState } from 'react';
import { ArrowClockwise, CaretDown, CheckCircle, DownloadSimple, HardDrives, Pause, Plug, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { modelDefinitions, modelWorkingReserve } from '../shared/models';
import { moduleDownloadProgress, moduleNames, planFromRequest, type ModuleDownloadRequest } from '../shared/module-downloads';
import { modelSize, type DownloadControls } from './ModelDownloads';
import './module-action.css';

export default function ModuleAction({request,controls,runtimeReady=true,runtimeNotes=[],generateLabel='Generate',generateDisabled=false,submitting=false,onGenerate,onConnect,onManage,caption,unavailable,keyboardBlocked=false}:{
  request:ModuleDownloadRequest;controls:DownloadControls;runtimeReady?:boolean;runtimeNotes?:string[];generateLabel?:string;generateDisabled?:boolean;submitting?:boolean;
  onGenerate:()=>void;onConnect:()=>void;onManage:()=>void;caption?:string;unavailable?:string|null;keyboardBlocked?:boolean;
}){
  const [expanded,setExpanded]=useState(false),[starting,setStarting]=useState(false),[requestError,setRequestError]=useState('');
  const id=useId(),plan=planFromRequest(request),name=moduleNames[plan.module],progress=moduleDownloadProgress(plan,controls.state);
  const ready=!progress.missing.length&&runtimeReady;
  const ownSetup=progress.active||starting;
  const otherBusy=controls.state.busy&&!ownSetup;
  const free=controls.state.diskFreeBytes,required=progress.remaining+modelWorkingReserve(plan.files);
  const shortage=!progress.active&&progress.remaining>0&&free!==undefined&&free<required;
  const error=requestError||progress.scoped?.error||controls.state.error||'';
  useEffect(()=>{if(error||progress.failed||shortage)setExpanded(true);},[error,progress.failed,shortage]);
  useEffect(()=>{if(requestError&&(progress.active||ready))setRequestError('');},[progress.active,ready,requestError]);
  const download=async()=>{
    if(starting)return;setStarting(true);setRequestError('');
    try{if(controls.prepareModule)await controls.prepareModule(request);else controls.download(progress.missing);}
    catch(reason){setRequestError((reason as Error).message||'Could not confirm the download request. Reconnect to check progress.');}
    finally{setStarting(false);}
  };
  const disabled=starting||submitting||progress.active||controls.state.refreshing||!!unavailable||
    (controls.online?(ready?generateDisabled||controls.state.busy:controls.blocked||otherBusy||shortage):false);
  const click=()=>{if(disabled)return;if(!controls.online)onConnect();else if(ready)onGenerate();else void download();};
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(!keyboardBlocked&&!event.defaultPrevented&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();click();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  const runtimePercent=progress.scoped?.status==='preparing'?progress.scoped.runtimePercent:undefined;
  let label=!controls.online?(progress.active?'Reconnecting · '+progress.percent+'%':'Connect GPU'):submitting?'Submitting…':progress.reconnecting?'Reconnecting · '+progress.percent+'%':progress.scoped?.status==='preparing'?(runtimePercent===undefined?'Preparing tools':'Downloading tools · '+runtimePercent+'%'):ownSetup?'Downloading · '+progress.percent+'%':ready?generateLabel:(progress.failed?'Retry downloads':'Download '+name);
  if(controls.state.refreshing&&!ownSetup)label='Checking files…';
  const status=unavailable||(!controls.online?'Connect your GPU to continue.':progress.reconnecting?'Recovering progress from the same GPU. Partial files are retained.':progress.scoped?.status==='preparing'?progress.scoped.message:ownSetup?'Downloading selected files.':shortage?'More disk space is needed before downloading.':otherBusy?'Another GPU download or setup is in progress.':!ready?progress.missing.length?modelSize(progress.remaining)+' needed · only selected settings':'Model files are ready; runtime preparation is required.':caption||'Ready to generate');
  return <div className="generate-footer module-action" data-module={plan.module}>
    <div className="module-downloads"><button type="button" className="module-downloads-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>
      <HardDrives size={16}/><span>Downloads</span><small>{plan.files.length-progress.missing.length}/{plan.files.length} ready</small><CaretDown size={14} className={expanded?'expanded':''}/>
    </button>
      {expanded&&<div id={id} className="module-downloads-panel">
        <p className="module-downloads-intro">Files for the current {name} settings. Installed files are reused.</p>
        <ul>{plan.files.map(fileId=>{const definition=modelDefinitions.find(f=>f.id===fileId),file=controls.state.files.find(f=>f.id===fileId),installed=file?.status==='installed';return <li key={fileId}>
          <span className="module-file-icon">{installed?<CheckCircle size={16}/>:file?.status==='failed'?<WarningCircle size={16}/>:<DownloadSimple size={16}/>}</span>
          <div><strong>{definition?.label||fileId}</strong><span>{modelSize(definition?.size||0)} · {installed?'Installed':file?.status==='reconnecting'?'Reconnecting':file?.status==='downloading'?file.percent===null?'Connecting / verifying':file.percent+'%':file?.status==='queued'?'Queued':file?.status==='failed'?'Retry available':(file?.downloaded||0)>0?modelSize(file!.downloaded!)+' saved':'Needed'}</span>
            {file?.status==='downloading'&&<progress aria-label={(definition?.label||fileId)+' download'} max={100} value={file.percent??undefined}/>}
            {file?.error&&<p className="module-file-error">{file.error}</p>}
          </div></li>;})}</ul>
        {!!runtimeNotes.length&&<div className="module-runtime-notes"><strong>Required tools</strong>{runtimeNotes.map(note=><p key={note}>{note}</p>)}</div>}
        {shortage&&<p className="module-file-error" role="alert">Needs {modelSize(required)} free including working space; {modelSize(free!)} available. Remove unused extras or use a larger disk.</p>}
        {error&&<p className="module-file-error" role="alert">{error}</p>}
        <div className="module-downloads-actions"><button type="button" onClick={onManage}>Manage all downloads</button>
          {progress.active&&progress.scoped?.status!=='preparing'&&controls.cancel&&<button type="button" onClick={controls.cancel}><Pause size={13}/>Cancel downloads</button>}
          {progress.reconnecting&&controls.recover&&<button type="button" onClick={controls.recover}><ArrowClockwise size={13}/>Check status</button>}
          {!progress.active&&controls.refresh&&<button type="button" disabled={!controls.online||controls.state.refreshing} onClick={controls.refresh}><ArrowClockwise size={13}/>Sync files</button>}
        </div>
        <p className="module-downloads-billing">Downloads use the connected GPU’s disk. Its compute, storage and transfer rates apply. Selection starts no downloads.</p>
      </div>}
    </div>
    <div className="module-primary"><Button variant="primary" className={'primary-button generate module-primary-button'+(ownSetup?' is-downloading':'')} aria-label={label} aria-busy={ownSetup||submitting} disabled={disabled} onClick={click}>
      {ownSetup&&<span className={'module-primary-fill'+(progress.scoped?.status==='preparing'&&runtimePercent===undefined?' preparing':'')} aria-hidden="true" style={{transform:'scaleX('+(progress.scoped?.status==='preparing'?(runtimePercent??100)/100:progress.percent/100)+')'}}/>}
      <span className="module-primary-content">{!controls.online?<Plug size={19}/>:ready&&!ownSetup?<Sparkle size={19} weight="fill"/>:<DownloadSimple size={19}/>}<span>{label}</span>{!ownSetup&&!submitting&&<kbd>⌘ ↵</kbd>}</span>
    </Button>{ownSetup&&<span role="progressbar" aria-label={name+' model downloads'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.scoped?.status==='preparing'?runtimePercent:progress.percent} className="sr-only"/>}</div>
    <div className="generate-caption module-action-caption" role="status">{status}</div>
  </div>;
}
