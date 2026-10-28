import { useEffect, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Job } from '../shared/types';
import { api } from './components';
import { InfoTip } from './InfoTip';
import './face-refinement.css';

export function FaceRefinementAction({ job, select }: { job: Job; select?: (job: Job) => void }) {
  const [tools,setTools]=useState<{ready:boolean;setup?:string;error?:boolean}|null>(null),[pending,setPending]=useState(false);
  useEffect(()=>{let live=true;void api<{ready:boolean;setup:string}>('/video-identity').then(value=>{if(live)setTools(value);}).catch(()=>{if(live)setTools({ready:false,error:true});});return()=>{live=false;};},[]);
  const start=async()=>{
    if(pending)return;setPending(true);
    try{const result=await api<Job>(`/jobs/${job.id}/refine-face`,{});toast.success(result.status==='completed'?'Face refinement is already saved':'Refining the face on this computer',{description:'Your original video stays unchanged. GPU compute can remain stopped.',action:select?{label:'View',onClick:()=>select(result)}:undefined});if(select)select(result);}
    catch(error){toast.error('Face refinement could not start',{description:(error as Error).message});}finally{setPending(false);}
  };
  return <div className="face-refinement-action"><button className="secondary-button" disabled={pending || !tools?.ready} onClick={()=>void start()}><Sparkle size={16}/>{pending?'Starting local refinement…':!tools?'Checking local tools…':'Refine face'}</button>{tools && !tools.ready && <small>{tools.error?'Local tools unavailable':'Local setup required'}</small>}<InfoTip label="face refinement">Correct the visible face in every saved frame using this run’s character reference. Limits changes to a small facial area before video encoding. Creates a separate video locally; no GPU or Qwen download. Extreme angles and covered faces still need review.{tools?.error ? ' Local tools could not be checked; reopen this run to retry.' : tools && !tools.ready ? ` Install once on this computer: ${tools.setup}.` : ''}</InfoTip></div>;
}

export function FaceRefinementProgress({job}: {job: Job}) {
  const [pending,setPending]=useState(false);
  const active=['queued','running'].includes(job.status),failed=['interrupted','failed','cancelled'].includes(job.status);
  const percent=job.status==='completed'?100:Math.min(99,Math.floor(job.progress.completedFrames/Math.max(1,job.progress.targetFrames)*98));
  const act=async(action:'cancel'|'resume')=>{setPending(true);try{await api(`/jobs/${job.id}/${action}`,{});}catch(error){toast.error('Local refinement needs attention',{description:(error as Error).message});}finally{setPending(false);}};
  return <div className="face-refinement-progress"><Sparkle size={30} weight="light"/><span className="workspace-overline">LOCAL FACE REFINEMENT</span><h2>{job.status==='queued'?'Waiting for local processing':failed?'Refinement paused':job.progress.stage}</h2>{!failed && <div className="face-refinement-percent" role="progressbar" aria-label="Face refinement progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>{percent}%</div>}<p>{job.progress.completedFrames} / {job.progress.targetFrames} frames · Original video preserved</p><p>Runs on this computer. Your GPU can stay offline.</p>{job.error && <p className="error" role="alert">{job.error}</p>}<div>{active && <button className="secondary-button" disabled={pending} onClick={()=>void act('cancel')}>Cancel refinement</button>}{failed && <button className="secondary-button" disabled={pending} onClick={()=>void act('resume')}>Resume locally</button>}</div></div>;
}
