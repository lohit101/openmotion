import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Asset, Job } from '../shared/types';
import type { Store } from './store';

export function command(executable: string, args: string[], signal?: AbortSignal, timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => process.kill('SIGTERM'), timeout);
    process.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-200000); });
    process.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(signal?.aborted ? 'Cancelled.' : stderr.trim() || `${executable} exited with code ${code}.`)); });
  });
}
export async function probe(file: string) {
  const info = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], undefined, 20000));
  const video = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!video || !video.width || !video.height) throw new Error('This file does not contain a readable image or video.');
  const [n, d] = (video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  const rotation = video.side_data_list?.find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation || 0;
  const rotated = Math.abs(rotation) % 180 === 90;
  return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height,
    duration: Number(info.format.duration || video.duration || 0), fps: d ? n / d : 0,
    hasAudio: info.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'), codec: video.codec_name as string };
}
export async function poster(file: string, destination: string) {
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', '-q:v', '3', destination], undefined, 25000);
}
export async function ingest(store: Store, file: string, kind: Asset['kind'], name: string, copy = false, givenId?: string): Promise<Asset> {
  const meta = await probe(file); const size = (await stat(file)).size;
  if (kind === 'image' && !['png', 'mjpeg', 'jpeg', 'webp'].includes(meta.codec)) throw new Error('Use a PNG, JPEG or WebP character image.');
  if (kind === 'image' && size > 25 * 1024 ** 2) throw new Error('Character images can be up to 25 MB.');
  if (kind === 'video' && (!(meta.duration > 0) || !Number.isFinite(meta.duration))) throw new Error('The video duration could not be read.');
  if (meta.width > 16384 || meta.height > 16384) throw new Error('The input dimensions are too large.');
  const id = givenId || randomUUID(); const folder = path.join(store.root, 'assets', id); await mkdir(folder, { recursive: true });
  const ext = kind === 'image' ? ({ mjpeg: '.jpg', jpeg: '.jpg', png: '.png', webp: '.webp' }[meta.codec] || '.png') : (['.mp4', '.mov', '.webm', '.mkv', '.m4v'].includes(path.extname(name).toLowerCase()) ? path.extname(name).toLowerCase() : '.mp4');
  const dest = path.join(folder, 'original' + ext); const thumb = path.join(folder, 'poster.jpg');
  try { if (copy) await copyFile(file, dest); else await rename(file, dest); await poster(dest, thumb); }
  catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  const asset: Asset = { id, kind, name: path.basename(name).slice(0, 180), path: dest, poster: thumb, size, ...meta, createdAt: new Date().toISOString() };
  store.addAsset(asset); return asset;
}
export async function prepareVideo(job: Job, source: Asset, folder: string, signal: AbortSignal) {
  const output = path.join(folder, 'prepared-source.mp4');
  const start = Math.floor(job.settings.start * job.settings.fps) / job.settings.fps;
  const duration = job.progress.targetFrames / job.settings.fps;
  const audio = source.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'] : ['-an'];
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', source.path, '-t', String(duration),
    '-map', '0:v:0', '-vf', `fps=${job.settings.fps},scale=${job.width}:${job.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${job.width}:${job.height}:(ow-iw)/2:(oh-ih)/2`,
    '-frames:v', String(job.progress.targetFrames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', output], signal, 180000);
  return output;
}
