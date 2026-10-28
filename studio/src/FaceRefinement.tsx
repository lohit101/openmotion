import { useEffect, useState } from 'react';
import { Sparkle, DownloadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { FaceSwapMethod, Job } from '../shared/types';
import { api, SmallSelect } from './components';
import { InfoTip } from './InfoTip';
import './face-refinement.css';
import { setFaceExecution, useFaceExecution, type FaceExecution } from './face-preferences';

type Tools = {ready:boolean;setup?:string;error?:boolean;gpu?:{ready?:boolean;available?:boolean;instanceId?:number;sourcePerformanceReady?:boolean}};
export function FaceRefinementAction({ job, select }: { job: Job; select?: (job: Job) => void }) {
  const [tools,setTools]=useState<Tools|null>(null),[pending,setPending]=useState(false),[settingUp,setSettingUp]=useState(false);
  const execution=useFaceExecution();
  const [method,setMethod]=useState<FaceSwapMethod>('direct');
  const gpu=execution==='remote CUDA';
  const refresh=async()=>{try{setTools(await api<Tools>('/video-identity'));}catch{setTools({ready:false,error:true});}};
  useEffect(()=>{let live=true;void api<Tools>('/video-identity').then(value=>{if(live)setTools(value);}).catch(()=>{if(live)setTools({ready:false,error:true});});return()=>{live=false;};},[]);
  const setup=async()=>{
    if(settingUp)return;setSettingUp(true);const updating=!!tools?.gpu?.ready,id=toast.loading(updating?'Updating GPU face tools':'Preparing GPU face refinement',{description:updating?'Syncing processing scripts. Installed models are reused.':'Installing a separate runtime and 1.29 GB of face models. Compute and transfer billing apply.'});
    try{await api('/video-identity/gpu/setup',{});await refresh();toast.success(updating?'GPU face tools updated':'GPU face refinement prepared',{id,description:'These files stay on this rental’s disk for future runs.'});}
    catch(error){toast.error('GPU face setup needs attention',{id,description:(error as Error).message});}finally{setSettingUp(false);}
  };
  const start=async()=>{
    if(pending)return;setPending(true);
    try{const result=await api<Job>(`/jobs/${job.id}/refine-face`,{execution,method});toast.success(result.status==='completed'?'Face swap is already saved':gpu?'Swapping the face on your GPU':'Swapping the face on this computer',{description:gpu?'Separate result. Your original video stays unchanged.':'Your original stays unchanged. GPU compute can remain stopped.',action:select?{label:'View',onClick:()=>select(result)}:undefined});if(select)select(result);}
    catch(error){toast.error('Face refinement could not start',{description:(error as Error).message});}finally{setPending(false);}
  };
  const ready=gpu?tools?.gpu?.ready && (method==='direct'||tools.gpu.sourcePerformanceReady):tools?.ready;
  return <div className="face-refinement-action"><SmallSelect label="Face refinement device" value={execution} disabled={pending||settingUp} onChange={value=>setFaceExecution(value as FaceExecution)} options={[{value:'remote CUDA',label:'GPU · CUDA'},{value:'local CPU',label:'This computer · CPU'}]} />
    <SmallSelect label="Face swap performance" value={method} disabled={pending||settingUp} onChange={value=>setMethod(value as FaceSwapMethod)} options={[{value:'direct',label:'Keep video expressions'},{value:'source-performance',label:'Source eyes & mouth · beta'}]} />
    {gpu && tools && !ready ? <button className="secondary-button" disabled={settingUp||!tools.gpu?.available} onClick={()=>void setup()}><DownloadSimple size={16}/>{settingUp?'Preparing GPU…':tools.gpu?.available?tools.gpu.ready?'Update face tools':'Prepare GPU · 1.29 GB':'Connect GPU to swap'}</button>:<button className="secondary-button" disabled={pending || !ready} onClick={()=>void start()}><Sparkle size={16}/>{pending?'Starting face swap…':!tools?'Checking tools…':'Swap face'}</button>}
    {!gpu && tools && !ready && <small>{tools.error?'Local tools unavailable':'Local setup required'}</small>}
    <InfoTip label="face refinement">Both options directly swap the face using this run’s fixed character reference. Keep video expressions preserves the generated performance. Source eyes & mouth additionally swaps that same identity onto the original prepared source, then transfers only its visible eye/mouth regions. This experimental route can improve source timing and gaze; it cannot guarantee perfect expression or identity fidelity. Poor source tracking, occlusion or mismatched head pose falls back to the direct identity swap and is reported in run details. The transferred features come from an identity-swapped source; feathered boundaries can retain source details. No audio-generated lip sync, automatic downloads or compute starts. Your original video stays unchanged.{!gpu && tools && !tools.ready?` Install once locally: ${tools.setup}.`:''}</InfoTip></div>;
}

export function FaceRefinementProgress({job}: {job: Job}) {
  const [pending,setPending]=useState(false);
  const gpu=job.faceRefinement?.execution==='remote CUDA';
  const active=['queued','running'].includes(job.status),failed=['interrupted','failed','cancelled'].includes(job.status);
  const percent=job.status==='completed'?100:Math.min(99,Math.floor(job.progress.completedFrames/Math.max(1,job.progress.targetFrames)*98));
  const act=async(action:'cancel'|'resume')=>{setPending(true);try{await api(`/jobs/${job.id}/${action}`,{});}catch(error){toast.error('Face refinement needs attention',{description:(error as Error).message});}finally{setPending(false);}};
  return <div className="face-refinement-progress"><Sparkle size={30} weight="light"/><span className="workspace-overline">{gpu?'GPU FACE REFINEMENT':'LOCAL FACE REFINEMENT'}</span><h2>{job.status==='queued'?gpu?'Waiting for GPU processing':'Waiting for local processing':failed?'Refinement paused':job.progress.stage}</h2>{!failed && <div className="face-refinement-percent" role="progressbar" aria-label="Face refinement progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>{percent}%</div>}<p>{job.progress.completedFrames} / {job.progress.targetFrames} frames · Original video preserved</p><p>{gpu?'Runs on your rented GPU. Saved frames stay there for resume; the completed video is downloaded to this Library.':'Runs on this computer. Your GPU can stay offline.'}</p>{job.error && <p className="error" role="alert">{job.error}</p>}<div>{active && <button className="secondary-button" disabled={pending} onClick={()=>void act('cancel')}>Cancel refinement</button>}{failed && <button className="secondary-button" disabled={pending} onClick={()=>void act('resume')}>{gpu?'Check & resume on GPU':'Resume locally'}</button>}</div></div>;
}
