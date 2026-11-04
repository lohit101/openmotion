import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Check, DownloadSimple, Pause, Play, Plus, Scissors, Sparkle, Trash, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Job } from '../shared/types';
import { faceRepairGoalLabels, normalizeRepairRanges, type FaceRepairEligibility, type FaceRepairGoal, type FaceRepairRange } from '../shared/face-repair';
import { addRepairSelection, moveRepairEdge, repairEditableFrames, repairLoopFrames, repairPointerFrame, repairSelectionRangeIndex, resolveRepairAttempt, type RepairSelection } from '../shared/face-repair-ui';
import { api, SmallSelect } from './components';
import { InfoTip } from './InfoTip';
import './face-repair.css';

const stamp = (frame: number, fps: number) => `${(frame / fps).toFixed(2)}s`;
const active = (job?: Job | null) => !!job && ['queued', 'running', 'reconnecting'].includes(job.status);

export function RepairTimeline({ selections, change, frames, fps, time, seek, disabled = false }: {
  selections: RepairSelection[]; change: (value: RepairSelection[]) => void; frames: number; fps: number;
  time: number; seek: (time: number) => void; disabled?: boolean;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; id: string; edge: 'start' | 'end'; x: number; initial: RepairSelection; original: RepairSelection; current: RepairSelection } | null>(null);
  const latest = useRef(selections); latest.current = selections;
  const [dragging, setDragging] = useState(false);
  const stop = () => { gesture.current = null; setDragging(false); };
  useEffect(() => { const hidden = () => { if (document.hidden) stop(); }; window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden); return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); }; }, []);
  const ranges = selections.length ? normalizeRepairRanges(selections, frames, fps) : [];
  const update = (id: string, value: RepairSelection) => change(latest.current.map(r => r.id === id ? value : r));
  const begin = (event: PointerEvent<HTMLButtonElement>, range: RepairSelection, edge: 'start' | 'end') => {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true });
    gesture.current = { pointerId: event.pointerId, id: range.id, edge, x: event.clientX, initial: { ...range }, original: { ...range }, current: { ...range } }; setDragging(true);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const state = gesture.current, rect = lane.current?.getBoundingClientRect(); if (!state || state.pointerId !== event.pointerId || !rect) return;
    const base = state.edge === 'start' ? state.initial.startFrame : state.initial.endFrame;
    const delta = Math.round((event.clientX - state.x) / rect.width * frames);
    state.current = moveRepairEdge(state.initial, state.edge, base + delta, frames); update(state.id, state.current);
    // Discard invisible overshoot, so dragging back responds immediately at 0 and at the end.
    const applied = state.edge === 'start' ? state.current.startFrame : state.current.endFrame;
    if (applied !== base + delta) { state.x = event.clientX; state.initial = { ...state.current }; }
    seek(Math.min(frames - 1, state.edge === 'start' ? state.current.startFrame : state.current.endFrame - 1) / fps);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const state = gesture.current; if (!state || state.pointerId !== event.pointerId) return;
    if (!cancel) move(event); else update(state.id, state.original); stop(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, range: RepairSelection, edge: 'start' | 'end') => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation();
    const frame = event.key === 'Home' ? 0 : event.key === 'End' ? frames : (edge === 'start' ? range.startFrame : range.endFrame) + delta * (event.shiftKey ? 10 : 1);
    const next = moveRepairEdge(range, edge, frame, frames); update(range.id, next); seek((edge === 'start' ? next.startFrame : next.endFrame - 1) / fps);
  };
  return <div className="repair-timeline" aria-label="Face repair selections">
    <div className="repair-ruler" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>{stamp(Math.round(i * frames / 5), fps)}</span>)}</div>
    <div ref={lane} className={`repair-lane ${dragging ? 'dragging' : ''}`} onPointerDown={e => { if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return; const rect = e.currentTarget.getBoundingClientRect(); seek(Math.min(frames - 1, repairPointerFrame(e.clientX, rect.left, rect.width, frames)) / fps); }}>
      <div className="repair-locked-track" aria-hidden="true" />
      {ranges.map((r, index) => <span key={index} className="repair-handle-zone" style={{ left: `${r.editableStartFrame / frames * 100}%`, width: `${(r.editableEndFrame - r.editableStartFrame) / frames * 100}%` }} aria-hidden="true" />)}
      {selections.map((r, index) => <div key={r.id} className="repair-selection" style={{ left: `${r.startFrame / frames * 100}%`, width: `${(r.endFrame - r.startFrame) / frames * 100}%` }}>
        <span aria-hidden="true">{index + 1}</span>
        {(['start', 'end'] as const).map(edge => <button key={edge} disabled={disabled} type="button" className={`repair-edge ${edge}`} role="slider" aria-label={`Repair ${index + 1} ${edge}`} aria-valuemin={edge === 'start' ? 0 : r.startFrame + 1} aria-valuemax={edge === 'start' ? r.endFrame - 1 : frames} aria-valuenow={edge === 'start' ? r.startFrame : r.endFrame} aria-valuetext={stamp(edge === 'start' ? r.startFrame : r.endFrame, fps)} onPointerDown={e => begin(e, r, edge)} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => { if (gesture.current?.pointerId === e.pointerId) stop(); }} onKeyDown={e => key(e, r, edge)}><span /></button>)}
      </div>)}
      <span className="repair-playhead" style={{ left: `${Math.max(0, Math.min(100, time * fps / frames * 100))}%` }} aria-hidden="true" />
    </div>
    <div className="repair-legend"><span><i className="selected" />Selected repair</span><span><i className="handles" />Blend handles · up to 0.25s</span><span><i />Protected footage</span></div>
  </div>;
}

function RepairPlayback({ src, candidate, fps, frames, time, seek, loop }: { src: string; candidate?: string; fps: number; frames: number; time: number; seek: (time: number) => void; loop: [number, number] | null }) {
  const parent = useRef<HTMLVideoElement>(null), corrected = useRef<HTMLVideoElement>(null), wanted = useRef(false);
  const [playing, setPlaying] = useState(false), [mediaError, setMediaError] = useState(false), [split, setSplit] = useState(50);
  useEffect(() => { wanted.current = false; setPlaying(false); setMediaError(false); parent.current?.pause(); corrected.current?.pause(); }, [src, candidate]);
  useEffect(() => {
    const a = parent.current, b = corrected.current; if (!a) return;
    if (Math.abs(a.currentTime - time) > .6 / fps) a.currentTime = time;
    if (b && Math.abs(b.currentTime - time) > .6 / fps) b.currentTime = time;
  }, [time, fps, candidate]);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      const a = parent.current, b = corrected.current;
      if (a && !a.paused) {
        if (loop && (a.currentTime * fps >= loop[1] || a.currentTime * fps < loop[0] - 1)) { a.currentTime = loop[0] / fps; if (b) b.currentTime = a.currentTime; }
        if (b) { if (Math.abs(a.currentTime - b.currentTime) > 1 / fps) b.currentTime = a.currentTime; if (b.paused && wanted.current) void b.play().catch(() => undefined); }
        seek(a.currentTime);
      }
      frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync); return () => cancelAnimationFrame(frame);
  }, [fps, seek, loop?.[0], loop?.[1], candidate]);
  const play = async () => {
    const a = parent.current, b = corrected.current; if (!a) return;
    if (!a.paused) { wanted.current = false; a.pause(); b?.pause(); setPlaying(false); return; }
    try { if (loop && (a.currentTime * fps < loop[0] || a.currentTime * fps >= loop[1])) a.currentTime = loop[0] / fps; if (b) { b.currentTime = a.currentTime; await b.play(); } wanted.current = true; await a.play(); setPlaying(true); }
    catch { wanted.current = false; a.pause(); b?.pause(); setPlaying(false); toast.error('The comparison could not play. Wait for it to load, then try again.'); }
  };
  return <div className="repair-playback">
    <div className="repair-video-stage">
      <video ref={parent} src={src} playsInline preload="metadata" aria-label="Original finished video" onError={() => setMediaError(true)} onEnded={() => { const a = parent.current, b = corrected.current; if (loop && wanted.current && a) { a.currentTime = loop[0] / fps; if (b) { b.currentTime = a.currentTime; void b.play().catch(() => undefined); } void a.play().catch(() => setPlaying(false)); } else { wanted.current = false; setPlaying(false); b?.pause(); } }} onLoadedMetadata={e => { e.currentTarget.currentTime = time; }} />
      {candidate && <><video ref={corrected} src={candidate} muted playsInline preload="auto" aria-label="Repair candidate video" style={{ clipPath: `inset(0 0 0 ${split}%)` }} onError={() => setMediaError(true)} onLoadedMetadata={e => { e.currentTarget.currentTime = time; }} /><div className="repair-video-labels"><span>Original</span><span>Candidate</span></div><input className="repair-compare-slider" aria-label="Compare original and repair candidate" type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} /><span className="repair-split-line" style={{ left: `${split}%` }} aria-hidden="true" /></>}
      {!candidate && <span className="repair-original-label">Original video</span>}
      {mediaError && <p className="repair-media-error" role="alert">Preview unavailable. Your saved video is unchanged. Reopen this attempt to retry.</p>}
    </div>
    <div className="repair-playback-controls"><button className="icon-button" aria-label={playing ? 'Pause comparison' : 'Play comparison'} onClick={() => void play()}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><span>{stamp(Math.round(time * fps), fps)}</span><input aria-label="Seek repair preview" type="range" min={0} max={(frames - 1) / fps} step={1 / fps} value={Math.min(time, (frames - 1) / fps)} onChange={e => seek(Number(e.target.value))} /><span>{stamp(frames, fps)}</span><button className="icon-button" aria-label="Previous frame" disabled={playing} onClick={() => seek(Math.max(0, Math.round(time * fps) - 1) / fps)}>−1f</button><button className="icon-button" aria-label="Next frame" disabled={playing} onClick={() => seek(Math.min(frames - 1, Math.round(time * fps) + 1) / fps)}>+1f</button></div>
  </div>;
}

export default function FaceRepairDialog({ job, jobs, close, accepted }: { job: Job; jobs: Job[]; close: () => void; accepted?: (job: Job) => void }) {
  const [parentId, setParentId] = useState(job.faceRepair?.parentJobId || job.id);
  const parent = jobs.find(j => j.id === parentId) || (job.id === parentId ? job : undefined);
  const [eligibility, setEligibility] = useState<FaceRepairEligibility | null>(null), [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<RepairSelection[]>([]), [goal, setGoal] = useState<FaceRepairGoal>('auto');
  const [attemptId, setAttemptId] = useState<string | null>(job.faceRepair ? job.id : null), [candidateId, setCandidateId] = useState<string | null>(null);
  const [pending, setPending] = useState(false), [time, setTime] = useState(0), [loopIndex, setLoopIndex] = useState<number | null>(null);
  const initialized = useRef(false), requestId = useRef<string | null>(null);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => { try { const value = await api<FaceRepairEligibility>(`/jobs/${parentId}/face-repairs`); if (live) { setEligibility(value); setError(null); if (!initialized.current) { initialized.current = true; if (!job.faceRepair && value.frames > 0) setSelections([addRepairSelection(0, value.frames, value.fps, crypto.randomUUID())]); } } } catch (e) { if (live) setError((e as Error).message); } finally { if (live) timer = setTimeout(() => void refresh(), 2500); } };
    void refresh(); return () => { live = false; clearTimeout(timer); };
  }, [parentId, job.faceRepair]);
  const attempt = resolveRepairAttempt(job, jobs, eligibility?.attempts || [], attemptId);
  const run = attempt?.faceRepair, busy = active(attempt), candidates = run?.candidates || [];
  const selectedCandidate = candidates.find(c => c.id === candidateId) || candidates.find(c => c.qualified) || candidates[0];
  const frames = eligibility?.frames || run?.frames || parent?.progress.targetFrames || 1, fps = eligibility?.fps || run?.fps || parent?.settings.fps || 24;
  const ranges = run?.ranges || (selections.length ? normalizeRepairRanges(selections, frames, fps) : []);
  const loop = loopIndex !== null && ranges[loopIndex] ? repairLoopFrames(ranges[loopIndex], frames, fps) : null;
  const displayed = run ? run.ranges.map((r, index) => ({ ...r, id: `saved-${index}` })) : selections;
  const change = (next: RepairSelection[]) => { setSelections(next); requestId.current = null; setLoopIndex(null); };
  const start = async () => {
    if (pending || !eligibility?.eligible || !selections.length) return;
    setPending(true); setError(null);
    try { requestId.current ||= crypto.randomUUID(); const result = await api<Job>(`/jobs/${parentId}/face-repairs`, { requestId: requestId.current, goal, ranges: selections.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })) }); setAttemptId(result.id); setEligibility(value => value ? { ...value, attempts: [result, ...value.attempts.filter(j => j.id !== result.id)] } : value); toast.success('Face repair queued', { description: 'Your original stays saved. Compare the candidates before accepting.' }); }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  };
  const action = async (kind: 'cancel' | 'resume' | 'accept') => {
    if (!attempt || pending) return; setPending(true); setError(null);
    try {
      const result = await api<Job>(kind === 'accept' ? `/jobs/${attempt.id}/face-repairs/accept` : `/jobs/${attempt.id}/${kind}`, kind === 'accept' ? { candidateId: selectedCandidate?.id } : {});
      if (kind === 'accept') { toast.success('Repaired revision saved', { description: 'The original video is preserved.' }); accepted?.(result); close(); }
    } catch (e) { setError((e as Error).message); } finally { setPending(false); }
  };
  const newAttempt = () => { if (busy || pending) return; if (run) setSelections(run.ranges.map((r, i) => ({ id: `retry-${i}`, startFrame: r.startFrame, endFrame: r.endFrame }))); if (attempt?.faceRepair?.state === 'accepted') { setParentId(attempt.id); setEligibility(null); } setAttemptId(null); setCandidateId(null); setLoopIndex(null); requestId.current = null; };
  const percent = attempt?.status === 'completed' ? 100 : Math.min(99, Math.floor((attempt?.progress.completedFrames || 0) / Math.max(1, attempt?.progress.targetFrames || 1) * 100));
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className="repair-dialog">
    <header className="repair-header"><div><span className="repair-overline">REMOTION</span><Dialog.Title>Repair face</Dialog.Title><Dialog.Description>Correct selected moments. Keep the footage you like.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close face repair"><X size={20} /></Dialog.Close></header>
    <div className="repair-body"><section className="repair-main">
      <RepairPlayback src={`/api/jobs/${parentId}/video`} candidate={attempt && selectedCandidate ? `/api/jobs/${attempt.id}/face-repairs/${selectedCandidate.id}/video` : undefined} fps={fps} frames={frames} time={time} seek={setTime} loop={loop} />
      <div className="repair-timeline-heading"><strong><Scissors size={16} />{run ? 'Saved repair ranges' : 'Mark the moments to correct'}</strong><span>{frames} frames · {fps} fps</span></div>
      <RepairTimeline selections={displayed} change={change} frames={frames} fps={fps} time={time} seek={setTime} disabled={!!run || pending} />
      {!run && <button className="secondary-button repair-add" disabled={pending || selections.length >= 12 || !eligibility?.eligible} onClick={() => change([...selections, addRepairSelection(time * fps, frames, fps, crypto.randomUUID())])}><Plus size={15} />Add range at playhead</button>}
      <div className="repair-range-list">{displayed.map((r, i) => <div className="repair-range-row" key={r.id}><span className="repair-range-number">{i + 1}</span>{!run ? <><label>From<input aria-label={`Repair ${i + 1} start seconds`} type="number" min={0} max={(r.endFrame - 1) / fps} step={1 / fps} value={Number((r.startFrame / fps).toFixed(4))} onChange={e => { if (e.currentTarget.value !== '') change(selections.map(item => item.id === r.id ? moveRepairEdge(r, 'start', Number(e.currentTarget.value) * fps, frames) : item)); }} /></label><label>To<input aria-label={`Repair ${i + 1} end seconds`} type="number" min={(r.startFrame + 1) / fps} max={frames / fps} step={1 / fps} value={Number((r.endFrame / fps).toFixed(4))} onChange={e => { if (e.currentTarget.value !== '') change(selections.map(item => item.id === r.id ? moveRepairEdge(r, 'end', Number(e.currentTarget.value) * fps, frames) : item)); }} /></label></> : <strong>{stamp(r.startFrame, fps)} – {stamp(r.endFrame, fps)}</strong>}<button className={`secondary-button ${loopIndex === repairSelectionRangeIndex(r, ranges) ? 'is-active' : ''}`} aria-pressed={loopIndex === repairSelectionRangeIndex(r, ranges)} onClick={() => { const index = repairSelectionRangeIndex(r, ranges); setLoopIndex(loopIndex === index ? null : index); if (index >= 0) setTime(repairLoopFrames(ranges[index], frames, fps)[0] / fps); }}><Play size={13} />Loop joins</button>{!run && <button className="icon-button" aria-label={`Remove repair range ${i + 1}`} onClick={() => change(selections.filter(item => item.id !== r.id))}><Trash size={15} /></button>}</div>)}</div>
      <div className="repair-editable-times" aria-label="Editable ranges including blend handles">{ranges.map((r, i) => <span key={i}>{i > 0 ? ' · ' : 'May change: '}{stamp(r.editableStartFrame, fps)} – {stamp(r.editableEndFrame, fps)}</span>)}</div>
      <p className="repair-permission">{ranges.length ? `${stamp(repairEditableFrames(ranges), fps)} may change, including blend handles. ` : 'Add a range to begin. '}The rest of the lossless master is protected.</p>
    </section><aside className="repair-sidebar">
      <section><h3>{run ? 'Review this attempt' : 'What needs fixing?'}</h3>{run ? <p>{faceRepairGoalLabels[run.goal]} · {run.state === 'accepted' ? 'Accepted revision' : run.state === 'review' ? 'Ready to compare' : attempt?.progress.stage}</p> : <><SmallSelect label="Face repair goal" value={goal} onChange={value => { setGoal(value as FaceRepairGoal); requestId.current = null; }} options={(['auto', 'identity', 'boundary', 'eyes'] as FaceRepairGoal[]).map(value => ({ value, label: faceRepairGoalLabels[value], disabled: !!eligibility && !eligibility.availableGoals.includes(value), disabledReason: value === 'eyes' ? 'Temporal validation is still pending.' : undefined }))} /><p>Uses the saved character and source performance. Body or motion regeneration is separate.</p></>}</section>
      {busy && <section className="repair-processing" aria-live="polite"><Sparkle size={22} /><strong>{percent}%</strong><div role="progressbar" aria-label="Face repair progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div><p>{attempt?.progress.stage}</p><button className="secondary-button" disabled={pending} onClick={() => void action('cancel')}>Cancel repair</button></section>}
      {!!candidates.length && <section className="repair-candidates"><h3>Compare in motion</h3>{candidates.map((c, i) => <button key={c.id} className={selectedCandidate?.id === c.id ? 'selected' : ''} aria-pressed={selectedCandidate?.id === c.id} onClick={() => setCandidateId(c.id)}><span>Candidate {i + 1}<small>{c.recipe.includes('80') ? 'Stronger identity' : 'Face boundary correction'}</small></span>{selectedCandidate?.id === c.id && <Check size={17} />}</button>)}{selectedCandidate && <><p>{selectedCandidate.changedFrames} frames changed. Check face shape, mouth, hands and both joins.</p>{selectedCandidate.warnings.map((warning, i) => <p className="repair-warning" key={i}>{warning}</p>)}{!selectedCandidate.qualified && <p className="repair-warning">This candidate did not pass the technical checks and cannot be accepted.</p>}<a className="secondary-button" href={`/api/jobs/${attempt!.id}/face-repairs/${selectedCandidate.id}/master`}><DownloadSimple size={15} />Lossless master</a></>}</section>}
      {error && <p className="repair-error" role="alert">{error}</p>}{!eligibility && !error && <p role="status">Checking saved inputs…</p>}{eligibility && !eligibility.eligible && <p className="repair-warning">{eligibility.reason}</p>}{attempt?.error && <p className="repair-error" role="alert">{attempt.error}</p>}
      <div className="repair-primary-actions">{!run ? <button className="primary-button" disabled={pending || !eligibility?.eligible || !selections.length} onClick={() => void start()}><Sparkle size={17} />{pending ? 'Starting repair…' : 'Create repair candidates'}</button> : <>{['interrupted', 'failed', 'cancelled'].includes(attempt?.status || '') && <button className="primary-button" disabled={pending} onClick={() => void action('resume')}>Check &amp; resume</button>}{!busy && selectedCandidate && run.state !== 'accepted' && <button className="primary-button" disabled={pending || !selectedCandidate.qualified} onClick={() => void action('accept')}><Check size={17} />{pending ? 'Saving revision…' : 'Accept candidate'}</button>}{!busy && <button className="secondary-button" disabled={pending} onClick={newAttempt}>New attempt</button>}</>}<button className="secondary-button" onClick={close}><ArrowLeft size={15} />Back to video</button></div>
      {!!eligibility?.attempts.length && <section className="repair-history"><h3>Saved attempts</h3>{eligibility.attempts.map((item, i) => <button className={attemptId === item.id ? 'selected' : ''} key={item.id} onClick={() => { setAttemptId(item.id); setCandidateId(null); setLoopIndex(null); }} disabled={busy && item.id !== attemptId}><span>Attempt {eligibility.attempts.length - i}</span><small>{item.faceRepair?.state === 'accepted' ? 'Accepted' : item.faceRepair?.state === 'review' ? 'Review' : item.status}</small></button>)}</section>}
      <div className="repair-footnote"><InfoTip label="face repair output">The RGB lossless master preserves decoded original frames outside the displayed editable ranges. The playable MP4 is re-encoded. Original timing and audio stay the same. A completed repair needs your visual review; it is not a guarantee that every defect can be corrected.</InfoTip><span>Original always preserved</span></div>
    </aside></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
