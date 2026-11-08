import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Info, Sparkle, WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { nativeProgress, outputReady } from '../shared/generation-progress';
import { formatTime } from './components';
import { useOverallProgress } from './useGenerationProgress';
import './generation-progress.css';

const activeStates = ['queued', 'running', 'reconnecting'];

export function RenderProgressInsights({ job, kind, elapsed }: { job: Job; kind: 'photo' | 'video'; elapsed: number }) {
  const fraction = nativeProgress(job), [width, height] = outputDimensions(job);
  const count = fraction === null ? 'Waiting for a native counter' : job.progress.unit === 'bytes' ? `${(job.progress.value! / 1048576).toFixed(1)} / ${(job.progress.max! / 1048576).toFixed(1)} MB` : `${Math.round(job.progress.value!)} / ${job.progress.max} ${job.progress.unit}`;
  return <div className="render-progress-details"><div className="render-detail-stage"><span>Current stage</span><strong>{job.progress.stage}</strong>{job.error && <p role="alert">{job.error}</p>}<div className={`generation-stage-track ${fraction === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${job.progress.stage}: native stage progress`} aria-valuenow={fraction === null ? undefined : Math.floor(fraction * 100)} aria-valuemin={0} aria-valuemax={100}><span style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }} /></div><div className="render-stage-counter"><span>{count}</span><span>{fraction === null ? 'No counter yet' : `${Math.floor(fraction * 100)}% of ${job.upscale ? 'frames' : 'this stage'}`}</span></div></div><dl><div><dt>Elapsed</dt><dd>{formatTime(elapsed)}</dd></div><div><dt>Output</dt><dd>{width} × {height}</dd></div>{kind === 'video' && <><div><dt>Frame rate</dt><dd>{job.upscale?.fps || job.settings.fps} fps</dd></div>{job.upscale ? <div><dt>Frames processed on GPU</dt><dd>{job.progress.value || 0} / {job.upscale.frames}</dd></div> : <><div><dt>Segment</dt><dd>{job.progress.segment} of {job.progress.segments}</dd></div><div><dt>Frames saved locally</dt><dd>{job.progress.completedFrames} / {job.progress.targetFrames}</dd></div></>}</>}</dl>{job.viggleSegmentation && <p className="render-saved-note">{(job.progress.completedFrames / job.settings.fps).toFixed(2)}s of {(job.progress.targetFrames / job.settings.fps).toFixed(2)}s saved locally. Completed segments stay saved if the connection drops.</p>}<p className="render-progress-method">Overall progress estimates the full workflow from completed stages and native counters. It holds when work stalls; it is not an elapsed-time estimate. Stage counters above can restart between passes and segments.</p>{job.keyframe && <a className="secondary-button" href={`/api/jobs/${job.id}/keyframe`} target="_blank" rel="noreferrer">View conditioning frame</a>}</div>;
}

export default function GenerationProgress({ job, kind, online, onCancel, onResume, onReuse }: { job: Job; kind: 'photo' | 'video'; online: boolean; onCancel: () => void; onResume: () => void; onReuse?: () => void }) {
  const [details, setDetails] = useState(false), [now, setNow] = useState(Date.now());
  const infoButton = useRef<HTMLButtonElement>(null), backButton = useRef<HTMLButtonElement>(null), switched = useRef(false);
  const percent = useOverallProgress(job), ready = outputReady(job);
  const switchView = (value: boolean) => { switched.current = true; setDetails(value); };
  useEffect(() => { if (switched.current) (details ? backButton : infoButton).current?.focus(); }, [details]);
  useEffect(() => {
    if (!details) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [details]);
  const failed = ['failed', 'interrupted', 'cancelled'].includes(job.status);
  const stage = job.progress.stage.toLowerCase();
  const title = ready ? kind === 'video' ? 'Ready to play' : 'Your photo is ready' : job.status === 'queued' ? 'Waiting for the GPU' : job.status === 'reconnecting' ? 'Restoring your connection' : failed ? job.status === 'cancelled' ? 'Generation cancelled' : 'Your render needs attention' : /assembling|checking subject|preserving scene/.test(stage) ? 'Finishing your render' : /backing up|saving|downloading|recovering.*output/.test(stage) ? 'Saving your progress' : /preparing|starting|loading|uploading/.test(stage) ? 'Preparing your render' : job.upscale ? 'Upscaling your video' : `Creating your ${kind}`;
  const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
  const actions = <div className="generation-simple-actions">{activeStates.includes(job.status) && <button type="button" className="generation-cancel" onClick={onCancel}>{job.upscale ? 'Cancel upscale' : 'Cancel generation'}</button>}{job.status === 'interrupted' && <button type="button" className="primary-button compact" disabled={!online && !job.upscale && (kind === 'video' || !job.progress.completedFrames)} onClick={job.cancelRequested ? onCancel : onResume}>{job.cancelRequested ? 'Check cancellation' : job.retryRequired ? job.smoothMotion ? 'Retry finishing · uses GPU' : job.viggleRepaint?.activePhotoId ? 'Retry face refresh · uses GPU' : kind === 'video' ? 'Render missing segment again' : 'Generate missing image again' : 'Check & resume'}</button>}{failed && onReuse && <button type="button" className="secondary-button" onClick={onReuse}>Reuse settings</button>}</div>;
  return <div className={`generation-progress ${failed ? 'has-error' : ''} ${details ? 'showing-details' : ''}`}>
    {details ? <section className="generation-details-view" aria-label="Render details" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); switchView(false); } }}><header><button type="button" ref={backButton} className="render-details-back" onClick={() => switchView(false)} aria-label="Back to simple progress"><ArrowLeft size={15} />Back</button><h2>Render details</h2><span>{percent}% overall</span></header><RenderProgressInsights job={job} kind={kind} elapsed={elapsed} />{actions}</section> : <>
      {!failed && <div className="generation-ambience" aria-hidden="true"><img src={`/api/assets/${job.sourceId}/poster`} alt="" /><span className="generation-glow" /></div>}
      <button type="button" ref={infoButton} className="generation-info" aria-label="View render details" title="View render details" onClick={() => switchView(true)}><Info size={18} /></button>
      <div className="generation-simple"><div className="generation-sparkles" aria-hidden="true">{failed ? <WarningCircle size={30} weight="light" /> : <><Sparkle size={34} weight="light" /><Sparkle className="sparkle-small" size={13} weight="fill" /><Sparkle className="sparkle-tiny" size={8} weight="fill" /></>}</div><h2 aria-live="polite">{title}</h2>{failed ? <p className="generation-error" role={job.status === 'cancelled' ? 'status' : 'alert'}>{job.error || (job.status === 'cancelled' ? 'Your saved segments and settings are kept.' : job.progress.stage)}</p> : <div className="generation-percent" role="progressbar" aria-label="Overall generation progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>{percent}<span>%</span></div>}{job.status === 'queued' && <p className="generation-stage-label">Starts when your GPU is available</p>}{actions}</div>
    </>}
  </div>;
}
