import type { Response } from 'express';
import type { Store } from './store';

/** A slow/background tab must not accumulate every intermediate progress tick. */
export function openEventStream(store: Store, res: Response, bootstrap: unknown) {
  let blocked = false, closed = false;
  const pending = new Map<string, unknown>();
  const key = (event: unknown) => {
    const value = event as { type?: string; data?: { id?: string } };
    return `${value.type || 'event'}:${value.data?.id || ''}`;
  };
  const dispose = () => {
    if (closed) return;
    closed = true; clearInterval(heartbeat); pending.clear();
    store.off('event', send); res.off('drain', drain); res.off('close', dispose); res.off('error', dispose);
  };
  const write = (text: string) => {
    try { blocked = !res.write(text); }
    catch { dispose(); res.destroy(); }
  };
  const send = (event: unknown) => {
    if (closed) return;
    if (!blocked) { write('data: ' + JSON.stringify(event) + '\n\n'); return; }
    // Different jobs remain distinct; only obsolete updates for the same item
    // are replaced. Reconnect to a fresh bootstrap if a tab falls too far behind.
    pending.set(key(event), event);
    if (pending.size > 256) { dispose(); res.destroy(); }
  };
  const drain = () => {
    if (closed) return;
    blocked = false;
    for (const [id, event] of pending) {
      pending.delete(id); send(event); if (blocked || closed) break;
    }
  };
  const heartbeat = setInterval(() => { if (!closed && !blocked) write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  res.on('drain', drain); res.on('close', dispose); res.on('error', dispose);
  send({ type: 'bootstrap', data: bootstrap });
  if (!closed) store.on('event', send);
  return dispose;
}
