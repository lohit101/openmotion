import { useEffect, useRef } from 'react';
import type { Bootstrap } from '../shared/types';
import type { LocalExport } from '../shared/clip-editor';
import { ActivityAlertTracker, type AlertTarget } from '../shared/alerts';
import { browserAlerts } from './alerts';

export const exportAlertEvent = 'recast-export-update';
export function useActivityAlerts(data: Bootstrap | null, open: (target: AlertTarget) => void) {
  const tracker = useRef(new ActivityAlertTracker()), latestOpen = useRef(open); latestOpen.current = open;
  useEffect(() => browserAlerts.mount(target => latestOpen.current(target)), []);
  useEffect(() => { if (data) for (const alert of tracker.current.collect(data)) void browserAlerts.notify(alert); }, [data]);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, inFlight = false, again = false;
    const poll = async () => {
      if (disposed) return;
      if (inFlight) { again = true; return; }
      clearTimeout(timer); inFlight = true; let active = false;
      try {
        const response = await fetch('/api/clip-editor/exports'); if (!response.ok) throw new Error('Export status unavailable');
        const rows: LocalExport[] = await response.json(); if (disposed) return;
        for (const alert of tracker.current.collectExports(rows)) void browserAlerts.notify(alert);
        active = rows.some(row => ['queued', 'exporting'].includes(row.status));
      } catch { /* A local status request must never change or restart GPU work. */ }
      finally { inFlight = false; if (!disposed) { const delay = again ? 0 : active ? 1000 : 10000; again = false; timer = setTimeout(() => void poll(), delay); } }
    };
    const submitted = (event: Event) => {
      const row = (event as CustomEvent<LocalExport>).detail;
      if (row?.id) for (const alert of tracker.current.collectExports([row], true)) void browserAlerts.notify(alert);
      void poll();
    };
    const visible = () => { if (document.visibilityState === 'visible') void poll(); };
    window.addEventListener(exportAlertEvent, submitted); document.addEventListener('visibilitychange', visible); void poll();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener(exportAlertEvent, submitted); document.removeEventListener('visibilitychange', visible); };
  }, []);
}
