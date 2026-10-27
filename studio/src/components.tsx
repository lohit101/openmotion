import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, CaretDown, X, UploadSimple, FilmStrip, Image as ImageIcon, Play, Pause, ArrowsOut, ArrowsIn, ArrowsHorizontal, SpeakerHigh, SpeakerSlash, Scissors, Eye } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { observeFullscreen, toggleFullscreen } from './fullscreen';
import type { Asset, Job } from '../shared/types';
import { clipTime, type ClipSelection } from '../shared/clip';
import MediaPreviewDialog from './MediaPreviewDialog';

export async function api<T>(route: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch('/api' + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || 'The request could not be completed.'); return value;
}
export function formatTime(seconds: number) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
export function SmallSelect({ value, onChange, options, label, disabled = false }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; disabled?: boolean }) {
  return <Select.Root value={value} onValueChange={onChange} disabled={disabled}><Select.Trigger className="select-trigger" aria-label={label}><Select.Value /><Select.Icon><CaretDown size={13} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper" sideOffset={5}><Select.Viewport>{options.map(item => <Select.Item key={item.value} value={item.value} className="select-item"><Select.ItemText>{item.label}</Select.ItemText><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root>;
}
export function Toggle({ label, checked, onChange, disabled = false, detail }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; detail?: string }) {
  return <label className="toggle-row"><span>{label}{detail && <small>{detail}</small>}</span><Switch.Root className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}><Switch.Thumb className="switch-thumb" /></Switch.Root></label>;
}
export function Modal({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function AssetDrop({ kind, asset, onAsset, onError, label, emptyLabel, clip, clipFps = 24, onClip }: {
  kind: 'video' | 'image'; asset?: Asset; onAsset: (a: Asset | null) => void; onError: (s: string) => void;
  label?: string; emptyLabel?: string; clip?: ClipSelection; clipFps?: number; onClip?: (selection: ClipSelection) => void;
}) {
  const input = useRef<HTMLInputElement>(null), request = useRef<XMLHttpRequest | null>(null);
  const [dragging, setDragging] = useState(false), [uploading, setUploading] = useState(false), [percent, setPercent] = useState(0), [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ asset: Asset; pending: boolean } | null>(null);
  const name = label || (kind === 'video' ? 'Motion video' : 'Character reference');
  useEffect(() => () => request.current?.abort(), []);
  const upload = (file?: File) => {
    if (!file || uploading) return;
    if (file.size > (kind === 'image' ? 25 : 512) * 1024 ** 2) { onError(kind === 'image' ? 'Images can be up to 25 MB.' : 'Videos can be up to 512 MB.'); return; }
    setUploading(true); setPercent(0); setChecking(false);
    const xhr = new XMLHttpRequest(); request.current = xhr; xhr.open('POST', '/api/assets/' + kind);
    xhr.upload.onprogress = event => { if (event.lengthComputable) setPercent(Math.round(event.loaded / event.total * 100)); };
    xhr.upload.onload = () => setChecking(true);
    xhr.onload = () => {
      setUploading(false); setChecking(false);
      try {
        const value: Asset & { error?: string } = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(value.error);
        if (kind === 'video' && onClip) setPreview({ asset: value, pending: true }); else onAsset(value);
      } catch (error) { onError(error instanceof Error ? error.message : 'Upload failed.'); }
    };
    xhr.onerror = () => { setUploading(false); onError('Upload interrupted. Check that the local app is running.'); };
    xhr.onabort = () => setUploading(false);
    const form = new FormData(); form.append('file', file); xhr.send(form);
  };
  return <div className="asset-field"><div className="field-heading"><span>{name}</span>{asset && <div className="asset-header-actions"><button className="asset-change-button" onClick={() => input.current?.click()} disabled={uploading} aria-label={`Replace ${name.toLowerCase()}`}><UploadSimple size={11} />Replace</button><button className="text-icon" onClick={() => onAsset(null)} aria-label={`Remove ${name.toLowerCase()}`}><X size={13} /></button></div>}</div>
    <input ref={input} type="file" accept={kind === 'video' ? 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v' : 'image/png,image/jpeg,image/webp'} hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    <button className={`asset-drop ${asset ? 'has-asset' : ''} ${dragging ? 'dragging' : ''}`} onClick={() => asset ? setPreview({ asset, pending: false }) : input.current?.click()} disabled={uploading} aria-label={asset ? `Preview ${name.toLowerCase()}${kind === 'video' && onClip ? ' and trim clip' : ''}` : `Upload ${name.toLowerCase()}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { onError('Drop one file at a time.'); return; } upload(e.dataTransfer.files[0]); }}>
      {asset ? <><img src={`/api/assets/${asset.id}/poster`} alt={name} /><span className="asset-replace">{kind === 'video' && onClip ? <Scissors size={16} /> : <Eye size={16} />}{kind === 'video' && onClip ? 'Preview & trim' : 'Preview'}</span></> : <div className="drop-empty">{kind === 'video' ? <FilmStrip size={28} weight="light" /> : <ImageIcon size={28} weight="light" />}<strong>{emptyLabel || (kind === 'video' ? 'Add a video' : 'Add a character')}</strong><span>or drop it here</span></div>}
      {uploading && <div className="upload-overlay"><span className="activity-line" /><strong>{checking ? 'Checking media' : `Uploading ${percent}%`}</strong></div>}
    </button><div className="asset-caption">{asset ? <><span title={asset.name}>{asset.name}</span><small>{kind === 'video' ? formatTime(asset.duration) : `${asset.width} × ${asset.height}`}</small></> : <small>{kind === 'video' ? 'MP4, MOV or WebM' : 'JPG, PNG or WebP'}</small>}</div>
    {asset && kind === 'video' && clip && onClip && <button className="asset-trim-caption" onClick={() => setPreview({ asset, pending: false })}><Scissors size={12} /><span>{clipTime(clip.start)} → {clipTime(clip.start + clip.seconds)} · {clip.seconds.toFixed(2)}s</span></button>}
    {preview && <MediaPreviewDialog asset={preview.asset} clip={preview.pending ? undefined : clip} fps={clipFps} close={() => setPreview(null)} apply={kind === 'video' && onClip ? selection => { if (preview.pending) onAsset(preview.asset); onClip(selection); setPreview(null); } : undefined} />}
  </div>;
}
export function VideoPlayer({ job, compare }: { job: Job; compare: boolean }) {
  const video = useRef<HTMLVideoElement>(null), before = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(3), [split, setSplit] = useState(50), [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (container.current) return observeFullscreen(container.current, setFullscreen);
  }, []);
  const changeFullscreen = async () => {
    if (!container.current) return;
    try {
      if (typeof container.current.requestFullscreen === 'function') await toggleFullscreen(container.current);
      else toast.error('Fullscreen is not available in this browser.');
    } catch { toast.error('Fullscreen could not be changed. Try again or press Esc to exit.'); }
  };
  useEffect(() => { setPlaying(false); setTime(0); setSplit(50); }, [job.id]);
  useEffect(() => { if (compare && before.current && video.current) { before.current.currentTime = video.current.currentTime; if (!video.current.paused) void before.current.play().catch(() => undefined); } else before.current?.pause(); }, [compare]);
  const play = () => { if (!video.current) return; if (video.current.paused) void video.current.play().catch(() => undefined); else video.current.pause(); };
  const sync = () => { const output = video.current, input = before.current; if (!output) return; setTime(output.currentTime); if (compare && input && Math.abs(input.currentTime - output.currentTime) > 0.08) input.currentTime = output.currentTime; };
  return <div className="player" ref={container}><div className="player-frame" style={{ aspectRatio: `${job.width}/${job.height}` }}>
    <video ref={video} key={job.id} src={`/api/jobs/${job.id}/video`} poster={`/api/jobs/${job.id}/poster`} muted={muted} playsInline preload="metadata" onLoadedMetadata={e => setDuration(e.currentTarget.duration)} onTimeUpdate={sync} onPlay={() => { setPlaying(true); if (compare) void before.current?.play().catch(() => undefined); }} onPause={() => { setPlaying(false); before.current?.pause(); }} onEnded={() => { setPlaying(false); before.current?.pause(); }} onClick={play} aria-label="Generated video" />
    {compare && <><video className="before-video" ref={before} src={`/api/jobs/${job.id}/source`} muted playsInline preload="auto" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-label="Original source video" /><div className="compare-labels"><span>Original</span><span>Generated</span></div><div className="compare-line" style={{ left: `${split}%` }}><span><ArrowsHorizontal size={17} /></span></div><input className="compare-range" type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} aria-label="Compare original and generated video" /></>}
    {!playing && !compare && <button className="big-play" onClick={play} aria-label="Play generated video"><Play size={25} weight="fill" /></button>}
  </div><div className="playback-controls"><button className="icon-button" onClick={play} aria-label={playing ? 'Pause video' : 'Play video'}>{playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}</button><span className="timecode">{formatTime(time)}</span><input type="range" className="seek" min={0} max={Number.isFinite(duration) ? duration : 3} step={0.01} value={Math.min(time, duration || 3)} onChange={e => { const n = Number(e.target.value); if (video.current) video.current.currentTime = n; if (before.current) before.current.currentTime = n; setTime(n); }} aria-label="Seek video" /><span className="timecode">{formatTime(duration)}</span><button className="icon-button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}</button><button className="icon-button" onClick={() => void changeFullscreen()} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} title={fullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'} aria-pressed={fullscreen}>{fullscreen ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}</button></div></div>;
}
