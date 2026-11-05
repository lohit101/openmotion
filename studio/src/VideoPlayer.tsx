import {useEffect,useRef,useState} from 'react';
import {ArrowsIn,ArrowsOut,ArrowsHorizontal,Pause,Play,SpeakerHigh,SpeakerSlash} from '@phosphor-icons/react';
import {toast} from 'sonner';
import type {Job} from '../shared/types';
import {observeFullscreen,toggleFullscreen} from './fullscreen';

export function formatTime(seconds: number) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }

export function VideoPlayer({ job, compare }: { job: Job; compare: boolean }) {
  return <VideoPlayback src={`/api/jobs/${job.id}/video`} poster={`/api/jobs/${job.id}/poster`} width={job.width} height={job.height} label="Generated video" nativeFullscreen={!!job.kie} compareSrc={compare?`/api/jobs/${job.id}/source`:undefined}/>;
}

export function VideoPlayback({src,poster,width,height,label='Video',compareSrc,nativeFullscreen=false}:{src:string;poster?:string;width:number;height:number;label?:string;compareSrc?:string;nativeFullscreen?:boolean}) {
  const compare=!!compareSrc;
  const video = useRef<HTMLVideoElement>(null), before = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [split, setSplit] = useState(50), [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (container.current) return observeFullscreen(container.current, setFullscreen, nativeFullscreen ? video.current || undefined : undefined);
  }, [src, nativeFullscreen]);
  const changeFullscreen = async () => {
    if (!container.current) return;
    try {
      await toggleFullscreen(container.current, nativeFullscreen ? video.current || undefined : undefined);
    } catch { toast.error('Fullscreen could not be changed. Try again or press Esc to exit.'); }
  };
  useEffect(() => { setPlaying(false); setTime(0); setDuration(Number.isFinite(video.current?.duration)?video.current!.duration:0); setSplit(50); }, [src]);
  useEffect(() => { if (compare && before.current && video.current) { before.current.currentTime = video.current.currentTime; if (!video.current.paused) void before.current.play().catch(() => undefined); } else before.current?.pause(); }, [compare]);
  const play = () => { if (!video.current) return; if (video.current.paused) void video.current.play().catch(() => undefined); else video.current.pause(); };
  const sync = () => { const output = video.current, input = before.current; if (!output) return; setTime(output.currentTime); if (compare && input && Math.abs(input.currentTime - output.currentTime) > 0.08) input.currentTime = output.currentTime; };
  return <div className="player" ref={container}><div className="player-frame" style={{ aspectRatio: fullscreen?undefined:`${width}/${height}` }}>
    <video ref={video} key={src} src={src} poster={poster} muted={muted} playsInline preload="metadata" onLoadedMetadata={e => setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onTimeUpdate={sync} onPlay={() => { setPlaying(true); if (compare) void before.current?.play().catch(() => undefined); }} onPause={() => { setPlaying(false); before.current?.pause(); }} onEnded={() => { setPlaying(false); before.current?.pause(); }} onClick={play} aria-label={label} />
    {compare && <><video className="before-video" ref={before} src={compareSrc} muted playsInline preload="auto" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-label="Original source video" /><div className="compare-labels"><span>Original</span><span>Generated</span></div><div className="compare-line" style={{ left: `${split}%` }}><span><ArrowsHorizontal size={17} /></span></div><input className="compare-range" type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} aria-label="Compare original and generated video" /></>}
    {!playing && !compare && <button className="big-play" onClick={play} aria-label={label==='Generated video'?'Play generated video':'Play '+label.toLowerCase()}><Play size={25} weight="fill" /></button>}
  </div><div className="playback-controls"><button className="icon-button" onClick={play} aria-label={playing ? 'Pause video' : 'Play video'}>{playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}</button><span className="timecode">{formatTime(time)}</span><input type="range" className="seek" min={0} max={duration||0} disabled={!duration} step={0.01} value={Math.min(time, duration||0)} onChange={e => { const n = Number(e.target.value); if (video.current) video.current.currentTime = n; if (before.current) before.current.currentTime = n; setTime(n); }} aria-label="Seek video" /><span className="timecode">{formatTime(duration)}</span><button className="icon-button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}</button><button className="icon-button" onClick={() => void changeFullscreen()} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} title={fullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'} aria-pressed={fullscreen}>{fullscreen ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}</button></div></div>;
}
