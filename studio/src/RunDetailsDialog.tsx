import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowCounterClockwise, ArrowSquareOut, CaretLeft, CaretRight, DownloadSimple, Heart, Image as ImageIcon, FilmStrip, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, Graph, Job } from '../shared/types';
import { isImageJob } from '../shared/image-replacement';
import { recordedSampling, runSummary, savedRunSettings, settingLabel } from '../shared/library';
import { VideoPlayer } from './components';
import './library.css';

export default function RunDetailsDialog({ job, jobs, assets, open, close, patch, reuse, openWorkspace, previous, next, position }: {
  job: Job; jobs: Job[]; assets: Asset[]; open: boolean; close: () => void;
  patch: (changes: Partial<Job>) => Promise<void>; reuse: () => void; openWorkspace: () => void;
  previous?: () => void; next?: () => void; position?: string;
}) {
  const [compare, setCompare] = useState(false), [name, setName] = useState(job.title), [saving, setSaving] = useState(false);
  const [failedMedia, setFailedMedia] = useState(false);
  useEffect(() => { setCompare(false); setFailedMedia(false); }, [job.id]);
  useEffect(() => setName(job.title), [job.id, job.title]);
  const image = isImageJob(job), done = job.status === 'completed' && !!job.output;
  const settings = savedRunSettings(job), local = job.image?.localFraming;
  const workflowJob = local ? jobs.find(item => item.id === local.parentJobId) : job;
  const [sampling, setSampling] = useState<ReturnType<typeof recordedSampling>>([]);
  const [graphError, setGraphError] = useState(false);
  useEffect(() => {
    setSampling([]); setGraphError(false);
    if (!open || !workflowJob?.hasWorkflow) return;
    const controller = new AbortController();
    void fetch(`/api/jobs/${workflowJob.id}/workflow`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Graph unavailable');
      const graph: Graph = await response.json(); if (!controller.signal.aborted) setSampling(recordedSampling(graph));
    }).catch(() => { if (!controller.signal.aborted) setGraphError(true); });
    return () => controller.abort();
  }, [open, workflowJob?.id, workflowJob?.hasWorkflow]);
  const source = assets.find(asset => asset.id === job.sourceId), reference = assets.find(asset => asset.id === job.referenceId);
  const displayValue = (value: unknown) => typeof value === 'boolean' ? value ? 'On' : 'Off' : value == null ? 'Not recorded' : String(value);
  const saveName = async () => { const title = name.trim(); if (!title || title === job.title) { setName(job.title); return; } setSaving(true); try { await patch({ title }); } finally { setSaving(false); } };
  const stamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : null;
  const exportData = { id: job.id, title: job.title, mediaType: image ? 'image' : 'video', version: job.image?.version || job.renderVersion, sourceId: job.sourceId, referenceId: job.referenceId, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, elapsedSeconds: job.elapsedSeconds, settings, ...(job.videoRecovery ? { videoRecovery: job.videoRecovery } : {}), ...(job.continuationSource ? { continuationSource: job.continuationSource } : {}), ...(local ? { localFraming: local } : {}) };
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) close(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className="run-dialog">
    <header className="run-dialog-header"><div className="run-dialog-title">{image ? <ImageIcon size={19} /> : <FilmStrip size={19} />}<div><Dialog.Title>{job.title}</Dialog.Title><Dialog.Description>{local ? 'Local framing preview' : image ? 'Photo replacement' : 'Video generation'}{stamp(job.createdAt) ? ` · ${stamp(job.createdAt)}` : ''}</Dialog.Description></div></div><div className="run-dialog-nav">{position && <span>{position}</span>}{(previous || next || position) && <><button className="icon-button" aria-label="Previous creation" disabled={!previous} onClick={previous}><CaretLeft size={18} /></button><button className="icon-button" aria-label="Next creation" disabled={!next} onClick={next}><CaretRight size={18} /></button></>}<Dialog.Close className="icon-button" aria-label="Close preview"><X size={20} /></Dialog.Close></div></header>
    <div className="run-dialog-body"><section className="run-preview" aria-label="Creation preview">
      <div className="run-preview-toolbar"><div className="preview-tabs"><button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}>Result</button><button className={compare ? 'active' : ''} disabled={!done || !source} onClick={() => setCompare(true)}>{image ? 'Source photo' : 'Compare'}</button></div><span>{job.status}</span></div>
      <div className="run-preview-stage">{done && !failedMedia ? image ? <img key={`${job.id}-${compare}`} src={`/api/jobs/${job.id}/${compare ? 'image-source' : 'image'}`} alt={compare ? 'Original source photograph' : job.title} onError={() => setFailedMedia(true)} /> : <VideoPlayer key={job.id} job={job} compare={compare} /> : <div className="run-unavailable"><WarningCircle size={28} /><h3>{failedMedia ? 'Preview could not be loaded' : done ? 'Media unavailable' : job.progress.stage}</h3><p>{failedMedia ? 'Try opening the saved file again.' : job.error || 'Open this run in its workspace for progress and recovery controls.'}</p>{failedMedia && <button className="secondary-button" onClick={() => setFailedMedia(false)}>Retry preview</button>}</div>}</div>
      <footer className="run-preview-footer"><button className={`secondary-button run-favourite ${job.favorite ? 'is-favourite' : ''}`} disabled={saving} aria-pressed={job.favorite} onClick={() => { setSaving(true); void patch({ favorite: !job.favorite }).finally(() => setSaving(false)); }}><Heart size={17} weight={job.favorite ? 'fill' : 'regular'} />{job.favorite ? 'Favourited' : 'Favourite'}</button>{done && <a className="secondary-button" href={`/api/jobs/${job.id}/${image ? 'image' : 'video'}?download=1`}><DownloadSimple size={16} />Download {image ? 'photo' : 'video'}</a>}<button className="secondary-button run-open-workspace" onClick={() => { if (job.deleted) void patch({ deleted: false }); else openWorkspace(); }}><ArrowSquareOut size={16} />{job.deleted ? 'Restore to library' : 'Open workspace'}</button></footer>
    </section><aside className="run-details" aria-label="Saved run details">
      <div className="run-details-heading"><div><h3>Run details</h3><p>Saved with this creation</p></div><button className="icon-button" title="Reuse settings" aria-label="Reuse these run settings" onClick={reuse}><ArrowCounterClockwise size={18} /></button></div>
      <label className="run-name">Name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
      <dl className="run-summary">{runSummary(job).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <section className="run-inputs"><h4>Original inputs</h4><div>{([{ asset: source, label: image ? 'Scene & pose' : 'Motion video' }, { asset: reference, label: 'Character reference' }]).map(({ asset, label }) => <figure key={label}>{asset ? <img src={`/api/assets/${asset.id}/poster`} alt={label} loading="lazy" /> : <div className="run-input-missing"><ImageIcon size={18} /></div>}<figcaption><span>{label}</span><small title={asset?.name}>{asset?.name || 'Not available'}</small></figcaption></figure>)}</div></section>
      {local && <section className="run-detail-note"><h4>Local adjustment</h4><p>{local.scale.toFixed(3)}× uniform enlargement from the accepted image. No new model generation. Review reconstructed background edges.</p></section>}
      {job.continuationSource && <section className="run-detail-note"><h4>Reused completed segment</h4><p>The first {job.continuationSource.frames} frames were reused from {jobs.find(item => item.id === job.continuationSource!.jobId)?.title || 'an earlier run'}. Only the remaining segments were generated for this comparison.</p></section>}
      {job.videoRecovery && <section className="run-detail-note"><h4>Recovered export</h4><p>All {job.videoRecovery.generatedFrames} generated frames were kept. One leading hold frame ({(job.videoRecovery.leadingHoldFrames / job.settings.fps).toFixed(3)}s) fills the timestamp gap from clip preparation. Recovered locally {stamp(job.videoRecovery.recoveredAt)}; render timings exclude this recovery. No additional AI generation was used.</p></section>}
      {!image && job.segments.some(segment => segment.reference) && <section className="run-detail-note"><h4>Segment appearance references</h4>{job.segments.map((segment, index) => segment.reference && <p key={segment.promptId}><a href={`/api/jobs/${job.id}/keyframe?segment=${index}`} target="_blank" rel="noreferrer">Segment {index + 1} · {index === 0 ? 'Starting character frame' : 'Last frame of segment ' + index}</a></p>)}</section>}
      {(job.error || !!job.image?.review?.warnings.length) && <section className="run-detail-note run-detail-warning"><h4>{job.error ? 'Run message' : 'Review notes'}</h4>{job.error && <p>{job.error}</p>}{job.image?.review?.warnings.map(warning => <p key={warning}>{warning}</p>)}</section>}
      {!!sampling.length && <details className="run-settings" open><summary>{local ? 'Original sampling passes' : 'Recorded sampling'}</summary>{sampling.map(item => <section className="run-sampling-pass" key={item.id}><h4>{item.title}</h4><dl>{item.values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>)}</details>}
      {graphError && <p className="run-graph-error">The saved graph could not be loaded. The saved configuration is available below.</p>}
      <details className="run-settings"><summary>All saved settings</summary><dl>{Object.entries(settings).filter(([key]) => !['prompt', 'negativePrompt'].includes(key)).map(([key, value]) => <div key={key}><dt>{settingLabel(key)}</dt><dd>{displayValue(value)}</dd></div>)}</dl></details>
      {!!settings.prompt && <section className="run-saved-prompt"><h4>Saved prompt</h4>{!image && job.settings.engine === 'viggle' && job.settings.referencePreparation === 'prepared' && <small>Prepared-frame video sampling does not use a text prompt.</small>}<p>{String(settings.prompt)}</p></section>}
      {!!settings.negativePrompt && <details className="run-settings"><summary>Negative prompt</summary><p className="run-prompt-text">{String(settings.negativePrompt)}</p></details>}
      {!!job.timings?.length && <details className="run-settings"><summary>Recorded stage times</summary><dl>{job.timings.map((item, index) => <div key={index}><dt>{item.stage}</dt><dd>{item.seconds.toFixed(1)}s</dd></div>)}</dl></details>}
      <div className="run-record-footer">{stamp(job.finishedAt) && <p>Finished {stamp(job.finishedAt)}</p>}<p className="run-id">Run {job.id}</p><a href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2))} download={`recast-${job.id}-settings.json`}><DownloadSimple size={14} />Save run settings</a>{workflowJob?.hasWorkflow && <a href={`/api/jobs/${workflowJob.id}/workflow`}><DownloadSimple size={14} />{local ? 'Original ComfyUI graph' : 'ComfyUI graph'}</a>}</div>
    </aside></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
