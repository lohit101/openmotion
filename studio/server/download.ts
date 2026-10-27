import { createWriteStream } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// A saved-output transfer is recoverable independently of the GPU connection.
export class DownloadError extends Error {}
class InvalidDownload extends DownloadError {}
export type DownloadProgress = (received: number, total: number | null) => void;
interface TransferMetadata { source: string; etag: string | null; modified: string | null; total: number | null; }
const bytesOnDisk = async (file: string) => { try { return (await stat(file)).size; } catch { return 0; } };

export async function downloadOutput(url: string, destination: string, signal: AbortSignal,
  progress?: DownloadProgress, options: { idleMs?: number; attempts?: number; backoffMs?: number } = {}) {
  const partial = destination + '.part', metadataFile = partial + '.json';
  const attempts = options.attempts ?? 3, idleMs = options.idleMs ?? 120_000;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted();
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('Output transfer stopped receiving data.')), idleMs); };
    const combined = AbortSignal.any([signal, idle.signal]);
    try {
      touch();
      let offset = await bytesOnDisk(partial), metadata: TransferMetadata | null = null;
      try { metadata = JSON.parse(await readFile(metadataFile, 'utf8')); } catch { /* Older transfers have no sidecar. */ }
      if (metadata && metadata.source !== url) { offset = 0; metadata = null; }
      if (offset && !metadata) {
        // Upgrade legacy .part files safely: compare their prefix with the
        // immutable saved artifact before appending, rather than losing 46 MB.
        const count = Math.min(offset, 65536);
        const response = await fetch(url, { headers: { Range: `bytes=0-${count - 1}` }, signal: combined });
        if (response.status === 206 && response.headers.get('content-range')?.startsWith(`bytes 0-${count - 1}/`)) {
          const remote = Buffer.from(await response.arrayBuffer()), local = Buffer.alloc(count), file = await open(partial, 'r');
          try { await file.read(local, 0, count, 0); } finally { await file.close(); }
          if (!remote.equals(local)) offset = 0;
        } else { await response.body?.cancel(); offset = 0; }
        touch();
      }
      const headers: Record<string, string> = {};
      if (offset) {
        headers.Range = `bytes=${offset}-`;
        const validator = metadata?.etag && !metadata.etag.startsWith('W/') ? metadata.etag : metadata?.modified;
        if (validator) headers['If-Range'] = validator;
      }
      const response = await fetch(url, { headers, signal: combined });
      touch();
      const etag = response.headers.get('etag'), modified = response.headers.get('last-modified');
      if (response.status === 416) {
        const total = Number(response.headers.get('content-range')?.match(/^bytes \*\/(\d+)$/)?.[1]);
        await response.body?.cancel();
        if (offset > 0 && total === offset && (!metadata?.etag || !etag || metadata.etag === etag)) {
          await rename(partial, destination); await rm(metadataFile, { force: true }); progress?.(total, total); return;
        }
        throw new InvalidDownload('The saved output range no longer matches the partial download. No render was resubmitted.');
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        const message = `Saved output download returned HTTP ${response.status}. Existing render files are kept.`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new InvalidDownload(message);
        throw new DownloadError(message);
      }
      let total: number | null = null, append = false;
      if (response.status === 206) {
        const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) >= Number(range[3])
            || metadata?.etag && etag && metadata.etag !== etag) {
          await response.body.cancel(); throw new InvalidDownload('The server returned an inconsistent saved-output range. The partial file was kept.');
        }
        total = Number(range[3]); append = offset > 0;
      } else {
        // A server without Range support, or a changed If-Range validator,
        // returns the full object. Replace the partial; never mix two files.
        offset = 0;
        const length = response.headers.get('content-length');
        if (length !== null && Number.isSafeInteger(Number(length)) && Number(length) >= 0) total = Number(length);
      }
      await writeFile(metadataFile, JSON.stringify({ source: url, etag, modified, total } satisfies TransferMetadata));
      let received = offset;
      progress?.(received, total);
      const tracker = new Transform({ transform(chunk, _encoding, done) {
        touch(); received += chunk.length;
        if (total !== null && received > total) { done(new InvalidDownload('The saved output exceeded its advertised size.')); return; }
        progress?.(received, total); done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as any), tracker, createWriteStream(partial, { flags: append ? 'a' : 'w' }), { signal: combined });
      if (total !== null && await bytesOnDisk(partial) !== total) throw new DownloadError('The saved output transfer ended before all bytes arrived.');
      await rename(partial, destination); await rm(metadataFile, { force: true }); progress?.(received, total); return;
    } catch (error) {
      if (signal.aborted) throw signal.reason || error;
      lastError = error;
      if (error instanceof InvalidDownload) throw error;
    } finally { clearTimeout(timer!); idle.abort(); }
    if (attempt + 1 < attempts) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
        const wait = setTimeout(finish, (options.backoffMs ?? 500) * (attempt + 1));
        const cancel = () => { clearTimeout(wait); signal.removeEventListener('abort', cancel); reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      });
    }
  }
  throw new DownloadError(lastError instanceof DownloadError ? lastError.message
    : 'Saved output download paused. Partial bytes and the completed render are kept. Resume to continue the transfer.');
}
