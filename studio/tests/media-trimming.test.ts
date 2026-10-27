import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { command, filmstrip, prepareVideo, probe, videoFrameInfo } from '../server/media';
import { defaults, type Asset, type Job } from '../shared/types';

let root: string, source: Asset;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-trim-'));
  const file = path.join(root, 'colours.mp4');
  const inputs = ['red', 'green', 'blue', 'white', 'black'].flatMap(color => ['-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24:d=1`]);
  await command('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[out]', '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  source = { id: 'local-video', kind: 'video', path: file, name: 'colours.mp4', poster: '', size: 1, width: 64, height: 64, duration: 5, fps: 24, hasAudio: false, createdAt: '' };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
it('sends only the chosen nonzero interval to preparation and preserves the original', async () => {
  const before = await readFile(source.path);
  const job = { id: 'clip-test', settings: { ...defaults, start: 1.25, seconds: 2.25, fps: 24 }, width: 64, height: 64, progress: { targetFrames: 54 } } as Job;
  const file = await prepareVideo(job, source, root, new AbortController().signal);
  const info = await probe(file); expect(info.duration).toBeCloseTo(2.25, 2); expect(info.fps).toBe(24);
  async function pixel(time: number) {
    const out = path.join(root, `pixel-${time}.bin`);
    await command('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', out]);
    return [...await readFile(out)];
  }
  const first = await pixel(0), last = await pixel(2.2);
  expect(first[1]).toBeGreaterThan(80); expect(first[0]).toBeLessThan(30); expect(first[2]).toBeLessThan(30);
  expect(last.every(value => value > 220)).toBe(true);
  expect(await readFile(source.path)).toEqual(before);
});
it('creates and reuses one actual filmstrip locally, including concurrent preview requests', async () => {
  const [first, second] = await Promise.all([filmstrip(source), filmstrip(source)]);
  expect(first).toBe(second); expect(await filmstrip(source)).toBe(first);
  expect(await probe(first)).toMatchObject({ width: 1344, height: 72 });
  expect((await readdir(root)).filter(name => name.startsWith('filmstrip-'))).toEqual(['filmstrip-v1.jpg']);
});
it('prepares an exact zero-based 24 fps window from a fractional seek in 30 fps footage', async () => {
  const file = path.join(root, 'thirty-fps.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=30:d=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const job = { settings: { ...defaults, start: 61 / 24, seconds: 15, fps: 24 }, width: 64, height: 64, progress: { targetFrames: 360 } } as Job;
  const prepared = await prepareVideo(job, { ...source, path: file, fps: 30, duration: 20 }, root, new AbortController().signal);
  expect(await videoFrameInfo(prepared)).toEqual({ frames: 360, start: 0, duration: 15 });
});
it('rejects an actually short source before upload or sampling', async () => {
  const job = { settings: { ...defaults, start: 4, seconds: 2, fps: 24 }, width: 64, height: 64, progress: { targetFrames: 48 } } as Job;
  await expect(prepareVideo(job, source, root, new AbortController().signal)).rejects.toThrow('Nothing was uploaded or sampled');
});
