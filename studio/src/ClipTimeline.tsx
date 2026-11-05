import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clipTime } from '../shared/clip';
import { clipSourceKey, timelineLayout, trimTimelineClip, trimEdgeTravel, type EditorSource, type TimelineClip } from '../shared/clip-editor';

interface Props { clips: TimelineClip[]; sources: Record<string, EditorSource>; selected: string | null; select: (id: string) => void; change: (clips: TimelineClip[]) => void; seek: (time: number) => void; time: number; zoom: number; importFiles: (files: File[], index: number) => void; importing: boolean; audioLane?: ReactNode; }
interface Drag { id: string; kind: 'in' | 'out' | 'move'; x: number; lastX:number; extra:number; pointerId:number; base: TimelineClip; delta: number; target: number; }

export default function ClipTimeline({ clips, sources, selected, select, change, seek, time, zoom, importFiles, importing, audioLane }: Props) {
  const lane = useRef<HTMLDivElement>(null), viewport=useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), edgeFrame=useRef<number|null>(null);
  const updateDrag=useRef<(state:Drag)=>void>(()=>{});
  const [visual, setVisual] = useState<Drag | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const rows = timelineLayout(clips, sources), total = rows.at(-1)?.end || 0;
  const stopDrag=()=>{drag.current=null;setVisual(null);if(edgeFrame.current!==null){cancelAnimationFrame(edgeFrame.current);edgeFrame.current=null;}};
  useEffect(()=>{
    const stop=()=>stopDrag(),hidden=()=>{if(document.hidden)stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);if(edgeFrame.current!==null)cancelAnimationFrame(edgeFrame.current);};
  },[]);
  const step = zoom >= 70 ? 1 : zoom >= 30 ? 2 : 5;
  const point = (x: number) => Math.max(0, Math.min(total, (x - lane.current!.getBoundingClientRect().left) / zoom));
  const fileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const dropPosition = (x: number) => { const at = point(x), index = rows.findIndex(row => at < row.start + row.duration / 2); return index < 0 ? rows.length : index; };
  const overFiles = (event: DragEvent) => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
    if (!importing) setDropIndex(dropPosition(event.clientX));
  };
  const dropFiles = (event: DragEvent) => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); setDropIndex(null);
    if (importing) return;
    const index = dropPosition(event.clientX), before = rows[index]?.clip.id;
    importFiles(Array.from(event.dataTransfer.files), before ? clips.findIndex(clip => clip.id === before) : clips.length);
  };
  const begin = (event: PointerEvent<HTMLDivElement>, clip: TimelineClip) => {
    if (event.button !== 0||!event.isPrimary) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    if (edge) (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.focus({preventScroll:true}); else event.currentTarget.focus({preventScroll:true});
    select(clip.id); seek(rows.find(row => row.clip.id === clip.id)!.start);
    if(edgeFrame.current!==null)cancelAnimationFrame(edgeFrame.current);
    drag.current = { id: clip.id, kind: edge === 'in' || edge === 'out' ? edge : 'move', x: event.clientX,lastX:event.clientX,extra:0,pointerId:event.pointerId, base: { ...clip }, delta: 0, target: clips.findIndex(item => item.id === clip.id) };
    setVisual(drag.current);
    if(drag.current.kind!=='move'){
      let previous=performance.now();
      const extend=(now:number)=>{
        const state=drag.current,rect=viewport.current?.getBoundingClientRect();if(!state||!rect)return;
        const travel=trimEdgeTravel(state.x,state.lastX,rect.left,rect.right,(now-previous)/1000);previous=now;
        if(travel){state.extra+=travel;updateDrag.current(state);}
        edgeFrame.current=requestAnimationFrame(extend);
      };
      edgeFrame.current=requestAnimationFrame(extend);
    }
  };
  updateDrag.current=state=>{
    const delta = state.lastX - state.x+state.extra, source = sources[clipSourceKey(state.base)]; state.delta = delta;
    const current=clips.find(clip=>clip.id===state.id);
    if(!source||!current){stopDrag();return;}
    if (state.kind === 'move') {
      const at = point(state.lastX), index = rows.findIndex(row => at < row.start + row.duration / 2);
      state.target = index < 0 ? clips.length : index;
    } else {
      const target = (state.kind === 'in' ? state.base.inFrame : state.base.outFrame) + delta / zoom * source.fps;
      const next = trimTimelineClip(state.base, state.kind, target, source);
      const boundary=state.kind==='in'?next.inFrame:next.outFrame;
      // Do not accumulate invisible overshoot after reaching a source boundary;
      // moving the pointer back must immediately move the handle again.
      if(target<(state.kind==='in'?0:state.base.inFrame+1)||target>(state.kind==='in'?state.base.outFrame-1:source.frames)){
        state.extra=(boundary-(state.kind==='in'?state.base.inFrame:state.base.outFrame))/source.fps*zoom-(state.lastX-state.x);
      }
      if(next.inFrame!==current.inFrame||next.outFrame!==current.outFrame){
        change(clips.map(clip => clip.id === state.id ? next : clip));
        const row = rows.find(item => item.clip.id === state.id)!;
        seek(row.start + (state.kind === 'out' ? Math.max(0, (next.outFrame - next.inFrame - 1) / source.fps) : 0));
      }
    }
    setVisual({ ...state });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state=drag.current;if(!state||state.pointerId!==event.pointerId)return;
    if(!(event.buttons&1)){stopDrag();return;}
    state.lastX=event.clientX;updateDrag.current(state);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const state = drag.current; if (!state||state.pointerId!==event.pointerId) return;
    if(!cancel){state.lastX=event.clientX;updateDrag.current(state);}
    if (cancel && state.kind !== 'move') change(clips.map(clip => clip.id === state.id ? state.base : clip));
    else if (state.kind === 'move') {
      if (Math.abs(state.delta) > 6) {
        const from = clips.findIndex(clip => clip.id === state.id), next = clips.filter(clip => clip.id !== state.id);
        next.splice(Math.max(0, state.target - (from < state.target ? 1 : 0)), 0, clips[from]); change(next);
      } else seek(point(event.clientX));
    }
    stopDrag();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyTrim = (event: KeyboardEvent<HTMLButtonElement>, clip: TimelineClip, edge: 'in' | 'out') => {
    const sign = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!sign && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const source = sources[clipSourceKey(clip)], value = edge === 'in' ? clip.inFrame : clip.outFrame;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? source.frames : value + sign * (event.shiftKey ? 10 : 1);
    const next = trimTimelineClip(clip, edge, target, source); change(clips.map(item => item.id === clip.id ? next : item));
    seek(rows.find(row => row.clip.id === clip.id)!.start);
  };
  return <div ref={viewport} className={`edit-timeline-scroll ${dropIndex !== null ? 'receiving-files' : ''}`} onDragEnter={overFiles} onDragOver={overFiles} onDrop={dropFiles} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropIndex(null); }}><div className="edit-timeline-lane" ref={lane} style={{ width: `${Math.max(total * zoom, 500)}px` }}>
    <div className="edit-time-ruler" onPointerDown={event => { if (event.button === 0) seek(point(event.clientX)); }} aria-hidden="true">{Array.from({ length: Math.ceil(Math.max(total, 500 / zoom) / step) + 1 }, (_, index) => <span key={index} style={{ left: `${index * step * zoom}px` }}>{clipTime(index * step).replace(/\.00$/, '')}</span>)}</div>
    <div className="edit-timeline-track" aria-label="Video clip timeline">
      {rows.map((row, index) => {
        const state = visual?.id === row.clip.id ? visual : null;
        const leftOffset = state?.kind === 'in' ? (row.clip.inFrame - state.base.inFrame) / row.source.fps * zoom : 0;
        const slot = state?.kind === 'in' ? (state.base.outFrame - state.base.inFrame) / row.source.fps * zoom : row.duration * zoom;
        return <div className={`edit-timeline-slot ${visual?.kind === 'move' && visual.target === index ? 'drop-before' : ''}`} key={row.clip.id} style={{ width: `${slot}px` }}><div role="group" tabIndex={0} aria-label={`Clip ${index + 1}: ${row.source.title}`} className={`edit-timeline-clip ${selected === row.clip.id ? 'selected' : ''} ${state?.kind === 'move' && Math.abs(state.delta) > 6 ? 'moving' : ''}`} style={{ width: `${row.duration * zoom}px`, left: `${leftOffset}px`, transform: state?.kind === 'move' ? `translateX(${state.delta}px)` : undefined }} onPointerDown={event => begin(event, row.clip)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event=>{if(drag.current?.id===row.clip.id&&drag.current.pointerId===event.pointerId)stopDrag();}} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(row.clip.id); seek(row.start); } }}>
          <div className="edit-timeline-images" aria-hidden="true">{Array.from({ length: Math.max(1, Math.ceil(row.duration * zoom / 70)) }, (_, tile) => { const count = Math.max(1, Math.ceil(row.duration * zoom / 70)), sourceTime = row.clip.inFrame / row.source.fps + row.duration * (tile + .5) / count, sprite = Math.min(11, Math.max(0, Math.round(sourceTime / row.source.duration * 11))); return <span key={tile} style={{ width: `${100 / count}%`, backgroundImage: `url(/api/clip-editor/sources/${encodeURIComponent(clipSourceKey(row.clip))}/filmstrip)`, backgroundPosition: `${sprite / 11 * 100}% center` }} />; })}</div><span className="edit-clip-name">{index + 1}. {row.source.title}</span><small>{row.duration.toFixed(2)}s</small>
          {(['in', 'out'] as const).map(edge => <button key={edge} type="button" data-edge={edge} className={`edit-trim-edge ${edge}`} role="slider" aria-label={`${edge === 'in' ? 'Trim start' : 'Trim end'} of clip ${index + 1}`} aria-valuemin={edge === 'in' ? 0 : (row.clip.inFrame + 1) / row.source.fps} aria-valuemax={edge === 'in' ? (row.clip.outFrame - 1) / row.source.fps : row.source.duration} aria-valuenow={(edge === 'in' ? row.clip.inFrame : row.clip.outFrame) / row.source.fps} aria-valuetext={clipTime((edge === 'in' ? row.clip.inFrame : row.clip.outFrame) / row.source.fps)} onKeyDown={event => keyTrim(event, row.clip, edge)}><span />{state?.kind === edge && <em>{clipTime((edge === 'in' ? row.clip.inFrame : row.clip.outFrame) / row.source.fps)}</em>}</button>)}
        </div></div>;
      })}{visual?.kind === 'move' && visual.target === clips.length && <span className="edit-drop-end" />}
      {!clips.length && <div className="edit-timeline-empty">Drop videos here, choose Add videos, or add a Library clip.</div>}
      {dropIndex !== null && <div className="edit-file-insertion" style={{ left: `${(rows[dropIndex]?.start ?? total) * zoom}px` }} aria-hidden="true"><span>Drop to add videos</span></div>}
    </div>{audioLane}<div className="edit-playhead" style={{ left: `${Math.min(time, total) * zoom}px` }} aria-hidden="true"><span /></div>
  </div></div>;
}
