import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Asset, Job } from '../shared/types';
import type { Store } from './store';
import { frameFloor } from '../shared/clip';

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
  const [tn,td]=(video.time_base||'0/1').split('/').map(Number);
  let videoDuration=Number(video.duration_ts)*tn/td;
  if(!(videoDuration>0))videoDuration=Number(video.duration);
  const origin=Number(info.format.start_time)||0,start=Number.isFinite(Number(video.start_time))?Number(video.start_time):origin;
  let duration=videoDuration>0?start-origin+videoDuration:0;
  if(!(duration>0)&&Number(info.format.duration)>0){
    // WebM/MKV often omit stream duration. Inspect video timestamps rather
    // than treating a longer audio track as additional video frames.
    const packets=await command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,duration_time','-of','csv=p=0',file],undefined,30000);
    const ends=packets.split(/\r?\n/).map(line=>{const [pts,length]=line.split(',').map(Number);return Number.isFinite(pts)?pts+(length>0?length:(d&&n?d/n:0))-origin:0;});
    duration=Math.max(0,...ends);
    if(!(duration>0))throw new Error('The video timeline could not be read. Convert this file to a constant-rate MP4 and try again.');
  }
  return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height,
    duration, fps: d ? n / d : 0,
    hasAudio: info.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'), codec: video.codec_name as string };
}
const checkedVideoDurations=new WeakMap<Store,Map<string,string>>();
export async function refreshVideoDuration(store:Store,asset:Asset):Promise<Asset>{
  if(asset.kind!=='video')return asset;
  const file=await stat(asset.path),identity=[asset.path,file.size,file.mtimeMs].join(':');
  let checked=checkedVideoDurations.get(store);if(!checked){checked=new Map();checkedVideoDurations.set(store,checked);}
  if(checked.get(asset.id)===identity)return store.asset(asset.id)||asset;
  const meta=await probe(asset.path);if(!(meta.duration>0))throw new Error('The source video timeline could not be read.');
  const updated={...asset,duration:meta.duration};
  if(asset.duration!==meta.duration)store.addAsset(updated);
  checked.set(asset.id,identity);return updated;
}
export async function poster(file: string, destination: string) {
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', '-q:v', '3', destination], undefined, 25000);
}
export async function videoFrameInfo(file: string, signal?: AbortSignal) {
  const info = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,start_time,duration,avg_frame_rate', '-of', 'json', file], signal, 30000));
  const stream = info.streams?.[0];
  return { frames: Number(stream?.nb_read_frames), start: Number(stream?.start_time || 0), duration: Number(stream?.duration) };
}
const pendingFilmstrips = new Map<string, Promise<string>>();
export async function filmstrip(asset: Asset): Promise<string> {
  if (asset.kind !== 'video' || !(asset.duration > 0)) throw new Error('Choose a readable video for trimming.');
  const output = path.join(path.dirname(asset.path), 'filmstrip-v1.jpg');
  if (existsSync(output)) return output;
  const pending = pendingFilmstrips.get(output); if (pending) return pending;
  const task = (async () => {
    const temporary = path.join(path.dirname(asset.path), `filmstrip-${randomUUID()}.jpg`);
    try {
      await command('ffmpeg', ['-v', 'error', '-y', '-i', asset.path, '-an', '-vf', `tpad=stop_mode=clone:stop_duration=2,fps=12/${asset.duration},scale=112:72:force_original_aspect_ratio=increase,crop=112:72,tile=12x1:nb_frames=12`, '-frames:v', '1', '-q:v', '4', temporary], undefined, 45000);
      await rename(temporary, output); return output;
    } finally { await rm(temporary, { force: true }); }
  })();
  pendingFilmstrips.set(output, task);
  try { return await task; } finally { pendingFilmstrips.delete(output); }
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
  const temporary = path.join(folder, `prepared-source-${randomUUID()}.mp4`);
  const start = frameFloor(job.settings.start, job.settings.fps) / job.settings.fps;
  const duration = job.progress.targetFrames / job.settings.fps;
  const meta=await probe(source.path),available=frameFloor(meta.duration,job.settings.fps);
  if(frameFloor(start,job.settings.fps)+job.progress.targetFrames>available)throw new Error(`The selection extends beyond the last video frame (${meta.duration.toFixed(3)}s). Audio may continue longer. Trim the clip to the available video frames and retry. Nothing was uploaded or sampled.`);
  const audio = source.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'] : ['-an'];
  try {
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', source.path, '-t', String(duration),
      '-map', '0:v:0', '-vf', `fps=${job.settings.fps}:start_time=0,scale=${job.width}:${job.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${job.width}:${job.height}:(ow-iw)/2:(oh-ih)/2`,
      '-frames:v', String(job.progress.targetFrames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', temporary], signal, 180000);
    const actual = await videoFrameInfo(temporary, signal);
    if (actual.frames !== job.progress.targetFrames || Math.abs(actual.start) > .001) throw new Error(`Clip preparation produced ${actual.frames} frames instead of ${job.progress.targetFrames}, or a nonzero start timestamp. Nothing was uploaded or sampled. Select a shorter source range and retry.`);
    await rename(temporary, output);
    return output;
  } finally { await rm(temporary, { force: true }); }
}
