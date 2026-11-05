import { useRef, type PointerEvent, type KeyboardEvent } from 'react';
import { MusicNotes, SpeakerSlash } from '@phosphor-icons/react';
import { audioSourceKey, trimAudioTrack, type TimelineAudio } from '../shared/clip-editor';
import { clipTime } from '../shared/clip';

export interface AudioSourceInfo { title: string; duration: number; }
export default function EditorAudioLane({ tracks, sources, selected, select, change, seek, zoom, duration }: {
  tracks: TimelineAudio[]; sources: Record<string, AudioSourceInfo>; selected: string | null; select: (id: string) => void; change: (tracks: TimelineAudio[]) => void; seek: (time: number) => void; zoom: number; duration: number;
}) {
  const drag = useRef<{ base: TimelineAudio; original: TimelineAudio; x: number; edge: 'in' | 'out' | 'move'; pointer: number } | null>(null);
  const begin = (event: PointerEvent<HTMLDivElement>, track: TimelineAudio) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-audio-edge]')?.dataset.audioEdge;
    drag.current = { base: track, original: track, x: event.clientX, edge: edge === 'in' || edge === 'out' ? edge : 'move', pointer: event.pointerId };
    select(track.id); seek(Math.min(duration, track.start)); event.currentTarget.focus({ preventScroll: true });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current; if (!state || state.pointer !== event.pointerId || !(event.buttons & 1)) return;
    const source = sources[audioSourceKey(state.base)]; if (!source) return;
    const delta = (event.clientX - state.x) / zoom, next = trimAudioTrack(state.base, state.edge, delta, source.duration, duration);
    const actual = state.edge === 'in' ? next.inSeconds - state.base.inSeconds : state.edge === 'out' ? next.outSeconds - state.base.outSeconds : next.start - state.base.start;
    if (Math.abs(actual - delta) > .001) { state.base = next; state.x = event.clientX; }
    change(tracks.map(track => track.id === next.id ? next : track));
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const state = drag.current; if (!state || state.pointer !== event.pointerId) return;
    if (cancel) change(tracks.map(track => track.id === state.original.id ? state.original : track));
    drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent<HTMLElement>, track: TimelineAudio, edge: 'in' | 'out' | 'move') => {
    const source = sources[audioSourceKey(track)];
    if (!source) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(track.id); seek(track.start); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const delta = event.key === 'Home' ? -600 : event.key === 'End' ? 600 : (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .5 : .01);
    const next = trimAudioTrack(track, edge, delta, source.duration, duration); change(tracks.map(item => item.id === track.id ? next : item)); select(track.id); seek(Math.min(next.start, duration));
  };
  return <div className="edit-audio-lanes" aria-label="Separate audio tracks">{!tracks.length && <div className="edit-audio-empty"><MusicNotes size={15} /><span>Separate a clip’s audio, or add music.</span></div>}{tracks.map((track, index) => {
    const source = sources[audioSourceKey(track)], end = Math.min(duration, track.start + track.outSeconds - track.inSeconds), visible = Math.max(0, end - track.start);
    return <div className="edit-audio-lane" key={track.id}><div role="group" tabIndex={0} aria-label={`Audio ${index + 1}: ${source?.title || 'Missing source'}`} className={`edit-audio-clip ${selected === track.id ? 'selected' : ''} ${track.muted ? 'is-muted' : ''}`} style={{ left: `${track.start * zoom}px`, width: `${Math.max(12, visible * zoom)}px` }} onPointerDown={event => begin(event, track)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => { if (event.target === event.currentTarget) key(event, track, 'move'); }}>
      {track.muted ? <SpeakerSlash size={14} /> : <MusicNotes size={14} />}<span>{source?.title || 'Missing audio'}</span>
      {(['in', 'out'] as const).map(edge => <button key={edge} type="button" className={`edit-trim-edge ${edge}`} data-audio-edge={edge} role="slider" aria-label={`${edge === 'in' ? 'Trim start' : 'Trim end'} of audio ${index + 1}`} aria-valuemin={0} aria-valuemax={source?.duration || 600} aria-valuenow={edge === 'in' ? track.inSeconds : track.outSeconds} aria-valuetext={clipTime(edge === 'in' ? track.inSeconds : track.outSeconds)} onKeyDown={event => key(event, track, edge)}><span /></button>)}
    </div></div>;
  })}</div>;
}
