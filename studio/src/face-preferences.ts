import { useSyncExternalStore } from 'react';

export type FaceExecution = 'local CPU' | 'remote CUDA';
const key = 'recast-face-execution', eventName = 'recast-face-execution-change';
let sessionValue: FaceExecution = 'remote CUDA';

export function readFaceExecution(): FaceExecution {
  try { return localStorage.getItem(key) === 'local CPU' ? 'local CPU' : 'remote CUDA'; }
  catch { return sessionValue; }
}
export function setFaceExecution(value: FaceExecution) {
  sessionValue = value;
  try { localStorage.setItem(key, value); } catch { /* This session still works when storage is blocked. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName));
}
export function observeFaceExecution(changed: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) changed(); };
  window.addEventListener(eventName, changed); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(eventName, changed); window.removeEventListener('storage', storage); };
}
export const useFaceExecution = () => useSyncExternalStore(observeFaceExecution, readFaceExecution, () => 'remote CUDA' as FaceExecution);
