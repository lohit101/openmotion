import { useEffect, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Job } from '../shared/types';
import { api } from './components';
import './face-refinement.css';

export function FaceRefinementProgress({job}: {job: Job}) {
  const [pending,setPending]=useState(false);
  const gpu=job.faceRefinement?.execution==='remote CUDA';
  const active=['queued','running'].includes(job.status),failed=['interrupted','failed','cancelled'].includes(job.status);
  const percent=job.status==='completed'?100:Math.min(99,Math.floor(job.progress.completedFrames/Math.max(1,job.progress.targetFrames)*98));
  const act=async(action:'cancel'|'resume')=>{setPending(true);try{await api(`/jobs/${job.id}/${action}`,{});}catch(error){toast.error('Face refinement needs attention',{description:(error as Error).message});}finally{setPending(false);}};
  return <div className="face-refinement-progress"><Sparkle size={30} weight="light"/><span className="workspace-overline">{gpu?'GPU FACE REFINEMENT':'LOCAL FACE REFINEMENT'}</span><h2>{job.status==='queued'?gpu?'Waiting for GPU processing':'Waiting for local processing':failed?'Refinement paused':job.progress.stage}</h2>{!failed && <div className="face-refinement-percent" role="progressbar" aria-label="Face refinement progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>{percent}%</div>}<p>{job.progress.completedFrames} / {job.progress.targetFrames} frames · Original video preserved</p><p>{gpu?'Runs on your rented GPU. Saved frames stay there for resume; the completed video is downloaded to this Library.':'Runs on this computer. Your GPU can stay offline.'}</p>{job.error && <p className="error" role="alert">{job.error}</p>}<div>{active && <button className="secondary-button" disabled={pending} onClick={()=>void act('cancel')}>Cancel refinement</button>}{failed && <button className="secondary-button" disabled={pending} onClick={()=>void act('resume')}>{gpu?'Check & resume on GPU':'Resume locally'}</button>}</div></div>;
}
