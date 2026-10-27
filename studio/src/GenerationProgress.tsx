import { useEffect, useState } from 'react';
import { Info, Sparkle, WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { formatTime, Modal } from './components';
import './generation-progress.css';

const activeStates = ['queued', 'running', 'reconnecting'];

export default function GenerationProgress({ job, kind, online, onCancel, onResume, onReuse }: { job: Job; kind: 'photo' | 'video'; online: boolean; onCancel: () => void; onResume: () => void; onReuse?: () => void }) {
  const [details, setDetails] = useState(false), [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!details) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [details]);
  const failed = ['failed', 'interrupted', 'cancelled'].includes(job.status);
  const hasCounter = job.progress.max !== null && job.progress.value !== null && Number.isFinite(job.progress.max) && Number.isFinite(job.progress.value) && job.progress.max > 0;
  // This is the current native stage/transfer counter, never an invented total ETA.
  const percent = job.status === 'queued' ? 0 : hasCounter ? Math.min(100, Math.max(0, Math.floor(job.progress.value! / job.progress.max! * 100))) : null;
  const stage = job.progress.stage.toLowerCase();
  const title = job.status === 'queued' ? 'Waiting for the GPU' : job.status === 'reconnecting' ? 'Restoring your connection' : failed ? job.status === 'cancelled' ? 'Generation cancelled' : 'Your render needs attention' : /backing up|saving|downloading|recovering.*output/.test(stage) ? 'Saving your progress' : /preparing|starting|loading|uploading/.test(stage) ? 'Preparing your render' : `Creating your ${kind}`;
  const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
  const [width, height] = outputDimensions(job);
  const count = hasCounter ? job.progress.unit === 'bytes' ? `${(job.progress.value! / 1048576).toFixed(1)} / ${(job.progress.max! / 1048576).toFixed(1)} MB` : `${Math.round(job.progress.value!)} / ${job.progress.max} ${job.progress.unit}` : 'Waiting for a native counter';
  return <div className={`generation-progress ${failed ? 'has-error' : ''} ${job.status === 'queued' ? 'is-queued' : ''}`}>
    {!failed && <div className="generation-ambience" aria-hidden="true"><img src={`/api/assets/${job.sourceId}/poster`} alt="" /><span className="generation-glow" /></div>}
    <button type="button" className="generation-info" aria-label="View render details" title="View render details" onClick={() => setDetails(true)}><Info size={18} /></button>
    <div className="generation-simple"><div className="generation-sparkles" aria-hidden="true">{failed ? <WarningCircle size={30} weight="light" /> : <><Sparkle size={34} weight="light" /><Sparkle className="sparkle-small" size={13} weight="fill" /><Sparkle className="sparkle-tiny" size={8} weight="fill" /></>}</div>
      <h2 aria-live="polite">{title}</h2>
      {failed ? <p className="generation-error" role={job.status === 'cancelled' ? 'status' : 'alert'}>{job.error || (job.status === 'cancelled' ? 'Your saved segments and settings are kept.' : job.progress.stage)}</p> : <><div className={`generation-percent ${percent === null ? 'without-counter' : ''}`}>{percent === null ? 'Processing' : <>{percent}<span>%</span></>}</div><div className={`generation-simple-track ${percent === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${job.progress.stage}: current stage`} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={percent === null ? undefined : { transform: `scaleX(${percent / 100})` }} /></div><p className="generation-stage-label">{job.status === 'queued' ? 'Starts when your GPU is available' : <>{kind === 'video' && job.progress.segments > 1 && `Segment ${job.progress.segment} of ${job.progress.segments} · `}{percent === null ? 'Waiting for live progress' : job.progress.unit === 'bytes' ? 'Transfer progress' : 'Stage progress'}</>}</p></>}
      <div className="generation-simple-actions">{activeStates.includes(job.status) && <button type="button" className="generation-cancel" onClick={onCancel}>Cancel generation</button>}{job.status === 'interrupted' && <button type="button" className="primary-button compact" disabled={!online && (kind === 'video' || !job.progress.completedFrames)} onClick={job.cancelRequested ? onCancel : onResume}>{job.cancelRequested ? 'Check cancellation' : job.retryRequired ? kind === 'video' ? 'Render missing segment again' : 'Generate missing image again' : 'Check & resume'}</button>}{failed && onReuse && <button type="button" className="secondary-button" onClick={onReuse}>Reuse settings</button>}</div>
    </div>
    <Modal open={details} onOpenChange={setDetails} title="Render details" description="Live counters from the current run. Stage percentages may restart when a new pass, segment or transfer begins.">
      <div className="render-progress-details"><div className="render-detail-stage"><span>Current stage</span><strong>{job.progress.stage}</strong>{job.error && <p role="alert">{job.error}</p>}</div><dl><div><dt>Stage counter</dt><dd>{count}</dd></div><div><dt>Elapsed</dt><dd>{formatTime(elapsed)}</dd></div><div><dt>Output</dt><dd>{width} × {height}</dd></div>{kind === 'video' && <><div><dt>Frame rate</dt><dd>{job.settings.fps} fps</dd></div><div><dt>Segment</dt><dd>{job.progress.segment} of {job.progress.segments}</dd></div><div><dt>Frames saved locally</dt><dd>{job.progress.completedFrames} / {job.progress.targetFrames}</dd></div></>}</dl>{job.viggleSegmentation && <p className="render-saved-note">{(job.progress.completedFrames / job.settings.fps).toFixed(2)}s of {(job.progress.targetFrames / job.settings.fps).toFixed(2)}s saved locally. Completed segments stay saved if the connection drops.</p>}{job.keyframe && <a className="secondary-button" href={`/api/jobs/${job.id}/keyframe`} target="_blank" rel="noreferrer">View conditioning frame</a>}</div>
    </Modal>
  </div>;
}
