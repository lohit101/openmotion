import { useEffect, useRef, useState } from 'react';
import type { Job } from '../shared/types';
import { outputReady, retainOverallProgress } from '../shared/generation-progress';

const highWater = new Map<string, number>();
const key = (id: string) => `recast-overall-progress-v1:${id}`;
function restored(job: Job): number {
  try { return Number(sessionStorage.getItem(key(job.id))) || highWater.get(job.id) || 0; }
  catch { return highWater.get(job.id) || 0; }
}

export function useOverallProgress(job: Job): number {
  const [saved, setSaved] = useState(() => ({ id: job.id, percent: restored(job) }));
  const target = retainOverallProgress(saved.id === job.id ? saved.percent : restored(job), job);
  const [displayed, setDisplayed] = useState(target), display = useRef(target);
  useEffect(() => {
    setSaved({ id: job.id, percent: target });
    highWater.set(job.id, target);
    try { sessionStorage.setItem(key(job.id), String(target)); } catch { /* The in-memory mark still survives view changes. */ }
  }, [job.id, target]);
  useEffect(() => {
    // Interpolate only to earned progress; a clock never advances the target.
    if (typeof requestAnimationFrame !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      display.current = target; setDisplayed(target); return;
    }
    const from = display.current, start = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const value = from + (target - from) * (1 - (1 - t) ** 3);
      display.current = value; setDisplayed(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return Math.min(outputReady(job) ? 100 : 99, Math.floor(displayed));
}

/** A newly finished run briefly displays its real 100% before showing the player. */
export function useOutputPresentation(job?: Job): boolean {
  const id = job?.id, ready = outputReady(job);
  const [shown, setShown] = useState({ id, ready });
  useEffect(() => {
    if (shown.id !== id) { setShown({ id, ready }); return; }
    if (!ready) { if (shown.ready) setShown({ id, ready: false }); return; }
    if (!shown.ready) { const timer = setTimeout(() => setShown({ id, ready: true }), 900); return () => clearTimeout(timer); }
  }, [id, ready, shown.id, shown.ready]);
  return ready && (shown.id !== id || shown.ready);
}
