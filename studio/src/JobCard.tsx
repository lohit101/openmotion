import { useRef } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowCounterClockwise, DotsThree, DownloadSimple, FilmStrip, Heart, Play, Trash } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { isImageJob } from '../shared/image-replacement';
import { formatTime } from './components';

export default function JobCard({ job, selected, onSelect, onPatch, onReuse }: { job: Job; selected?: boolean; onSelect: () => void; onPatch: (v: Partial<Job>) => void; onReuse: () => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const done = job.status === 'completed';
  const [width, height] = outputDimensions(job);
  return <article className={`job-card ${selected ? 'selected' : ''}`}>
    <button className="job-media" onClick={onSelect} onMouseEnter={() => { if (done) void preview.current?.play().catch(() => undefined); }} onMouseLeave={() => { preview.current?.pause(); if (preview.current) preview.current.currentTime = 0; }} aria-label={`Open ${job.title}`}>
      {done && isImageJob(job) ? <img src={`/api/jobs/${job.id}/poster`} alt={job.title} loading="lazy" /> : done ? <video ref={preview} muted playsInline loop preload="none" poster={`/api/jobs/${job.id}/poster`} src={`/api/jobs/${job.id}/video`} /> : <div className="job-pending"><FilmStrip size={28} /><span>{job.status === 'running' ? job.progress.stage : job.status}</span></div>}
      {done && !isImageJob(job) && <span className="job-play"><Play size={14} weight="fill" /></span>}
    </button><div className="job-card-content"><button className="job-title" onClick={onSelect}>{job.title}</button><Menu.Root><Menu.Trigger asChild><button className="text-icon" aria-label={`Actions for ${job.title}`}><DotsThree size={21} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="dropdown-content" sideOffset={5} align="end"><Menu.Item onSelect={onReuse}><ArrowCounterClockwise size={15} />Reuse settings</Menu.Item><Menu.Item onSelect={() => onPatch({ favorite: !job.favorite })}><Heart size={15} />{job.favorite ? 'Remove favorite' : 'Add to favorites'}</Menu.Item>{done && <Menu.Item asChild><a href={`/api/jobs/${job.id}/${isImageJob(job) ? 'image' : 'video'}?download=1`}><DownloadSimple size={15} />Download {isImageJob(job) ? 'image' : 'video'}</a></Menu.Item>}<Menu.Separator /><Menu.Item onSelect={() => onPatch({ deleted: !job.deleted })}><Trash size={15} />{job.deleted ? 'Restore to library' : 'Move to trash'}</Menu.Item></Menu.Content></Menu.Portal></Menu.Root><small>{isImageJob(job) ? 'Image' : formatTime(job.progress.targetFrames / job.settings.fps)} <span>/</span> {width} × {height}{job.favorite && <Heart size={11} weight="fill" />}</small></div>
  </article>;
}

