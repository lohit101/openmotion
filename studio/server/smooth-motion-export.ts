import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SmoothMotionRun } from '../shared/smooth-motion';
import { command } from './media';
async function fileSHA256(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }

const exists = (file: string) => access(file).then(() => true, () => false);
const expectedFrames = (seconds: number, fps: number) => Math.ceil(seconds * fps - .000001);
const mismatch = () => new Error('The saved Smooth Motion timing export could not be verified. Its original render is kept.');
async function probe(file: string, signal: AbortSignal) {
  return JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal, 30000));
}
function videoDuration(video: any): number | null {
  const clock = /^([0-9]+)\/([1-9][0-9]*)$/.exec(String(video.time_base));
  if (!clock || !Number.isSafeInteger(Number(video.duration_ts)) || Number(video.duration_ts) <= 0) return null;
  return Number(video.duration_ts) * Number(clock[1]) / Number(clock[2]);
}
function decodedHashes(text: string) { return text.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1)!.trim()); }
export async function smoothMotionFrameCount(run: SmoothMotionRun, signal: AbortSignal): Promise<number> {
  const saved = expectedFrames(run.sourceSeconds, run.targetFPS);
  if (!await exists(run.sourceFile)) return saved;
  let input;
  try { input = (await probe(run.sourceFile, signal)).streams?.find((s: any) => s.codec_type === 'video'); }
  catch (error) {
    if (signal.aborted) throw signal.reason || error;
    // An already-valid paid output remains recoverable if its upload was later
    // removed or damaged. A new tail repair still requires a verified source.
    return saved;
  }
  const exact = input && videoDuration(input);
  // Older automatic runs froze ffprobe's six-decimal value. Correct only that
  // metadata rounding, with the original source hash, without changing its plan.
  if (!exact || Math.abs(exact - run.sourceSeconds) > .00000051) return saved;
  const canonical = expectedFrames(exact, run.targetFPS);
  if (canonical === saved) return saved;
  if (await fileSHA256(run.sourceFile) !== run.sourceSHA256) throw mismatch();
  return canonical;
}
async function tail(file: string, start: number, frames: number, fps: number, signal: AbortSignal) {
  // Floor the seek to a microsecond before the exact frame timestamp.
  const seek = (Math.floor(start * 1000000 / fps) / 1000000).toFixed(6);
  return decodedHashes(await command('ffmpeg', ['-v', 'error', '-ss', seek, '-i', file, '-map', '0:v:0', '-frames:v', String(frames), '-fps_mode', 'passthrough', '-f', 'framemd5', '-'], signal, 60000));
}
async function packets(file: string, stream: string, output: string, signal: AbortSignal): Promise<any[]> {
  // ffprobe writes the potentially large packet list to an owned temporary
  // file instead of overflowing the command helper's bounded stdout buffer.
  await command('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=pts,dts,duration,data_hash', '-of', 'json', '-o', output, file], signal, 60000);
  return JSON.parse(await readFile(output, 'utf8')).packets || [];
}

/** Recover only the proven v1 microsecond-rounding defect. No RIFE inference,
 * relaxed validation, frame synthesis, audio changes or replacement of raw media.
 */
export async function recoverRoundedSmoothTail(run: SmoothMotionRun, folder: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  if (!run.nativeFile || !run.nativeSHA256 || !await exists(run.sourceFile)) return null;
  const original = await probe(run.nativeFile, signal), source = await probe(run.sourceFile, signal);
  const raw = original.streams?.find((s: any) => s.codec_type === 'video'), input = source.streams?.find((s: any) => s.codec_type === 'video');
  if (!raw || !input) return null;
  const exact = videoDuration(input), expected = exact === null ? 0 : expectedFrames(exact, run.targetFPS), legacy = expectedFrames(Number(input.duration), run.targetFPS);
  const rotation = Number(input.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? input.tags?.rotate ?? 0);
  const swapped = Math.abs(rotation) % 180 === 90, width = swapped ? input.height : input.width, height = swapped ? input.width : input.height;
  if (exact === null || Math.abs(exact - run.sourceSeconds) > .00000051 || legacy !== expected + 1 ||
    raw.codec_name !== 'h264' || raw.avg_frame_rate !== `${run.targetFPS}/1` || Number(raw.nb_frames) !== legacy || raw.width !== width || raw.height !== height ||
    Math.abs(Number(raw.duration) - legacy / run.targetFPS) > .000001) return null;
  if (await fileSHA256(run.sourceFile) !== run.sourceSHA256 || await fileSHA256(run.nativeFile) !== run.nativeSHA256) throw mismatch();
  const file = path.join(folder, 'smoothed-playback.mp4'), receipt = path.join(folder, 'smooth-motion-timing-export.json');
  const binding = { version: 'smooth-motion-tail-export-v1', nativeSHA256: run.nativeSHA256, sourceSHA256: run.sourceSHA256, targetFPS: run.targetFPS, frames: expected };
  if (await exists(file) && await exists(receipt)) {
    const saved = JSON.parse(await readFile(receipt, 'utf8'));
    if (JSON.stringify(saved.binding) === JSON.stringify(binding) && saved.outputSHA256 === await fileSHA256(file)) return file;
    throw mismatch();
  }
  const temporary = await mkdtemp(path.join(folder, 'smooth-timing-'));
  try {
    const candidate = await exists(file) ? file : path.join(temporary, 'playback.mp4');
    if (candidate !== file) {
      const videoOnly = path.join(temporary, 'video.mp4');
      await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', run.nativeFile, '-map', '0:v:0', '-an', '-c:v', 'copy', '-frames:v', String(expected), videoOnly], signal, 60000);
      // Read audio independently to preserve every packet despite video B-frame
      // reordering and FFmpeg's early termination at a frame-count limit.
      await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', videoOnly, '-i', run.nativeFile, '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-map_metadata', '1', '-movflags', '+faststart', candidate], signal, 60000);
    }
    const finished = (await probe(candidate, signal)).streams?.find((s: any) => s.codec_type === 'video');
    if (!finished || finished.avg_frame_rate !== `${run.targetFPS}/1` || Number(finished.nb_frames) !== expected || finished.width !== width || finished.height !== height || Math.abs(Number(finished.duration) - expected / run.targetFPS) > .000001) throw mismatch();
    const beforeVideo = await packets(run.nativeFile, 'v:0', path.join(temporary, 'before-video.json'), signal);
    const afterVideo = await packets(candidate, 'v:0', path.join(temporary, 'after-video.json'), signal);
    const beforeAudio = await packets(run.nativeFile, 'a:0', path.join(temporary, 'before-audio.json'), signal);
    const afterAudio = await packets(candidate, 'a:0', path.join(temporary, 'after-audio.json'), signal);
    if (beforeVideo.length !== legacy || afterVideo.length !== expected || !beforeVideo.every(p => typeof p.data_hash === 'string') ||
      JSON.stringify(beforeVideo.slice(0, expected)) !== JSON.stringify(afterVideo) || JSON.stringify(beforeAudio) !== JSON.stringify(afterAudio)) throw mismatch();
    const count = Math.min(expected, run.targetFPS * 2), start = expected - count;
    const beforeTail = await tail(run.nativeFile, start, count, run.targetFPS, signal), afterTail = await tail(candidate, start, count, run.targetFPS, signal);
    if (beforeTail.length !== count || JSON.stringify(beforeTail) !== JSON.stringify(afterTail)) throw mismatch();
    signal.throwIfAborted();
    const record = { binding, outputSHA256: await fileSHA256(candidate), originalFrames: legacy, removedTailFrames: 1, videoPacketsPreserved: expected, audioPacketsPreserved: beforeAudio.length, decodedTailFramesVerified: count, reencoded: false };
    if (candidate !== file) await rename(candidate, file);
    const pending = path.join(temporary, 'receipt.json'); await writeFile(pending, JSON.stringify(record, null, 2)); await rename(pending, receipt);
    return file;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
