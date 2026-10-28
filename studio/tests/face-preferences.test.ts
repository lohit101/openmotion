import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeFaceExecution, readFaceExecution, setFaceExecution } from '../src/face-preferences';

let storage: Map<string,string>, target: EventTarget;
beforeEach(()=>{
  storage=new Map();target=new EventTarget();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)});
  vi.stubGlobal('window',target);setFaceExecution('remote CUDA');
});
afterEach(()=>vi.unstubAllGlobals());
it('defaults to GPU and preserves an existing locally selected device',()=>{
  expect(readFaceExecution()).toBe('remote CUDA');storage.set('recast-face-execution','local CPU');expect(readFaceExecution()).toBe('local CPU');
});
it('shares Settings and Library changes immediately, persists them, and unsubscribes cleanly',()=>{
  const changed=vi.fn(),stop=observeFaceExecution(changed);setFaceExecution('local CPU');expect(changed).toHaveBeenCalledTimes(1);expect(storage.get('recast-face-execution')).toBe('local CPU');
  stop();setFaceExecution('remote CUDA');expect(changed).toHaveBeenCalledTimes(1);
});
it('reacts to this preference changing in another tab without reacting to other settings',()=>{
  const changed=vi.fn(),stop=observeFaceExecution(changed);
  const emit=(key:string|null)=>{const event=new Event('storage');Object.assign(event,{key});target.dispatchEvent(event);};
  emit('recast-theme');expect(changed).not.toHaveBeenCalled();emit('recast-face-execution');emit(null);expect(changed).toHaveBeenCalledTimes(2);stop();
});
it('keeps the current session usable when browser storage is blocked',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}});
  setFaceExecution('local CPU');expect(readFaceExecution()).toBe('local CPU');setFaceExecution('remote CUDA');expect(readFaceExecution()).toBe('remote CUDA');
});
