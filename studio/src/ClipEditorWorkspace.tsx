import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, CaretLeft, CaretRight, CheckCircle, DownloadSimple, FilmStrip, Heart, MagnifyingGlass, Minus, MusicNotes, Pause, Play, Plus, Scissors, SpeakerHigh, SpeakerSlash, Trash, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import type { Asset, Job } from '../shared/types';
import { clipTime } from '../shared/clip';
import { audioSourceKey, editEnvelope, hasEditEffects, clipPosterUrl, clipSourceKey, clipVideoUrl, clipSeconds, editDraftSchema, locateTimeline, timelineLayout, type ClipEditReceipt, type EditDraft, type EditorAudioSource, type EditorSource, type LocalExport, type TimelineClip, type TimelineAudio } from '../shared/clip-editor';
import { api, SmallSelect } from './components';
import { FieldLabel, InfoTip } from './InfoTip';
import ClipTimeline from './ClipTimeline';
import { editorVideoAccept, isEditorVideo, uploadEditorMedia, uploadEditorVideo } from './editor-import';
import EditorAudioLane from './EditorAudioLane';
import EditorAudioPreview from './EditorAudioPreview';
import EditorClipInspector from './EditorClipInspector';
import { toast } from 'sonner';
import { exportAlertEvent } from './useActivityAlerts';
import './clip-editor.css';

export interface EditorIntent { id: string; jobId?: string; receipt?: ClipEditReceipt; title?: string; }
function savedEditor(storageKey: string, enhanced: boolean): { draft: EditDraft; sources: Record<string, EditorSource> } {
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); return { draft: editDraftSchema.parse(saved.draft), sources: saved.sources || {} }; }
  catch { return { draft: { title: 'Untitled edit', mode: enhanced ? 'mp4' : 'lossless', clips: [], ...(enhanced ? { audioTracks: [] } : {}) }, sources: {} }; }
}

export default function ClipEditorWorkspace({ jobs, assets, assetAdded, intent, consumed, library, enhanced = false }: { jobs: Job[]; assets: Asset[]; assetAdded: (asset: Asset) => void; intent: EditorIntent | null; consumed: (id: string) => void; library: () => void; enhanced?: boolean }) {
  const storageKey = enhanced ? 'recast-kie-clip-editor-v2' : 'recast-clip-editor-v1';
  const [initial] = useState(() => savedEditor(storageKey, enhanced)), [draft, setDraft] = useState(initial.draft), [sources, setSources] = useState(initial.sources);
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null), [audioSources, setAudioSources] = useState<EditorAudioSource[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.draft.clips[0]?.id || null), [query, setQuery] = useState(''), [favourites, setFavourites] = useState(false);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(false), [zoom, setZoom] = useState(55);
  const [adding, setAdding] = useState<string | null>(null), [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const [exports, setExports] = useState<LocalExport[]>([]), [exportPreview, setExportPreview] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ name: string; index: number; total: number; percent: number } | null>(null);
  const [sourceTab, setSourceTab] = useState<'library' | 'imports'>('library');
  const filePicker = useRef<HTMLInputElement>(null), audioPicker = useRef<HTMLInputElement>(null), importAbort = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement>(null), playingRef = useRef(false), timeRef = useRef(time), rowsRef = useRef<ReturnType<typeof timelineLayout>>([]), request = useRef<{ body: string; key: string } | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  const handledIntent = useRef<string | null>(null);
  const watchedExports = useRef(new Set<string>());
  const rows = timelineLayout(draft.clips, sources), duration = rows.at(-1)?.end || 0, at = locateTimeline(draft.clips, sources, time);
  const audioTracks = draft.audioTracks || [], audio = audioTracks.find(track => track.id === selectedAudio);
  const audioInfo = { ...Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, { title: source.title, duration: source.duration }])), ...Object.fromEntries(audioSources.map(source => [`audio:${source.audioId}`, { title: source.title, duration: source.duration }])) };
  rowsRef.current = rows; timeRef.current = time;
  useEffect(() => { if (selected) setSelectedAudio(null); }, [selected]);
  const selectedClip = draft.clips.find(clip => clip.id === selected), selectedSource = selectedClip && sources[clipSourceKey(selectedClip)];
  const available = jobs.filter(job => !job.anchorChild && !job.deleted && job.mediaType !== 'image' && job.status === 'completed' && !!job.output && (!favourites || job.favorite) && job.title.toLowerCase().includes(query.toLowerCase()));
  const imported = Object.values(sources).filter(source => source.assetId && assets.some(asset => asset.id === source.assetId) && source.title.toLowerCase().includes(query.toLowerCase()));
  const latest = exports[0], working = exports.some(row => ['queued', 'exporting'].includes(row.status));
  const stop = useCallback(() => { playingRef.current = false; video.current?.pause(); setPlaying(false); }, []);
  const seek = useCallback((point: number) => { stop(); setExportPreview(null); const rows = rowsRef.current, end = rows.at(-1)?.end || 0; const target = Math.max(0, Math.min(end, point)); timeRef.current = target; setTime(target); }, [stop]);
  const change = (clips: EditDraft['clips']) => { stop(); setExportPreview(null); setDraft(old => ({ ...old, clips })); };
  const changeAudio = (tracks: TimelineAudio[]) => { stop(); setExportPreview(null); setDraft(old => ({ ...old, mode: 'mp4', audioTracks: tracks })); };
  const changeClip = (patch: Partial<TimelineClip>) => { stop(); setExportPreview(null); setDraft(old => ({ ...old, mode: 'mp4', clips: old.clips.map(clip => clip.id === selected ? { ...clip, ...patch } : clip) })); };
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify({ draft, sources })); } catch { /* The current edit still works without storage. */ } }, 250); return () => clearTimeout(timer); }, [draft, sources]);
  useEffect(() => { const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({ draft: draftRef.current, sources: sourcesRef.current })); } catch { /* Keep the in-memory edit usable. */ } }; window.addEventListener('pagehide', save); return () => { window.removeEventListener('pagehide', save); save(); }; }, []);
  useEffect(() => { if (time > duration) seek(duration); if (selected && !draft.clips.some(clip => clip.id === selected)) setSelected(draft.clips[0]?.id || null); }, [draft.clips, duration, selected, time, seek]);
  const sourceInfo = useCallback(async (jobId: string) => { const meta = await api<EditorSource>(`/clip-editor/sources/${encodeURIComponent(jobId)}`); setSources(old => ({ ...old, [jobId]: meta })); return meta; }, []);
  useEffect(() => { let disposed = false; void api<EditorSource[]>('/clip-editor/imports').then(items => { if (!disposed) setSources(old => ({ ...old, ...Object.fromEntries(items.map(item => [clipSourceKey(item), item])) })); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, []);
  useEffect(() => { if (!enhanced) return; let disposed = false; void api<EditorAudioSource[]>('/clip-editor/audio').then(items => { if (!disposed) setAudioSources(items); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, [enhanced]);
  const add = useCallback(async (jobId: string) => {
    if (draftRef.current.clips.length >= 32) { setError('A timeline can hold up to 32 clips.'); return; }
    setAdding(jobId); setError(''); stop(); setExportPreview(null);
    try { const meta = await sourceInfo(jobId), clip = { id: crypto.randomUUID(), ...(meta.assetId ? { assetId: meta.assetId } : { jobId: meta.jobId! }), inFrame: 0, outFrame: meta.frames }; seek(rowsRef.current.at(-1)?.end || 0); setDraft(old => old.clips.length >= 32 ? old : { ...old, clips: [...old.clips, clip] }); setSelected(clip.id); }
    catch (e) { setError((e as Error).message); } finally { setAdding(null); }
  }, [sourceInfo, stop, seek]);
  useEffect(() => () => importAbort.current?.abort(), []);
  const importVideos = async (files: File[], index = draftRef.current.clips.length) => {
    if (importAbort.current || !files.length) return;
    const room = 32 - draftRef.current.clips.length;
    if (files.length > room) { setError(`There is room for ${room} more ${room === 1 ? 'clip' : 'clips'}. Drop fewer videos or remove a timeline clip.`); return; }
    const controller = new AbortController(); importAbort.current = controller;
    const anchor = draftRef.current.clips[index]?.id;
    const clips: EditDraft['clips'] = [], failures: string[] = [];
    stop(); setExportPreview(null); setError(''); setSourceTab('imports');
    try {
      for (const [offset, file] of files.entries()) {
        controller.signal.throwIfAborted();
        if (!isEditorVideo(file)) { failures.push(`${file.name}: choose a video file.`); continue; }
        if (file.size > 512 * 1024 ** 2) { failures.push(`${file.name}: videos can be up to 512 MB each.`); continue; }
        setImporting({ name: file.name, index: offset + 1, total: files.length, percent: 0 });
        try {
          const asset = await uploadEditorVideo(file, percent => { if (!controller.signal.aborted) setImporting({ name: file.name, index: offset + 1, total: files.length, percent }); }, controller.signal, enhanced);
          assetAdded(asset); controller.signal.throwIfAborted();
          const meta = await api<EditorSource>('/clip-editor/imports', { assetId: asset.id }); controller.signal.throwIfAborted();
          setSources(old => ({ ...old, [clipSourceKey(meta)]: meta }));
          clips.push({ id: crypto.randomUUID(), assetId: asset.id, inFrame: 0, outFrame: meta.frames });
        } catch (e) { if (controller.signal.aborted) throw e; failures.push(`${file.name}: ${(e as Error).message}`); }
      }
      controller.signal.throwIfAborted();
      if (clips.length) {
        seek(anchor ? rowsRef.current.find(row => row.clip.id === anchor)?.start ?? duration : rowsRef.current.at(-1)?.end || 0);
        setDraft(old => { const next = [...old.clips], at = anchor ? next.findIndex(clip => clip.id === anchor) : next.length; next.splice(at < 0 ? next.length : at, 0, ...clips.slice(0, 32 - next.length)); return { ...old, clips: next }; });
        setSelected(clips[0].id);
      }
      if (failures.length) setError(failures.join(' '));
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (importAbort.current === controller) { importAbort.current = null; setImporting(null); } }
  };
  const importMusic = async (file: File) => {
    if (importAbort.current || !draftRef.current.clips.length || (draftRef.current.audioTracks?.length || 0) >= 16) return;
    if (file.size > 100 * 1024 ** 2) { setError('Audio files can be up to 100 MB.'); return; }
    const controller = new AbortController(); importAbort.current = controller; stop(); setExportPreview(null); setError('');
    setImporting({ name: file.name, index: 1, total: 1, percent: 0 });
    try {
      const meta = await uploadEditorMedia<EditorAudioSource>(file, percent => setImporting({ name: file.name, index: 1, total: 1, percent }), controller.signal, '/api/clip-editor/audio');
      setAudioSources(old => [meta, ...old.filter(item => item.audioId !== meta.audioId)]);
      const track: TimelineAudio = { id: crypto.randomUUID(), audioId: meta.audioId, start: 0, inSeconds: 0, outSeconds: Math.min(meta.duration, duration), volume: 1 };
      changeAudio([...(draftRef.current.audioTracks || []), track]); setSelectedAudio(track.id); setSelected(null);
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (importAbort.current === controller) { importAbort.current = null; setImporting(null); } }
  };
  useEffect(() => {
    let disposed = false;
    const missing = [...new Set([...draft.clips.map(clipSourceKey), ...audioTracks.filter(track => !track.audioId).map(clipSourceKey)])].filter(id => !sources[id]);
    void (async () => { for (const id of missing) { if (disposed) return; try { await sourceInfo(id); } catch (e) { if (!disposed) setError((e as Error).message); } } })();
    return () => { disposed = true; };
  }, [[...draft.clips.map(clipSourceKey), ...audioTracks.map(audioSourceKey)].join('|'), sourceInfo]);
  useEffect(() => {
    if (!intent || handledIntent.current === intent.id) return;
    handledIntent.current = intent.id;
    const load = async () => {
      if (intent.receipt) {
        importAbort.current?.abort();
        stop(); setExportPreview(null); setError('');
        const clips = intent.receipt.sources.map(({ title: _title, fps: _fps, sourceFrames: _frames, width: _width, height: _height, ...item }) => ({ ...item, id: crypto.randomUUID() }));
        const tracks = intent.receipt.audioTracks?.map(({ title: _title, ...item }) => ({ ...item, id: crypto.randomUUID() }));
        setDraft({ title: intent.title || 'Untitled edit', mode: intent.receipt.mode, clips, ...(tracks ? { audioTracks: tracks } : {}) }); setSelected(clips[0]?.id || null); setSelectedAudio(null); seek(0);
        for (const id of [...new Set(clips.map(clipSourceKey))]) await sourceInfo(id);
      } else if (intent.jobId) await add(intent.jobId);
    };
    void load().catch(e => setError(e.message)).finally(() => consumed(intent.id));
  }, [intent?.id]);
  const refreshExports = useCallback(async () => { const rows = await api<LocalExport[]>('/clip-editor/exports'); setExports(rows); }, []);
  useEffect(() => { void refreshExports().catch(e => setError(e.message)); }, [refreshExports]);
  useEffect(() => { if (!working) return; const timer = setInterval(() => { void refreshExports().catch(e => setError(e.message)); }, 1000); return () => clearInterval(timer); }, [working, refreshExports]);
  useEffect(() => {
    for (const row of exports) {
      if (['queued', 'exporting'].includes(row.status)) { watchedExports.current.add(row.id); continue; }
      if (!watchedExports.current.delete(row.id)) continue;
      if (row.status === 'cancelled') toast.info('Export cancelled', { description: 'Your source clips and timeline are unchanged.' });
    }
  }, [exports]);
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
  useEffect(() => { if (video.current && at && enhanced) video.current.volume = (at.clip.volume ?? 1) * editEnvelope(time - at.start, at.duration, at.clip.audioFadeIn, at.clip.audioFadeOut); }, [at?.clip.volume, at?.clip.audioFadeIn, at?.clip.audioFadeOut, at?.clip.id, time, enhanced]);
  const detach = () => {
    if (!selectedClip || !selectedSource?.hasAudio || audioTracks.length >= 16) return;
    const row = rows.find(item => item.clip.id === selectedClip.id)!;
    const track: TimelineAudio = { id: crypto.randomUUID(), ...(selectedClip.assetId ? { assetId: selectedClip.assetId } : { jobId: selectedClip.jobId }), start: row.start, inSeconds: selectedClip.inFrame / selectedSource.fps, outSeconds: selectedClip.outFrame / selectedSource.fps, volume: selectedClip.volume ?? 1, audioFadeIn: selectedClip.audioFadeIn, audioFadeOut: selectedClip.audioFadeOut };
    changeClip({ muted: true }); changeAudio([...audioTracks, track]); setSelectedAudio(track.id); setSelected(null);
  };
  const selectedRow = rows.find(row => row.clip.id === selected), splitFrame = selectedSource && selectedRow ? Math.round(selectedClip!.inFrame + (time - selectedRow.start) * selectedSource.fps) : 0;
  const canSplit = !!selectedClip && splitFrame > selectedClip.inFrame && splitFrame < selectedClip.outFrame && draft.clips.length < 32;
  const split = () => { if (!selectedClip || !canSplit) return; const next = { ...selectedClip, id: crypto.randomUUID(), inFrame: splitFrame, fadeIn: 0, blurIn: 0, audioFadeIn: 0 }; change(draft.clips.flatMap(clip => clip.id === selectedClip.id ? [{ ...clip, outFrame: splitFrame, fadeOut: 0, blurOut: 0, audioFadeOut: 0 }, next] : [clip])); setSelected(next.id); };
  const submit = async () => {
    if (!draft.title.trim()) { setError('Give your edit a name before exporting.'); return; }
    setSubmitting(true); setError(''); stop();
    try {
      const value = editDraftSchema.parse(draft), body = JSON.stringify(value);
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const response = await fetch('/api/clip-editor/exports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current!.key }, body });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The export could not start.');
      request.current = null; watchedExports.current.add(result.id); setExports(old => [result, ...old.filter(row => row.id !== result.id)]);
      window.dispatchEvent(new CustomEvent(exportAlertEvent, { detail: result }));
    } catch (e) { setError((e as Error).message); toast.error('Export could not start', { description: (e as Error).message }); } finally { setSubmitting(false); }
  };
  const moveSelected = (direction: number) => { const index = draft.clips.findIndex(clip => clip.id === selected), next = [...draft.clips]; if (index < 0 || index + direction < 0 || index + direction >= next.length) return; [next[index], next[index + direction]] = [next[index + direction], next[index]]; change(next); seek(0); };
  const missing = draft.clips.some(clip => !sources[clipSourceKey(clip)] || (clip.assetId ? !assets.some(asset => asset.id === clip.assetId && asset.kind === 'video') : !jobs.some(job => job.id === clip.jobId && !job.deleted && job.status === 'completed')));
  const mixedSize = rows.some(row => row.source.width !== rows[0]?.source.width || row.source.height !== rows[0]?.source.height);
  const formatIssue = draft.mode === 'lossless' && rows.length > 1 && rows.some(row => Math.abs(row.source.fps - rows[0].source.fps) > .001 || ['pixelFormat', 'colorRange', 'colorSpace', 'colorTransfer', 'colorPrimaries'].some(key => row.source[key as keyof EditorSource] !== rows[0].source[key as keyof EditorSource]));
  const effectIssue = draft.mode === 'lossless' && hasEditEffects(draft), missingAudio = audioTracks.some(track => !audioInfo[audioSourceKey(track)]);
  return <main className={`clip-editor-workspace ${enhanced ? 'edit-enhanced' : ''}`}><input ref={audioPicker} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importMusic(file); }} /><input ref={filePicker} type="file" accept={editorVideoAccept} multiple hidden onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void importVideos(files); }} /><header className="edit-workspace-header"><div><span className="workspace-overline">LOCAL VIDEO TOOLS</span><h1><Scissors size={24} />Clip editor</h1><p>{enhanced ? 'Trim, join, add sound and finish your clips.' : 'Trim, arrange, and make one video.'}</p></div><div className="edit-export-controls"><div><FieldLabel label="Export" help="Lossless keeps decoded image quality: compatible whole clips copy directly; exact cuts produce an FFV1 MKV master plus a playable MP4 preview. High-quality MP4 re-encodes at CRF 16. All work runs on this computer. Effects and separate audio require High-quality MP4. No Kie credits are used." /><SmallSelect label="Export format" value={draft.mode} onChange={mode => setDraft(old => ({ ...old, mode: mode as EditDraft['mode'] }))} options={[{ value: 'lossless', label: 'Lossless master' }, { value: 'mp4', label: 'High-quality MP4' }]} /></div><button className="primary-button" disabled={submitting || !!importing || !!adding || !draft.clips.length || missing || missingAudio || working || formatIssue || effectIssue || duration > 600} onClick={() => void submit()}><DownloadSimple size={16} />{submitting ? 'Starting…' : working ? 'Exporting…' : 'Export video'}</button></div></header>
    {error && <div className="edit-error" role="alert"><WarningCircle size={17} /><span>{error}</span></div>}
    {duration > 600 && <div className="edit-format-note" role="status">Keep this lightweight edit under ten minutes to export. Remove or shorten a clip.</div>}
    {effectIssue && <div className="edit-format-note" role="status">Effects and separate audio need an MP4 export.<button onClick={() => setDraft(old => ({ ...old, mode: 'mp4' }))}>Use high-quality MP4</button></div>}
    {formatIssue && <div className="edit-format-note" role="status">These clips have different frame rates or color formats. Lossless export needs a matching set.<button onClick={() => setDraft(old => ({ ...old, mode: 'mp4' }))}>Use high-quality MP4</button></div>}
    {submitting ? <section className="edit-export-status" role="status"><div><Scissors size={18} /><span><strong>Starting your export</strong><small>Checking source clips on this computer…</small></span></div></section> : latest && <section className={`edit-export-status ${latest.status}`} aria-label="Local export status" role="status"><div>{latest.status === 'completed' ? <CheckCircle size={18} /> : latest.status === 'failed' ? <WarningCircle size={18} /> : <Scissors size={18} />}<span><strong>{latest.status === 'completed' ? 'Your video is ready' : latest.stage}</strong><small>{latest.error || `${latest.title}${latest.status === 'completed' ? ' · Saved to your library' : ''}`}</small></span></div>{['queued', 'exporting'].includes(latest.status) && <><progress max={100} value={latest.percent} aria-label="Local export progress" /><span>{Math.floor(latest.percent)}%</span><button onClick={() => { void api(`/clip-editor/exports/${latest.id}/cancel`, {}).then(() => refreshExports()).catch(e => setError(e.message)); }}>Cancel export</button></>}{latest.resultJobId && <div className="edit-export-result"><button onClick={() => { stop(); setExportPreview(latest.resultJobId); }}>View export</button><a className="edit-download" download href={`/api/jobs/${latest.resultJobId}/video?download=1`}><DownloadSimple size={14} />Download {jobs.find(job => job.id === latest.resultJobId)?.edit?.format?.toUpperCase() || (latest.mode === 'mp4' ? 'MP4' : 'master')}</a></div>}</section>}
    <div className="edit-main-grid"><aside className="edit-source-browser" aria-label="Available video clips">
      <div className="edit-source-heading"><h2>Videos</h2>{sourceTab === 'library' && <button type="button" className={favourites ? 'active' : ''} aria-pressed={favourites} title="Show favourites" aria-label="Show favourite videos" onClick={() => setFavourites(!favourites)}><Heart size={16} weight={favourites ? 'fill' : 'regular'} /></button>}</div>
      <div className="edit-source-tabs" role="tablist" aria-label="Video sources">{(['library', 'imports'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={sourceTab === tab} onClick={() => setSourceTab(tab)}>{tab === 'library' ? 'Library' : 'Imported'}</button>)}</div>
      <label className="edit-source-search"><MagnifyingGlass size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a video" aria-label="Search editor videos" /></label>
      <div className="edit-source-list">{sourceTab === 'library' ? <>{available.map(job => <button type="button" key={job.id} className="edit-source-item" disabled={!!adding || !!importing || draft.clips.length >= 32} aria-label={`Add ${job.title} to timeline`} onClick={() => void add(job.id)}><div><img src={`/api/jobs/${job.id}/poster`} alt="" loading="lazy" draggable={false} /><span>{draft.clips.filter(clip => clip.jobId === job.id).length || <Plus size={14} />}</span></div><span><strong title={job.title}>{job.title}</strong><small>{job.edit?.duration.toFixed(2) || (job.progress.targetFrames / job.settings.fps).toFixed(2)}s · {job.edit ? 'Local edit' : `${job.width} × ${job.height}`}{adding === job.id ? ' · Adding…' : ''}</small></span></button>)}{!available.length && <p className="edit-empty-source">{query || favourites ? 'No matching videos.' : 'Completed videos from your library appear here.'}</p>}</> : <>{imported.map(source => <button type="button" key={clipSourceKey(source)} className="edit-source-item" disabled={!!adding || !!importing || draft.clips.length >= 32} aria-label={`Add ${source.title} to timeline`} onClick={() => void add(clipSourceKey(source))}><div><img src={clipPosterUrl(source)} alt="" loading="lazy" draggable={false} /><span>{draft.clips.filter(clip => clip.assetId === source.assetId).length || <Plus size={14} />}</span></div><span><strong title={source.title}>{source.title}</strong><small>{source.duration.toFixed(2)}s · {source.width} × {source.height}</small></span></button>)}{!imported.length && <p className="edit-empty-source">{query ? 'No matching imports.' : 'Drop videos onto the timeline or choose Add videos. Files stay on this computer.'}</p>}</>}</div>
      <button className="edit-open-library" onClick={library}>Open full library<CaretRight size={13} /></button>
    </aside>
      <section className="edit-preview-area" aria-label="Timeline preview"><div className="edit-project-title"><input aria-label="Edit title" value={draft.title} maxLength={120} onChange={event => setDraft(old => ({ ...old, title: event.target.value }))} placeholder="Name your edit" /><span>{draft.clips.length} {draft.clips.length === 1 ? 'clip' : 'clips'} · {clipTime(duration)}</span></div><div className="edit-preview-stage">{exportPreview ? <><video key={exportPreview} controls playsInline src={`/api/jobs/${exportPreview}/video`} aria-label="Exported video preview" /><button className="edit-return-timeline" onClick={() => setExportPreview(null)}>Back to timeline</button></> : at ? <video key={at.clip.id} ref={video} src={clipVideoUrl(at.clip)} poster={clipPosterUrl(at.clip)} muted={muted || !!(enhanced && at.clip.muted)} style={enhanced ? { opacity: editEnvelope(time - at.start, at.duration, at.clip.fadeIn, at.clip.fadeOut), filter: `blur(${12 * (1 - editEnvelope(time - at.start, at.duration, at.clip.blurIn, at.clip.blurOut))}px)` } : undefined} playsInline preload="auto" onLoadedMetadata={onReady} onCanPlay={() => { if (playingRef.current) void video.current?.play().catch(() => stop()); }} onClick={play} onError={() => { stop(); setError('This clip could not be previewed. Its original file is unchanged.'); }} aria-label="Timeline video preview" /> : <div className="edit-preview-empty"><FilmStrip size={38} weight="light" /><h2>A few clips. One story.</h2><p>Drop your videos onto the timeline, or add clips from the Library.</p></div>}</div><div className="edit-preview-controls"><button type="button" className="icon-button" aria-label="Return to timeline start" disabled={!rows.length || !!exportPreview} onClick={() => seek(0)}><ArrowCounterClockwise size={16} /></button><button type="button" className="edit-play" aria-label={playing ? 'Pause timeline' : 'Play timeline'} disabled={!rows.length || !!exportPreview} onClick={play}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><span>{clipTime(time)}<small> / {clipTime(duration)}</small></span><input className="edit-preview-seek" type="range" min={0} max={duration || 1} step={1 / (at?.source.fps || 24)} value={Math.min(time, duration)} disabled={!rows.length || !!exportPreview} onChange={event => seek(Number(event.target.value))} aria-label="Seek timeline" /><button type="button" className="icon-button" aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(!muted)}>{muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}</button></div></section></div>
    {enhanced && <div hidden><EditorAudioPreview tracks={audioTracks} time={time} playing={playing && !exportPreview} muted={muted} error={() => { stop(); setError('Audio preview could not play. Press Play again, or check that the source is still available.'); }} /></div>}
    <section className="edit-timeline-panel" aria-label="Video timeline editor"><header><div><h2>Timeline</h2><InfoTip label="Timeline editing">Drag either edge to trim directly. Drag a clip's body to reorder it. Focus an edge and use arrow keys for one-frame adjustments, or Shift + arrows for ten frames. Hold a dragged trim handle near the timeline edge to reach footage outside the visible area. Home and End jump to source boundaries. Drop local video files onto the timeline to insert them at the highlighted position. Originals stay unchanged.</InfoTip></div><div className="edit-timeline-tools"><button type="button" className="edit-add-videos" disabled={!!importing || !!adding || draft.clips.length >= 32} onClick={() => filePicker.current?.click()}><UploadSimple size={15} />Add videos</button>{enhanced && <button type="button" className="edit-add-videos" disabled={!!importing || !draft.clips.length || audioTracks.length >= 16} onClick={() => audioPicker.current?.click()}><MusicNotes size={15} />Add audio</button>}<button type="button" className="icon-button" aria-label="Zoom timeline out" disabled={zoom <= 15} onClick={() => setZoom(value => Math.max(15, value - 15))}><Minus size={14} /></button><input type="range" min={15} max={160} value={zoom} step={5} onChange={event => setZoom(Number(event.target.value))} aria-label="Timeline zoom" /><button type="button" className="icon-button" aria-label="Zoom timeline in" disabled={zoom >= 160} onClick={() => setZoom(value => Math.min(160, value + 15))}><Plus size={14} /></button></div></header>
      <ClipTimeline clips={draft.clips} sources={sources} selected={selected} select={id => { setSelected(id); setSelectedAudio(null); }} change={change} seek={seek} time={time} zoom={zoom} importFiles={(files, index) => { void importVideos(files, index); }} importing={!!importing || !!adding} audioLane={enhanced ? <EditorAudioLane tracks={audioTracks} sources={audioInfo} selected={selectedAudio} select={id => { setSelectedAudio(id); setSelected(null); }} change={changeAudio} seek={seek} zoom={zoom} duration={duration} /> : undefined} />
      {importing && <div className="edit-import-progress" role="status"><UploadSimple size={16} /><span><strong>{importing.percent < 100 ? `Importing ${importing.index} of ${importing.total}` : 'Preparing clip'}</strong><small title={importing.name}>{importing.name}</small></span><progress max={100} value={importing.percent} aria-label="Local video upload progress" /><small>{importing.percent}%</small><button type="button" onClick={() => importAbort.current?.abort()}>Cancel</button></div>}
      <footer className="edit-selection-bar">{selectedClip && selectedSource ? <><span><strong title={selectedSource.title}>{selectedSource.title}</strong><small>{clipTime(selectedClip.inFrame / selectedSource.fps)} → {clipTime(selectedClip.outFrame / selectedSource.fps)} · {clipSeconds(selectedClip, selectedSource).toFixed(2)}s</small></span><div><button className="icon-button" aria-label="Move selected clip earlier" title="Move earlier" disabled={draft.clips[0]?.id === selected} onClick={() => moveSelected(-1)}><CaretLeft size={16} /></button><button className="icon-button" aria-label="Move selected clip later" title="Move later" disabled={draft.clips.at(-1)?.id === selected} onClick={() => moveSelected(1)}><CaretRight size={16} /></button><button className="icon-button" aria-label="Reset selected trim" title="Reset trim" onClick={() => change(draft.clips.map(clip => clip.id === selected ? { ...clip, inFrame: 0, outFrame: selectedSource.frames } : clip))}><ArrowCounterClockwise size={16} /></button><button className="icon-button edit-remove-clip" aria-label="Remove selected clip from timeline" title="Remove clip" onClick={() => { change(draft.clips.filter(clip => clip.id !== selected)); seek(0); }}><Trash size={16} /></button></div></> : <span className="edit-selection-hint">Select a clip to adjust it. Hover over its edges to trim.</span>}</footer>
    </section>
    {enhanced && <EditorClipInspector clip={selectedClip} source={selectedSource} audio={audio} audioTitle={audio && audioInfo[audioSourceKey(audio)]?.title} audioDuration={audio && audioInfo[audioSourceKey(audio)]?.duration} timelineDuration={duration} changeClip={changeClip} changeAudio={patch => changeAudio(audioTracks.map(track => track.id === selectedAudio ? { ...track, ...patch } : track))} detach={detach} removeAudio={() => { changeAudio(audioTracks.filter(track => track.id !== selectedAudio)); setSelectedAudio(null); }} split={split} canSplit={canSplit} canDetach={!!selectedSource?.hasAudio && !selectedClip?.muted && audioTracks.length < 16} />}
    <div className="edit-export-footer"><span>{draft.mode === 'lossless' ? 'Lossless master · playable MP4 preview when needed' : 'Frame-accurate H.264 MP4 · high-quality re-encoding'}{mixedSize && ' · Different sizes are padded, never cropped'}</span><small>Runs on this computer · no API credits</small></div>

  </main>;
}
