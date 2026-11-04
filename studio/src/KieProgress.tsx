import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowSquareOut, Info, Sparkle, WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { useOverallProgress } from './useGenerationProgress';
import { api, formatTime } from './components';
import { toast } from 'sonner';
import './generation-progress.css';

export default function KieProgress({ job, changed }: { job: Job; changed?: (job: Job) => void }) {
  const [details, setDetails] = useState(false), [pending, setPending] = useState(false), [taskId, setTaskId] = useState(''), [now, setNow] = useState(Date.now());
  const info = useRef<HTMLButtonElement>(null), back = useRef<HTMLButtonElement>(null), switched = useRef(false);
  const percent = useOverallProgress(job), run = job.kie;
  const active = ['queued', 'running', 'reconnecting'].includes(job.status), attention = ['failed', 'interrupted', 'cancelled'].includes(job.status);
  const ambiguous = run?.submission === 'unknown';
  const switchView = (value: boolean) => { switched.current = true; setDetails(value); };
  useEffect(() => { if (switched.current) (details ? back : info).current?.focus(); }, [details]);
  useEffect(() => { if (!details) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [details]);
  const action = async (kind: 'cancel' | 'resume' | 'recover') => {
    if (pending) return; setPending(true);
    try { const value = await api<Job>(`/kie/jobs/${job.id}/${kind}`, kind === 'recover' ? { taskId: taskId.trim() } : {}); changed?.(value); }
    catch (error) { toast.error('This video needs attention', { description: (error as Error).message }); }
    finally { setPending(false); }
  };
  const title = ambiguous ? 'Check your Kie task' : attention ? job.status === 'cancelled' ? 'Updates stopped' : 'Your video needs attention' : job.status === 'queued' ? 'Waiting to start' : run?.phase === 'waiting' ? 'Waiting for Wan 3.0' : run?.phase === 'downloading' || run?.phase === 'saving' ? 'Saving your video' : run?.phase === 'preparing' || run?.phase === 'uploading' || run?.phase === 'submitting' ? 'Preparing your video' : 'Creating your video';
  const actions = <div className="generation-simple-actions">
    {active && <><button className="generation-cancel" disabled={pending} onClick={() => void action('cancel')}>{pending ? 'Checking…' : run?.taskId ? 'Stop watching' : 'Cancel'}</button><p className="kie-cancel-note">A submitted Kie task can keep running and using credits after updates stop here.</p></>}
    {attention && !ambiguous && <button className="primary-button compact" disabled={pending} onClick={() => void action('resume')}>{pending ? 'Checking…' : 'Check & resume'}</button>}
    {ambiguous && <div className="kie-task-recovery"><p>Check Kie’s task history first. Recast will not submit this request again automatically.</p><a className="secondary-button" href="https://kie.ai/logs" target="_blank" rel="noreferrer"><ArrowSquareOut size={14} />Open Kie task history</a><label className="full-label">Existing task ID<input aria-label="Existing Kie task ID" value={taskId} onChange={e => setTaskId(e.target.value)} placeholder="Paste the matching task ID" autoComplete="off" /></label><button className="primary-button compact" disabled={pending || !taskId.trim()} onClick={() => void action('recover')}>{pending ? 'Verifying task…' : 'Recover this task'}</button></div>}
  </div>;
  const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
  return <div className={`generation-progress ${attention ? 'has-error' : ''} ${details ? 'showing-details' : ''}`}>
    {details ? <section className="generation-details-view" aria-label="Video generation details" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); switchView(false); } }}><header><button ref={back} className="render-details-back" onClick={() => switchView(false)}><ArrowLeft size={15} />Back</button><h2>Generation details</h2><span>{percent}% overall</span></header><div className="render-progress-details"><div className="render-detail-stage"><span>Current stage</span><strong>{job.progress.stage}</strong>{job.error && <p role="alert">{job.error}</p>}{job.progress.value !== null && job.progress.max !== null && job.progress.max > 0 && <><div className="generation-stage-track" role="progressbar" aria-label="Current generation stage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(job.progress.value / job.progress.max * 100)}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, job.progress.value / job.progress.max))})` }} /></div><p>{job.progress.unit === 'bytes' ? `${(job.progress.value / 1048576).toFixed(1)} / ${(job.progress.max / 1048576).toFixed(1)} MB` : `${job.progress.value} / ${job.progress.max} ${job.progress.unit}`}</p></>}</div><dl><div><dt>Provider</dt><dd>Kie.ai · Wan 3.0</dd></div><div><dt>Requested quality</dt><dd>{run?.settings.resolution.toLowerCase()}</dd></div><div><dt>Requested duration</dt><dd>{run?.settings.seconds}s</dd></div><div><dt>Elapsed</dt><dd>{formatTime(elapsed)}</dd></div>{run?.taskId && <div><dt>Task ID</dt><dd>{run.taskId}</dd></div>}{run?.creditsConsumed !== undefined && <div><dt>Provider credits used</dt><dd>{run.creditsConsumed}</dd></div>}</dl><p className="render-progress-method">Overall progress follows preparation, provider status and saving milestones. It holds when no new progress is available. Check &amp; resume retrieves the existing task; it does not create another paid generation.</p></div>{actions}</section> : <>
      {!attention && <div className="generation-ambience" aria-hidden="true"><img src={`/api/assets/${job.sourceId}/poster`} alt="" /><span className="generation-glow" /></div>}
      <button ref={info} className="generation-info" aria-label="View generation details" title="View generation details" onClick={() => switchView(true)}><Info size={18} /></button>
      <div className="generation-simple"><div className="generation-sparkles" aria-hidden="true">{attention ? <WarningCircle size={30} weight="light" /> : <><Sparkle size={34} weight="light" /><Sparkle className="sparkle-small" size={13} weight="fill" /><Sparkle className="sparkle-tiny" size={8} weight="fill" /></>}</div><h2 aria-live="polite">{title}</h2>{attention ? <p className="generation-error" role="alert">{job.error || run?.cancellationNotice || 'Saved inputs and any existing Kie task are kept.'}</p> : <div className="generation-percent" role="progressbar" aria-label="Overall generation progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>{percent}<span>%</span></div>}{actions}</div>
    </>}
  </div>;
}
