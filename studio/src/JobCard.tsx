import { smoothOutputFPS } from '../shared/smooth-motion';
import { jobDuration } from '../shared/library';
import { useRef } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowCounterClockwise, Clock, DotsThree, DownloadSimple, Heart, Pause, Play, Sparkle, Trash, WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { isImageJob } from '../shared/image-replacement';
import { formatTime } from './components';
import { useOverallProgress } from './useGenerationProgress';

function PendingPreview({ job }: { job: Job }) {
  const overall = useOverallProgress(job);
  const active = ['queued', 'running', 'reconnecting'].includes(job.status);
  const percent = job.faceRefinement ? Math.min(99, Math.floor(98 * job.progress.completedFrames / Math.max(1, job.progress.targetFrames))) : overall;
  const label = job.faceRepair?.state === 'review' ? 'Ready to compare' : job.status === 'queued' ? 'Queued' : job.status === 'reconnecting' ? 'Reconnecting' : job.status === 'running' ? job.smoothMotion ? 'Smoothing motion' : job.faceRepair ? 'Repairing face' : job.faceRefinement ? 'Refining face' : 'Rendering' : job.status === 'failed' ? 'Failed' : job.status === 'cancelled' ? 'Cancelled' : 'Needs attention';
  const Icon = job.status === 'queued' ? Clock : job.status === 'failed' ? WarningCircle : active ? Sparkle : Pause;
  return <div className={`job-pending${active ? ' is-active' : ''}${job.status === 'failed' ? ' is-failed' : ''}`} title={job.error || job.progress.stage}>
    <span className="job-pending-label"><Icon size={14} /><span>{label}</span></span>
    {active && <span className="job-pending-percent" role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% · ${job.progress.stage}`}>{percent}<small>%</small></span>}
  </div>;
}

export default function JobCard({ job, selected, onSelect, onPatch, onReuse }: { job: Job; selected?: boolean; onSelect: () => void; onPatch: (v: Partial<Job>) => void; onReuse: () => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const done = job.status === 'completed' && !!job.output;
  const [width, height] = outputDimensions(job);
  return <article className={`job-card ${selected ? 'selected' : ''}`}>
    <button className="job-media" onClick={onSelect} onMouseEnter={() => { if (done) void preview.current?.play().catch(() => undefined); }} onMouseLeave={() => { preview.current?.pause(); if (preview.current) preview.current.currentTime = 0; }} aria-label={`Open ${job.title}`}>
      {done && isImageJob(job) ? <img src={`/api/jobs/${job.id}/poster`} alt={job.title} loading="lazy" /> : done ? <video ref={preview} muted playsInline loop preload="none" poster={`/api/jobs/${job.id}/poster`} src={`/api/jobs/${job.id}/video`} /> : <PendingPreview job={job} />}
      {done && !isImageJob(job) && <span className="job-play"><Play size={14} weight="fill" /></span>}
    </button><div className="job-card-content"><button className="job-title" onClick={onSelect}>{job.title}</button><Menu.Root><Menu.Trigger asChild><button className="text-icon" aria-label={`Actions for ${job.title}`}><DotsThree size={21} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="dropdown-content" sideOffset={5} align="end"><Menu.Item onSelect={onReuse}><ArrowCounterClockwise size={15} />{job.edit ? 'Edit timeline' : 'Reuse settings'}</Menu.Item><Menu.Item onSelect={() => onPatch({ favorite: !job.favorite })}><Heart size={15} />{job.favorite ? 'Remove favorite' : 'Add to favorites'}</Menu.Item>{done && <Menu.Item asChild><a href={`/api/jobs/${job.id}/${isImageJob(job) ? 'image' : 'video'}?download=1`}><DownloadSimple size={15} />Download {isImageJob(job) ? 'image' : 'video'}</a></Menu.Item>}<Menu.Separator /><Menu.Item onSelect={() => onPatch({ deleted: !job.deleted })}><Trash size={15} />{job.deleted ? 'Restore to library' : 'Move to trash'}</Menu.Item></Menu.Content></Menu.Portal></Menu.Root><small>{isImageJob(job) ? 'Image' : formatTime(jobDuration(job))} <span>/</span> {width} × {height}{job.favorite && <Heart size={11} weight="fill" />}</small></div>
  </article>;
}
