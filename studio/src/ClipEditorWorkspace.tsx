import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, CaretLeft, CaretRight, CheckCircle, DownloadSimple, FilmStrip, Heart, MagnifyingGlass, Minus, Pause, Play, Plus, Scissors, SpeakerHigh, SpeakerSlash, Trash, WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { clipTime } from '../shared/clip';
import { clipSeconds, editDraftSchema, locateTimeline, timelineLayout, type ClipEditReceipt, type EditDraft, type EditorSource, type LocalExport } from '../shared/clip-editor';
import { api, SmallSelect } from './components';
import { FieldLabel, InfoTip } from './InfoTip';
import ClipTimeline from './ClipTimeline';
import './clip-editor.css';

export interface EditorIntent { id: string; jobId?: string; receipt?: ClipEditReceipt; title?: string; }
const storageKey = 'recast-clip-editor-v1';
function savedEditor(): { draft: EditDraft; sources: Record<string, EditorSource> } {
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); return { draft: editDraftSchema.parse(saved.draft), sources: saved.sources || {} }; }
  catch { return { draft: { title: 'Untitled edit', mode: 'lossless', clips: [] }, sources: {} }; }
}

export default function ClipEditorWorkspace({ jobs, intent, consumed, library }: { jobs: Job[]; intent: EditorIntent | null; consumed: (id: string) => void; library: () => void }) {
  const [initial] = useState(savedEditor), [draft, setDraft] = useState(initial.draft), [sources, setSources] = useState(initial.sources);
  const [selected, setSelected] = useState<string | null>(initial.draft.clips[0]?.id || null), [query, setQuery] = useState(''), [favourites, setFavourites] = useState(false);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(false), [zoom, setZoom] = useState(55);
  const [adding, setAdding] = useState<string | null>(null), [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const [exports, setExports] = useState<LocalExport[]>([]), [exportPreview, setExportPreview] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null), playingRef = useRef(false), timeRef = useRef(time), rowsRef = useRef<ReturnType<typeof timelineLayout>>([]), request = useRef<{ body: string; key: string } | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const handledIntent = useRef<string | null>(null);
  const rows = timelineLayout(draft.clips, sources), duration = rows.at(-1)?.end || 0, at = locateTimeline(draft.clips, sources, time);
  rowsRef.current = rows; timeRef.current = time;
  const selectedClip = draft.clips.find(clip => clip.id === selected), selectedSource = selectedClip && sources[selectedClip.jobId];
  const available = jobs.filter(job => !job.deleted && job.mediaType !== 'image' && job.status === 'completed' && !!job.output && (!favourites || job.favorite) && job.title.toLowerCase().includes(query.toLowerCase()));
  const latest = exports[0], working = exports.some(row => ['queued', 'exporting'].includes(row.status));
  const stop = useCallback(() => { playingRef.current = false; video.current?.pause(); setPlaying(false); }, []);
  const seek = useCallback((point: number) => { stop(); setExportPreview(null); const rows = rowsRef.current, end = rows.at(-1)?.end || 0; const target = Math.max(0, Math.min(end, point)); timeRef.current = target; setTime(target); }, [stop]);
  const change = (clips: EditDraft['clips']) => { stop(); setExportPreview(null); setDraft(old => ({ ...old, clips })); };
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify({ draft, sources })); } catch { /* The current edit still works without storage. */ } }, 250); return () => clearTimeout(timer); }, [draft, sources]);
  useEffect(() => { if (time > duration) seek(duration); if (selected && !draft.clips.some(clip => clip.id === selected)) setSelected(draft.clips[0]?.id || null); }, [draft.clips, duration, selected, time, seek]);
  const sourceInfo = useCallback(async (jobId: string) => { const meta = await api<EditorSource>(`/clip-editor/sources/${encodeURIComponent(jobId)}`); setSources(old => ({ ...old, [jobId]: meta })); return meta; }, []);
  const add = useCallback(async (jobId: string) => {
    if (draftRef.current.clips.length >= 32) { setError('A timeline can hold up to 32 clips.'); return; }
    setAdding(jobId); setError(''); stop(); setExportPreview(null);
    try { const meta = await sourceInfo(jobId), clip = { id: crypto.randomUUID(), jobId, inFrame: 0, outFrame: meta.frames }; setDraft(old => old.clips.length >= 32 ? old : { ...old, clips: [...old.clips, clip] }); setSelected(clip.id); }
    catch (e) { setError((e as Error).message); } finally { setAdding(null); }
  }, [sourceInfo, stop]);
  useEffect(() => {
    let disposed = false;
    const missing = [...new Set(draft.clips.map(clip => clip.jobId))].filter(id => !sources[id]);
    void (async () => { for (const id of missing) { if (disposed) return; try { await sourceInfo(id); } catch (e) { if (!disposed) setError((e as Error).message); } } })();
    return () => { disposed = true; };
  }, [draft.clips.map(clip => clip.jobId).join('|'), sourceInfo]);
  useEffect(() => {
    if (!intent || handledIntent.current === intent.id) return;
    handledIntent.current = intent.id;
    const load = async () => {
      if (intent.receipt) {
        stop(); setExportPreview(null); setError('');
        const clips = intent.receipt.sources.map(item => ({ id: crypto.randomUUID(), jobId: item.jobId, inFrame: item.inFrame, outFrame: item.outFrame }));
        setDraft({ title: intent.title || 'Untitled edit', mode: intent.receipt.mode, clips }); setSelected(clips[0]?.id || null); seek(0);
        for (const id of [...new Set(clips.map(clip => clip.jobId))]) await sourceInfo(id);
      } else if (intent.jobId) await add(intent.jobId);
    };
    void load().catch(e => setError(e.message)).finally(() => consumed(intent.id));
  }, [intent?.id]);
  const refreshExports = useCallback(async () => { const rows = await api<LocalExport[]>('/clip-editor/exports'); setExports(rows); }, []);
  useEffect(() => { void refreshExports().catch(e => setError(e.message)); }, [refreshExports]);
  useEffect(() => { if (!working) return; const timer = setInterval(() => { void refreshExports().catch(e => setError(e.message)); }, 1000); return () => clearInterval(timer); }, [working, refreshExports]);
  useEffect(() => {
    if (!playing && at && video.current?.readyState && !exportPreview && Math.abs(video.current.currentTime - at.sourceTime) > .001) video.current.currentTime = at.sourceTime;
  }, [playing, at?.clip.id, at?.clip.inFrame, at?.clip.outFrame, at?.sourceTime, exportPreview]);
  useEffect(() => {
    if (!playing || exportPreview) return;
    let frame = 0;
    const tick = () => {
      const rows = rowsRef.current, active = rows.find(row => timeRef.current < row.end - 1e-6) || rows.at(-1), player = video.current;
      if (active && player?.readyState && !player.seeking) {
        const out = active.clip.outFrame / active.source.fps;
        if (player.currentTime >= out - .005 || player.ended) {
          const next = rows[rows.indexOf(active) + 1];
          if (!next) { stop(); setTime(active.end); return; }
          timeRef.current = next.start; setTime(next.start);
        } else { const next = active.start + Math.max(0, player.currentTime - active.clip.inFrame / active.source.fps); timeRef.current = next; setTime(next); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, exportPreview, stop]);
  const play = () => {
    if (playing) { stop(); return; }
    setExportPreview(null); if (!at) return;
    if (time >= duration - .01) { seek(0); playingRef.current = true; setPlaying(true); if (rows[0]?.clip.id === at.clip.id && video.current) { video.current.currentTime = rows[0].clip.inFrame / rows[0].source.fps; void video.current.play().catch(() => stop()); } return; }
    playingRef.current = true; setPlaying(true); void video.current?.play().catch(() => { stop(); setError('Preview could not play. Try the play button again.'); });
  };
  const onReady = () => { const active = locateTimeline(draftRef.current.clips, sources, timeRef.current); if (video.current && active) { if (Math.abs(video.current.currentTime - active.sourceTime) > .001) video.current.currentTime = active.sourceTime; if (playingRef.current) void video.current.play().catch(() => stop()); } };
  const submit = async () => {
    if (!draft.title.trim()) { setError('Give your edit a name before exporting.'); return; }
    setSubmitting(true); setError(''); stop();
    try {
      const value = editDraftSchema.parse(draft), body = JSON.stringify(value);
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const response = await fetch('/api/clip-editor/exports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current!.key }, body });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The export could not start.');
      request.current = null; setExports(old => [result, ...old.filter(row => row.id !== result.id)]);
    } catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  };
  const moveSelected = (direction: number) => { const index = draft.clips.findIndex(clip => clip.id === selected), next = [...draft.clips]; if (index < 0 || index + direction < 0 || index + direction >= next.length) return; [next[index], next[index + direction]] = [next[index + direction], next[index]]; change(next); seek(0); };
  const missing = draft.clips.some(clip => !sources[clip.jobId] || !jobs.some(job => job.id === clip.jobId && !job.deleted && job.status === 'completed'));
  const mixedSize = rows.some(row => row.source.width !== rows[0]?.source.width || row.source.height !== rows[0]?.source.height);
  const formatIssue = draft.mode === 'lossless' && rows.length > 1 && rows.some(row => Math.abs(row.source.fps - rows[0].source.fps) > .001 || ['pixelFormat', 'colorRange', 'colorSpace', 'colorTransfer', 'colorPrimaries'].some(key => row.source[key as keyof EditorSource] !== rows[0].source[key as keyof EditorSource]));
  return <main className="clip-editor-workspace"><header className="edit-workspace-header"><div><span className="workspace-overline">LOCAL VIDEO TOOLS</span><h1><Scissors size={24} />Clip editor</h1><p>Trim, arrange, and make one video.</p></div><div className="edit-export-controls"><div><FieldLabel label="Export" help="Lossless keeps decoded image quality: compatible whole clips copy directly; exact cuts produce an FFV1 MKV master plus a playable MP4 preview. High-quality MP4 re-encodes at CRF 16. All work runs locally, without your rented GPU." /><SmallSelect label="Export format" value={draft.mode} onChange={mode => setDraft(old => ({ ...old, mode: mode as EditDraft['mode'] }))} options={[{ value: 'lossless', label: 'Lossless master' }, { value: 'mp4', label: 'High-quality MP4' }]} /></div><button className="primary-button" disabled={submitting || !draft.clips.length || missing || working || formatIssue || duration > 600} onClick={() => void submit()}><DownloadSimple size={16} />{submitting ? 'Starting…' : 'Export video'}</button></div></header>
    {error && <div className="edit-error" role="alert"><WarningCircle size={17} /><span>{error}</span></div>}
    {duration > 600 && <div className="edit-format-note" role="status">Keep this lightweight edit under ten minutes to export. Remove or shorten a clip.</div>}
    {formatIssue && <div className="edit-format-note" role="status">These clips have different frame rates or color formats. Lossless export needs a matching set.<button onClick={() => setDraft(old => ({ ...old, mode: 'mp4' }))}>Use high-quality MP4</button></div>}
    <div className="edit-main-grid"><aside className="edit-source-browser" aria-label="Library clips"><div className="edit-source-heading"><h2>Library</h2><button type="button" className={favourites ? 'active' : ''} aria-pressed={favourites} title="Show favourites" aria-label="Show favourite videos" onClick={() => setFavourites(!favourites)}><Heart size={16} weight={favourites ? 'fill' : 'regular'} /></button></div><label className="edit-source-search"><MagnifyingGlass size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a video" aria-label="Search library videos" /></label><div className="edit-source-list">{available.map(job => <button type="button" key={job.id} className="edit-source-item" disabled={!!adding || draft.clips.length >= 32} aria-label={`Add ${job.title} to timeline`} onClick={() => void add(job.id)}><div><img src={`/api/jobs/${job.id}/poster`} alt="" loading="lazy" /><span>{draft.clips.filter(clip => clip.jobId === job.id).length || <Plus size={14} />}</span></div><span><strong title={job.title}>{job.title}</strong><small>{job.edit?.duration.toFixed(2) || (job.progress.targetFrames / job.settings.fps).toFixed(2)}s · {job.edit ? 'Local edit' : `${job.width} × ${job.height}`}{adding === job.id ? ' · Adding…' : ''}</small></span></button>)}{!available.length && <p className="edit-empty-source">{query || favourites ? 'No matching videos.' : 'Completed videos from your library appear here.'}</p>}</div><button className="edit-open-library" onClick={library}>Open full library<CaretRight size={13} /></button></aside>
      <section className="edit-preview-area" aria-label="Timeline preview"><div className="edit-project-title"><input aria-label="Edit title" value={draft.title} maxLength={120} onChange={event => setDraft(old => ({ ...old, title: event.target.value }))} placeholder="Name your edit" /><span>{draft.clips.length} {draft.clips.length === 1 ? 'clip' : 'clips'} · {clipTime(duration)}</span></div><div className="edit-preview-stage">{exportPreview ? <><video key={exportPreview} controls playsInline src={`/api/jobs/${exportPreview}/video`} aria-label="Exported video preview" /><button className="edit-return-timeline" onClick={() => setExportPreview(null)}>Back to timeline</button></> : at ? <video key={at.clip.id} ref={video} src={`/api/jobs/${at.clip.jobId}/video`} poster={`/api/jobs/${at.clip.jobId}/poster`} muted={muted} playsInline preload="auto" onLoadedMetadata={onReady} onCanPlay={() => { if (playingRef.current) void video.current?.play().catch(() => stop()); }} onClick={play} onError={() => { stop(); setError('This clip could not be previewed. Its original file is unchanged.'); }} aria-label="Timeline video preview" /> : <div className="edit-preview-empty"><FilmStrip size={38} weight="light" /><h2>A few clips. One story.</h2><p>Add library videos, then drag their timeline edges to trim.</p></div>}</div><div className="edit-preview-controls"><button type="button" className="icon-button" aria-label="Return to timeline start" disabled={!rows.length || !!exportPreview} onClick={() => seek(0)}><ArrowCounterClockwise size={16} /></button><button type="button" className="edit-play" aria-label={playing ? 'Pause timeline' : 'Play timeline'} disabled={!rows.length || !!exportPreview} onClick={play}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><span>{clipTime(time)}<small> / {clipTime(duration)}</small></span><input className="edit-preview-seek" type="range" min={0} max={duration || 1} step={1 / (at?.source.fps || 24)} value={Math.min(time, duration)} disabled={!rows.length || !!exportPreview} onChange={event => seek(Number(event.target.value))} aria-label="Seek timeline" /><button type="button" className="icon-button" aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(!muted)}>{muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}</button></div></section></div>
    <section className="edit-timeline-panel" aria-label="Video timeline editor"><header><div><h2>Timeline</h2><InfoTip label="Timeline editing">Drag either edge to trim directly. Drag a clip's body to reorder it. Focus an edge and use arrow keys for one-frame adjustments, or Shift + arrows for ten frames. Original library videos stay unchanged.</InfoTip></div><div className="edit-timeline-tools"><button type="button" className="icon-button" aria-label="Zoom timeline out" disabled={zoom <= 15} onClick={() => setZoom(value => Math.max(15, value - 15))}><Minus size={14} /></button><input type="range" min={15} max={160} value={zoom} step={5} onChange={event => setZoom(Number(event.target.value))} aria-label="Timeline zoom" /><button type="button" className="icon-button" aria-label="Zoom timeline in" disabled={zoom >= 160} onClick={() => setZoom(value => Math.min(160, value + 15))}><Plus size={14} /></button></div></header>
      <ClipTimeline clips={draft.clips} sources={sources} selected={selected} select={setSelected} change={change} seek={seek} time={time} zoom={zoom} />
      <footer className="edit-selection-bar">{selectedClip && selectedSource ? <><span><strong title={selectedSource.title}>{selectedSource.title}</strong><small>{clipTime(selectedClip.inFrame / selectedSource.fps)} → {clipTime(selectedClip.outFrame / selectedSource.fps)} · {clipSeconds(selectedClip, selectedSource).toFixed(2)}s</small></span><div><button className="icon-button" aria-label="Move selected clip earlier" title="Move earlier" disabled={draft.clips[0]?.id === selected} onClick={() => moveSelected(-1)}><CaretLeft size={16} /></button><button className="icon-button" aria-label="Move selected clip later" title="Move later" disabled={draft.clips.at(-1)?.id === selected} onClick={() => moveSelected(1)}><CaretRight size={16} /></button><button className="icon-button" aria-label="Reset selected trim" title="Reset trim" onClick={() => change(draft.clips.map(clip => clip.id === selected ? { ...clip, inFrame: 0, outFrame: selectedSource.frames } : clip))}><ArrowCounterClockwise size={16} /></button><button className="icon-button edit-remove-clip" aria-label="Remove selected clip from timeline" title="Remove clip" onClick={() => { change(draft.clips.filter(clip => clip.id !== selected)); seek(0); }}><Trash size={16} /></button></div></> : <span className="edit-selection-hint">Select a clip to adjust it. Hover over its edges to trim.</span>}</footer>
    </section>
    <div className="edit-export-footer"><span>{draft.mode === 'lossless' ? 'Lossless master · playable MP4 preview when needed' : 'Frame-accurate H.264 MP4 · high-quality re-encoding'}{mixedSize && ' · Different sizes are padded, never cropped'}</span><small>Runs on this computer · no GPU credits</small></div>
    {latest && <section className={`edit-export-status ${latest.status}`} aria-label="Local export status"><div>{latest.status === 'completed' ? <CheckCircle size={18} /> : latest.status === 'failed' ? <WarningCircle size={18} /> : <Scissors size={18} />}<span><strong>{latest.stage}</strong><small>{latest.error || latest.title}</small></span></div>{['queued', 'exporting'].includes(latest.status) && <><progress max={100} value={latest.percent} aria-label="Local export progress" /><span>{Math.floor(latest.percent)}%</span><button onClick={() => { void api(`/clip-editor/exports/${latest.id}/cancel`, {}).then(() => refreshExports()).catch(e => setError(e.message)); }}>Cancel export</button></>}{latest.resultJobId && <div className="edit-export-result"><button onClick={() => { stop(); setExportPreview(latest.resultJobId); }}>View export</button><a href={`/api/jobs/${latest.resultJobId}/video?download=1`}><DownloadSimple size={14} />Download {jobs.find(job => job.id === latest.resultJobId)?.edit?.format?.toUpperCase() || 'video'}</a></div>}</section>}
  </main>;
}
