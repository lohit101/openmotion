import { useState } from 'react';
import { ArrowClockwise, Clock, Pause, Play, X } from '@phosphor-icons/react';
import { moduleDownloadProgress, moduleNames } from '../shared/module-downloads';
import type { DownloadControls } from './ModelDownloads';
import { Button } from './ui/Button';
import './module-queue.css';

export default function ModuleSetupQueue({ controls }: { controls: DownloadControls }) {
  const [pending,setPending]=useState<string|null>(null),[error,setError]=useState('');
  const entries=(controls.state.moduleQueue||[controls.state.moduleSetup]).filter(item=>item&&!['complete','cancelled'].includes(item.status));
  if(!entries.length)return null;
  const action=async(key:string,value:'pause'|'resume'|'cancel')=>{setPending(key);setError('');try{await controls.moduleAction?.(key,value);}catch(reason){setError((reason as Error).message);}finally{setPending(null);}};
  return <section className="module-setup-queue" aria-label="Module setup queue"><header><h3>Setup queue</h3><span>{entries.length}</span></header>
    {entries.map(item=>{if(!item)return null;const p=moduleDownloadProgress(item,controls.state),paused=['paused','failed'].includes(item.status),running=['downloading','preparing','reconnecting'].includes(item.status)||!!item.activeRuntime;
      const settling=paused&&(!!item.activeRuntime||controls.state.moduleSetup?.key===item.key&&controls.state.busy);
      return <div className="module-setup-queue-row" key={item.key}><div className="module-queue-icon">{running?<ArrowClockwise size={16} className="instance-spin"/>:paused?<Pause size={16}/>:<Clock size={16}/>}</div><div className="module-queue-description"><strong>{moduleNames[item.module]}</strong><span>{settling?'Waiting for tool installation to finish':item.status==='downloading'?`Downloading · ${p.percent}%`:item.status==='preparing'?item.message:item.status==='queued'?'Queued':item.message||item.status}</span>{item.status==='downloading'&&<progress max={100} value={p.percent} aria-label={`${moduleNames[item.module]} download progress`}/>}</div>
        {controls.moduleAction&&<div className="module-queue-actions"><Button variant="ghost" size="icon" disabled={pending===item.key||settling||!controls.online} aria-label={`${paused?'Resume':'Pause'} ${moduleNames[item.module]} setup`} title={paused?'Resume setup':item.status==='preparing'?'Pause after the current tool installation':'Pause setup'} onClick={()=>void action(item.key,paused?'resume':'pause')}>{paused?<Play size={15}/>:<Pause size={15}/>}</Button><Button variant="ghost" size="icon" disabled={pending===item.key} aria-label={`Cancel ${moduleNames[item.module]} setup`} title="Cancel setup; keep files" onClick={()=>void action(item.key,'cancel')}><X size={15}/></Button></div>}
      </div>;})}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
