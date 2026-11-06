import { afterEach, expect, it, vi } from 'vitest';
import { uploadReferences, validateReferenceDrop } from '../src/image-edit-upload';

afterEach(() => vi.unstubAllGlobals());
const photo = (name: string) => new File(['image bytes'], name, { type: 'image/png' });
function fixture(failAt = '') {
  const sent: string[] = [], aborted: string[] = [];
  class XHR {
    upload: { onprogress?: (event: unknown) => void } = {};
    status = 201; timeout = 0; responseText = ''; name = '';
    onload?: () => void; onerror?: () => void; onabort?: () => void; ontimeout?: () => void;
    open(method: string, endpoint: string) { expect([method, endpoint]).toEqual(['POST', '/api/assets/image']); }
    send(form: FormData) {
      this.name = (form.get('file') as File).name; sent.push(this.name);
      if (this.name === 'hold.png') return;
      queueMicrotask(() => {
        if (this.name === failAt) { this.onerror?.(); return; }
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        this.responseText = JSON.stringify({ id: this.name, name: this.name, kind: 'image', size: 11 }); this.onload?.();
      });
    }
    abort() { aborted.push(this.name); this.onabort?.(); }
  }
  vi.stubGlobal('XMLHttpRequest', XHR); return { sent, aborted };
}
it('checks the whole dropped group before uploading, including remaining slots, type and size', () => {
  expect(() => validateReferenceDrop([photo('face.png'), photo('back.webp')], 1)).not.toThrow();
  expect(() => validateReferenceDrop([photo('face.png'), photo('back.webp')], 2)).toThrow('1 more image');
  expect(() => validateReferenceDrop([photo('video.mp4')], 0)).toThrow('PNG, JPEG or WebP');
  expect(() => validateReferenceDrop([new File([new Uint8Array(10_000_001)], 'large.png')], 0)).toThrow('10 MB');
});
it('uploads multiple extra images sequentially in file order and reports progress', async () => {
  const f = fixture(), controller = new AbortController(), added: string[] = [], progress = vi.fn();
  await uploadReferences([photo('face.png'), photo('back.webp')], controller.signal, asset => added.push(asset.id), progress);
  expect(f.sent).toEqual(['face.png', 'back.webp']); expect(added).toEqual(f.sent);
  expect(progress).toHaveBeenCalledWith(1, 2, 50); expect(progress).toHaveBeenCalledWith(2, 2, 50);
  controller.abort(); expect(f.aborted).toEqual([]); // Completed listeners are removed.
});
it('retains completed references and stops the remaining group after a network failure', async () => {
  const f = fixture('bad.png'), added: string[] = [];
  await expect(uploadReferences([photo('face.png'), photo('bad.png'), photo('back.png')], new AbortController().signal, asset => added.push(asset.id), () => {})).rejects.toThrow('Upload interrupted');
  expect(added).toEqual(['face.png']); expect(f.sent).toEqual(['face.png', 'bad.png']);
});
it('cancels an outstanding upload on leaving the editor without adding a stale reference', async () => {
  const f = fixture(), controller = new AbortController(), added = vi.fn();
  const pending = uploadReferences([photo('hold.png'), photo('back.png')], controller.signal, added, () => {});
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.aborted).toEqual(['hold.png']); expect(added).not.toHaveBeenCalled(); expect(f.sent).toEqual(['hold.png']);
});
