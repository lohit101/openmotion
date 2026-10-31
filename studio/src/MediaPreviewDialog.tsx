import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Pause, Play, Scissors, SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react';
import type { Asset } from '../shared/types';
import {VideoPlayback} from './VideoPlayer';
import { clipTime, DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS, minimumClipFrames, normalizeClip, trimClip, type ClipSelection, type TrimAction } from '../shared/clip';
import './media-preview.css';

function VideoTrimmer({ asset, initial, fps, apply }: { asset: Asset; initial?: ClipSelection; fps: number; apply?: (selection: ClipSelection) => void }) {
  const normalized = normalizeClip(initial || { start: 0, seconds: DEFAULT_CLIP_SECONDS }, asset.duration, fps);
  const [selection, setSelection] = useState<ClipSelection>(normalized || { start: 0, seconds: asset.duration });
  const [playing, setPlaying] = useState(false), [muted, setMuted] = useState(true), [time, setTime] = useState(selection.start), [error, setError] = useState('');
  const [strip, setStrip] = useState<'loading' | 'ready' | 'failed'>('loading');
  const video = useRef<HTMLVideoElement>(null), track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ action: TrimAction; at: number; base: ClipSelection } | null>(null);
  const end = selection.start + selection.seconds;
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      if (video.current) {
        if (video.current.currentTime >= end - .01 || video.current.currentTime < selection.start - .04) video.current.currentTime = selection.start;
        setTime(video.current.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, selection.start, end]);
  const seek = (target: number) => { const point = Math.max(0, Math.min(asset.duration, target)); if (video.current && video.current.readyState >= 1) video.current.currentTime = point; setTime(point); };
  const change = (next: ClipSelection, action: TrimAction) => { video.current?.pause(); setSelection(next); seek(action === 'end' ? next.start + next.seconds - 1 / fps : next.start); };
  const pointAt = (clientX: number) => { const rect = track.current!.getBoundingClientRect(); return Math.max(0, Math.min(asset.duration, (clientX - rect.left) / rect.width * asset.duration)); };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!apply || !normalized || event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-trim]');
    const action = target?.dataset.trim as TrimAction | undefined, at = pointAt(event.clientX);
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); target?.focus();
    if (action) drag.current = { action, at, base: selection };
    else { const next = trimClip(selection, 'move', at - selection.seconds / 2, asset.duration, fps); change(next, 'move'); drag.current = { action: 'move', at, base: next }; }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { action, at, base } = drag.current, delta = pointAt(event.clientX) - at;
    const anchor = action === 'end' ? base.start + base.seconds : base.start;
    change(trimClip(base, action, anchor + delta, asset.duration, fps), action);
  };
  const keyTrim = (event: KeyboardEvent<HTMLButtonElement>, action: 'start' | 'end') => {
    const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : 0;
    if (!direction && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = action === 'start' ? selection.start : end;
    change(trimClip(selection, action, event.key === 'Home' ? 0 : event.key === 'End' ? asset.duration : current + direction * (event.shiftKey ? 10 : 1) / fps, asset.duration, fps), action);
  };
  const play = () => {
    if (!video.current) return;
    if (playing) video.current.pause();
    else { if (video.current.currentTime < selection.start || video.current.currentTime >= end - .02) seek(selection.start); void video.current.play().catch(() => setError('This video could not be played in the browser. Try an MP4 encoded with H.264.')); }
  };
  const startPercent = selection.start / asset.duration * 100, endPercent = end / asset.duration * 100;
  return <div className="video-trimmer">
    <div className="asset-video-stage"><video ref={video} src={`/api/assets/${asset.id}/original`} poster={`/api/assets/${asset.id}/poster`} playsInline preload="auto" muted={muted} onLoadedMetadata={() => seek(selection.start)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { if (playing && video.current) { seek(selection.start); void video.current.play().catch(() => setPlaying(false)); } }} onError={() => setError('This video could not be previewed. Try an MP4 encoded with H.264.')} onClick={play} aria-label="Uploaded video preview" />{!playing && !error && <button className="big-play" aria-label="Play selected clip" onClick={play}><Play size={27} weight="fill" /></button>}</div>
    <div className="clip-playback"><button className="icon-button" onClick={play} aria-label={playing ? 'Pause selected clip' : 'Play selected clip'}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><span>{clipTime(time)}</span><input aria-label="Preview selected clip" type="range" min={selection.start} max={end} step={1 / fps} value={Math.max(selection.start, Math.min(end, time))} onChange={event => { video.current?.pause(); seek(Number(event.target.value)); }} /><button className="icon-button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute preview' : 'Mute preview'}>{muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}</button></div>
    {apply && <div className="clip-editor"><div className="clip-editor-heading"><div><Scissors size={17} /><h3>Choose your clip</h3></div><span>Up to {MAX_CLIP_SECONDS} seconds</span></div>
      <div className="clip-filmstrip" ref={track} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} aria-label="Video trimming timeline">
        <img src={`/api/assets/${asset.id}/filmstrip`} alt="Frames across the uploaded video" className={strip === 'ready' ? 'ready' : ''} onLoad={() => setStrip('ready')} onError={() => setStrip('failed')} />
        {strip !== 'ready' && <div className="clip-strip-loading" style={{ backgroundImage: `url(/api/assets/${asset.id}/poster)` }}><span>{strip === 'loading' ? 'Loading video frames…' : 'Frame strip unavailable. You can still trim and preview.'}</span></div>}
        <div className="clip-outside before" style={{ width: `${startPercent}%` }} /><div className="clip-outside after" style={{ left: `${endPercent}%` }} />
        <div className="clip-selection" data-trim="move" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }} title="Drag to move the selected clip" />
        {normalized && <><button className="clip-handle start" data-trim="start" role="slider" aria-label="Trim start" aria-valuemin={Math.max(0, end - MAX_CLIP_SECONDS)} aria-valuemax={end - minimumClipFrames(fps) / fps} aria-valuenow={selection.start} aria-valuetext={clipTime(selection.start)} onKeyDown={event => keyTrim(event, 'start')} style={{ left: `${startPercent}%` }}><span /></button><button className="clip-handle end" data-trim="end" role="slider" aria-label="Trim end" aria-valuemin={selection.start + minimumClipFrames(fps) / fps} aria-valuemax={Math.min(asset.duration, selection.start + MAX_CLIP_SECONDS)} aria-valuenow={end} aria-valuetext={clipTime(end)} onKeyDown={event => keyTrim(event, 'end')} style={{ left: `${endPercent}%` }}><span /></button></>}
        <span className="clip-playhead" style={{ left: `${Math.max(0, Math.min(100, time / asset.duration * 100))}%` }} />
      </div><div className="clip-ruler"><span>{clipTime(0)}</span><span>{clipTime(asset.duration / 2)}</span><span>{clipTime(asset.duration)}</span></div>
      <div className="clip-selection-summary"><output aria-label="Selected clip range">{clipTime(selection.start)} <span>→</span> {clipTime(end)}</output><strong>{selection.seconds.toFixed(2)}s selected</strong></div><p className="clip-help">Drag the handles to trim, or drag the selection to move it. Use arrow keys on a handle for frame precision.</p>
      <footer className="clip-footer"><p>The original stays on your Mac. Only the selected clip is sent to the GPU.</p><button className="primary-button compact" disabled={!normalized || !!error} onClick={() => apply(selection)}><Check size={17} />Use this clip</button></footer>
    </div>}
    {!normalized && <p className="clip-error" role="alert">This video is too short for five frames at {fps} fps.</p>}{error && <p className="clip-error" role="alert">{error}</p>}
  </div>;
}

export default function MediaPreviewDialog({ asset, close, clip, fps = 24, apply }: { asset: Asset; close: () => void; clip?: ClipSelection; fps?: number; apply?: (selection: ClipSelection) => void }) {
  return <Dialog.Root open onOpenChange={value => { if (!value) close(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`asset-preview-dialog ${asset.kind === 'image' ? 'photo-only' : ''}`}>
    <header><div><Dialog.Title>{asset.name}</Dialog.Title><Dialog.Description className="visually-hidden">{asset.kind === 'image' ? 'Uploaded image preview' : apply ? `Preview the video and choose a clip of up to ${MAX_CLIP_SECONDS} seconds.` : 'Uploaded video preview'}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close media preview"><X size={20} /></Dialog.Close></header>
    {asset.kind === 'image' ? <div className="asset-photo-stage"><img src={`/api/assets/${asset.id}/original`} alt={asset.name} /></div> : apply ? <VideoTrimmer key={asset.id} asset={asset} initial={clip} fps={fps} apply={apply} /> : <div className="asset-playback-stage"><VideoPlayback src={`/api/assets/${asset.id}/original`} poster={`/api/assets/${asset.id}/poster`} width={asset.width} height={asset.height} label="Uploaded video preview"/></div>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
