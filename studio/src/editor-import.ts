import type { Asset } from '../shared/types';

export const editorVideoAccept = 'video/*,.mp4,.mov,.webm,.mkv,.m4v';
export const isEditorVideo = (file: Pick<File, 'type' | 'name'>) => file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name);

export function uploadEditorMedia<T>(file: File, progress: (percent: number) => void, signal: AbortSignal, endpoint: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), body = new FormData(); body.append('file', file);
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.open('POST', endpoint); xhr.responseType = 'json';
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { finish(); if (xhr.status >= 200 && xhr.status < 300 && (xhr.response?.id || xhr.response?.audioId)) resolve(xhr.response); else reject(new Error(xhr.response?.error || 'This media could not be imported.')); };
    xhr.onerror = () => { finish(); reject(new Error('The local upload connection was lost. Try importing the video again.')); };
    xhr.onabort = () => { finish(); reject(new DOMException('Import cancelled.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { finish(); reject(new DOMException('Import cancelled.', 'AbortError')); return; }
    xhr.send(body);
  });
}
export const uploadEditorVideo = (file: File, progress: (percent: number) => void, signal: AbortSignal, localEditor = false) => uploadEditorMedia<Asset>(file, progress, signal, localEditor ? '/api/clip-editor/videos' : '/api/assets/video');
