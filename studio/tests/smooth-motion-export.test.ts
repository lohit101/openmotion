import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command } from '../server/media';
import { fileSHA256 } from '../server/openjutsu-runner';
import { recoverRoundedSmoothTail } from '../server/smooth-motion-export';
import type { SmoothMotionRun } from '../shared/smooth-motion';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(fps = 30, frames = 156) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'recast-smooth-tail-')); folders.push(folder);
  const source = path.join(folder, 'source.mp4'), native = path.join(folder, 'native.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:size=64x96:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5.15', '-frames:v', '124', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', source]);
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=blue:size=64x96:rate=${fps}`, '-i', source, '-map', '0:v:0', '-map', '1:a:0', '-frames:v', String(frames), '-c:v', 'libx264', '-threads', '1', '-c:a', 'copy', native]);
  const run: SmoothMotionRun = { version: 'smooth-motion-v1', targetFPS: 30, sourceFile: source, sourceSHA256: await fileSHA256(source), sourceSeconds: 124 / 24, instanceId: 123, endpoint: 'http://127.0.0.1:8188', graphSHA256: 'fixture', graph: {}, nativeFile: native, nativeSHA256: await fileSHA256(native) };
  return { folder, run, native, source };
}
const signal = () => new AbortController().signal;

describe('cached Smooth Motion rounding recovery', () => {
  it('recovers one redundant tail frame without re-encoding video or audio and keeps the original immutable', async () => {
    const f = await fixture(), hash = f.run.nativeSHA256, file = await recoverRoundedSmoothTail(f.run, f.folder, signal());
    expect(file).toBe(path.join(f.folder, 'smoothed-playback.mp4'));
    const proof = JSON.parse(await readFile(path.join(f.folder, 'smooth-motion-timing-export.json'), 'utf8'));
    expect(proof).toMatchObject({ originalFrames: 156, removedTailFrames: 1, videoPacketsPreserved: 155, decodedTailFramesVerified: 60, reencoded: false });
    expect(proof.audioPacketsPreserved).toBeGreaterThan(0); expect(proof.binding.frames).toBe(155);
    expect(await fileSHA256(f.native)).toBe(hash); expect(await fileSHA256(f.source)).toBe(f.run.sourceSHA256);
    expect(await recoverRoundedSmoothTail(f.run, f.folder, signal())).toBe(file);
    expect(await fileSHA256(file!)).toBe(proof.outputSHA256);
  });
  it.each([[30, 154], [31, 156]])('rejects unrelated count/rate errors (%s fps, %s frames)', async (fps, frames) => {
    const f = await fixture(fps, frames);
    expect(await recoverRoundedSmoothTail(f.run, f.folder, signal())).toBeNull();
  });
  it('refuses a source whose bytes no longer match the request', async () => {
    const f = await fixture(); f.run.sourceSHA256 = '0'.repeat(64);
    await expect(recoverRoundedSmoothTail(f.run, f.folder, signal())).rejects.toThrow('could not be verified');
  });
  it('refuses a modified cached playback instead of overwriting it', async () => {
    const f = await fixture(), output = await recoverRoundedSmoothTail(f.run, f.folder, signal());
    await writeFile(output!, 'changed');
    await expect(recoverRoundedSmoothTail(f.run, f.folder, signal())).rejects.toThrow('could not be verified');
    expect(await readFile(output!, 'utf8')).toBe('changed');
  });
  it('honors cancellation before starting local processing', async () => {
    const f = await fixture(), controller = new AbortController(), reason = new Error('Cancelled'); controller.abort(reason);
    await expect(recoverRoundedSmoothTail(f.run, f.folder, controller.signal)).rejects.toBe(reason);
  });
});
