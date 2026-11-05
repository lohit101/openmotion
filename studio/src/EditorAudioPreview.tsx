import { useEffect, useRef } from 'react';
import { audioPreviewUrl, editEnvelope, type TimelineAudio } from '../shared/clip-editor';

interface Props { tracks: TimelineAudio[]; time: number; playing: boolean; muted: boolean; error: () => void; }
function AudioTrackPreview({ track, time, playing, muted, error }: Omit<Props, 'tracks'> & { track: TimelineAudio }) {
  const player = useRef<HTMLAudioElement>(null), blocked = useRef(false), report = useRef(error), desired = useRef(false); report.current = error;
  desired.current = playing && time >= track.start && time < track.start + track.outSeconds - track.inSeconds;
  const sync = () => {
    const node = player.current; if (!node) return;
    const local = time - track.start, duration = track.outSeconds - track.inSeconds, active = local >= 0 && local < duration;
    const target = track.inSeconds + Math.max(0, Math.min(duration - .001, local));
    node.muted = muted || !!track.muted; node.volume = (track.volume ?? 1) * editEnvelope(local, duration, track.audioFadeIn, track.audioFadeOut);
    if (node.readyState && (!playing || active) && Math.abs(node.currentTime - target) > (playing ? .15 : .001)) node.currentTime = target;
    if (playing && active && !blocked.current) { if (node.paused) void node.play().catch(reason => { if (desired.current && reason?.name !== 'AbortError') { blocked.current = true; report.current(); } }); }
    else node.pause();
  };
  useEffect(() => { if (!playing) blocked.current = false; }, [playing]);
  useEffect(sync, [track, time, playing, muted]);
  useEffect(() => { const node = player.current; return () => node?.pause(); }, []);
  return <audio ref={player} src={audioPreviewUrl(track)} preload="metadata" onLoadedMetadata={sync} onError={() => { if (!blocked.current) { blocked.current = true; report.current(); } }} />;
}
export default function EditorAudioPreview({ tracks, ...props }: Props) { return <>{tracks.map(track => <AudioTrackPreview key={track.id} track={track} {...props} />)}</>; }
