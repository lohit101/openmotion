import type { Asset } from '../shared/types';

export function validateReferenceDrop(files: File[], currentCount: number) {
  if (!files.length) return;
  if (files.length > 3 - currentCount) throw new Error(`You can add ${3 - currentCount} more image${3 - currentCount === 1 ? '' : 's'} (3 total).`);
  for (const file of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error(`${file.name}: use PNG, JPEG or WebP.`);
    if (!file.size || file.size > 10_000_000) throw new Error(`${file.name}: each image must be under 10 MB.`);
  }
}

function upload(file: File, signal: AbortSignal, progress: (percent: number) => void): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const aborted = () => new DOMException('Upload cancelled', 'AbortError');
    const abort = () => { xhr.abort(); reject(aborted()); };
    const finish = (error?: Error, asset?: Asset) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(asset!); };
    if (signal.aborted) { reject(aborted()); return; }
    xhr.open('POST', '/api/assets/image'); xhr.timeout = 120000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      try {
        const value = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || !value.id || value.kind !== 'image') throw new Error(value.error || 'Image upload failed.');
        if (value.size > 10_000_000) throw new Error('Each image must be under 10 MB.');
        finish(undefined, value);
      } catch (error) { finish(error as Error); }
    };
    xhr.onerror = () => finish(new Error('Upload interrupted. Drop the remaining images again to retry.'));
    xhr.ontimeout = () => finish(new Error('Upload timed out. Drop the remaining images again to retry.'));
    xhr.onabort = () => finish(aborted());
    signal.addEventListener('abort', abort, { once: true });
    const form = new FormData(); form.append('file', file); xhr.send(form);
  });
}

/** Sequential requests preserve the user's file order and keep completed uploads. */
export async function uploadReferences(files: File[], signal: AbortSignal, added: (asset: Asset, index: number) => void, progress: (index: number, total: number, percent: number) => void) {
  for (const [index, file] of files.entries()) {
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    progress(index + 1, files.length, 0);
    const asset = await upload(file, signal, percent => progress(index + 1, files.length, percent));
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    added(asset, index);
  }
}
