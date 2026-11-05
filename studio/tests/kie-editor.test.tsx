import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createKieApplication } from '../server/kie-index';
import { command, videoFrameInfo } from '../server/media';
import { audioSourceKey, editDraftSchema, editEnvelope, hasEditEffects, trimAudioTrack, type EditDraft, type TimelineAudio } from '../shared/clip-editor';
import { savedRunSettings } from '../shared/library';
import ClipEditorWorkspace from '../src/ClipEditorWorkspace';
import EditorAudioLane from '../src/EditorAudioLane';
import EditorClipInspector from '../src/EditorClipInspector';

let root: string, local: Awaited<ReturnType<typeof createKieApplication>>, assetId: string, original: string, musicId: string, sourceHash: string;
let providerCalls = 0;
const hash = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
const clip = (extra = {}) => ({ id: randomUUID(), assetId, inFrame: 0, outFrame: 72, ...extra });
async function done(id: string) {
  for (let i = 0; i < 400; i++) { const row = local.clipEditor.get(id)!; if (['completed', 'failed', 'cancelled'].includes(row.status)) { expect(row.error).toBeNull(); expect(row.status).toBe('completed'); return local.store.job(row.resultJobId!)!; } await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Fixture export did not finish');
}
async function exportEdit(draft: Partial<EditDraft>) { const response = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'Local editor test', mode: 'mp4', clips: [clip()], ...draft }); expect(response.status, JSON.stringify(response.body)).toBe(202); return done(response.body.id); }
async function pixels(file: string, frame: number) { const out = path.join(root, randomUUID() + '.gray'); await command('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),format=gray`, '-frames:v', '1', '-f', 'rawvideo', out]); return readFile(out); }
const mean = (pixels: Buffer) => pixels.reduce((a, b) => a + b, 0) / pixels.length;
const energy = (pixels: Buffer, width: number) => { let total = 0; for (let i = 1; i < pixels.length; i++) if (i % width) total += Math.abs(pixels[i] - pixels[i - 1]); return total / pixels.length; };

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-kie-editor-')); original = path.join(root, 'motion.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x320:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', original]);
  sourceHash = await hash(original);
  const unavailable = async (): Promise<any> => { providerCalls++; throw new Error('Provider must not be called by the editor'); };
  local = await createKieApplication({ dataRoot: path.join(root, 'data'), apiClient: { getCredits: unavailable, uploadFile: unavailable, createTask: unavailable, getTask: unavailable, downloadResult: unavailable } });
  const upload = await request(local.app).post('/api/clip-editor/videos').attach('file', original, 'Phone video.mp4'); expect(upload.status).toBe(201); assetId = upload.body.id;
  const song = path.join(root, 'music.wav'); await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', song]);
  const music = await request(local.app).post('/api/clip-editor/audio').attach('file', song, 'Music.wav'); expect(music.status, JSON.stringify(music.body)).toBe(201); musicId = music.body.audioId;
});
afterAll(async () => { if (local) await local.shutdown(); if (root) await rm(root, { recursive: true, force: true }); });

describe('Kie local editor integration', () => {
  it('imports original clips and music without a key or provider access, and protects local-only routes', async () => {
    expect(local.account.status().configured).toBe(false); expect(providerCalls).toBe(0);
    expect(await hash(local.store.asset(assetId)!.path)).toBe(sourceHash);
    const imports = await request(local.app).get('/api/clip-editor/imports'); expect(imports.body[0]).toMatchObject({ assetId, frames: 96, hasAudio: true });
    const audio = await request(local.app).get('/api/clip-editor/audio'); expect(audio.body[0]).toMatchObject({ audioId: musicId, title: 'Music.wav', duration: 2 }); expect(audio.body[0]).not.toHaveProperty('file');
    await request(local.app).get(`/api/clip-editor/audio/${musicId}/preview`).expect(200);
    await request(local.app).post('/api/clip-editor/exports').set('Host', 'foreign.invalid').send({}).expect(403);
    await request(local.app).post('/api/clip-editor/exports').set('Origin', 'https://foreign.invalid').send({}).expect(403);
  });
  it('trims and joins exact intervals into a downloadable MP4 and saves an editable receipt', async () => {
    const draftBefore = local.store.value('kie-draft', null);
    const job = await exportEdit({ clips: [clip({ inFrame: 12, outFrame: 36 }), clip({ inFrame: 48, outFrame: 72 })] });
    expect(job.edit).toMatchObject({ frames: 48, duration: 2, format: 'mp4', width: 240, height: 320 });
    expect((await videoFrameInfo(job.output!)).frames).toBe(48);
    await request(local.app).get(`/api/jobs/${job.id}/video`).set('Range', 'bytes=0-200').expect(206);
    const download = await request(local.app).get(`/api/jobs/${job.id}/video?download=1`); expect(download.status).toBe(200); expect(download.headers['content-disposition']).toContain('.mp4');
    const receipt = await request(local.app).get(`/api/jobs/${job.id}/receipt`); expect(JSON.parse(receipt.text)).toMatchObject({ frames: 48, sources: [{ inFrame: 12, outFrame: 36 }, { inFrame: 48, outFrame: 72 }] });
    expect(savedRunSettings(job)).not.toHaveProperty('seed'); expect(local.store.value('kie-draft', null)).toEqual(draftBefore); expect(await hash(original)).toBe(sourceHash);
    await request(local.app).patch(`/api/jobs/${job.id}`).send({ favorite: true, deleted: true }).expect(200); await request(local.app).patch(`/api/jobs/${job.id}`).send({ deleted: false }).expect(200);
    await request(local.app).post(`/api/jobs/${job.id}/resume`).send({}).expect(400);
  });
  it('renders real fade-in and fade-out pixels without changing duration or resolution', async () => {
    const job = await exportEdit({ clips: [clip({ fadeIn: .5, fadeOut: .5 })] });
    expect(job.edit).toMatchObject({ version: 'timeline-v2', frames: 72, width: 240, height: 320 });
    expect(mean(await pixels(job.output!, 0))).toBeLessThan(2);
    expect(mean(await pixels(job.output!, 71))).toBeLessThan(20);
    expect(mean(await pixels(job.output!, 36))).toBeGreaterThan(60);
  });
  it('blurs clip edges while keeping the middle sharp', async () => {
    const job = await exportEdit({ clips: [clip({ blurIn: .5, blurOut: .5 })] });
    for (const frame of [0, 71]) expect(energy(await pixels(job.output!, frame), 240)).toBeLessThan(energy(await pixels(original, frame), 240) * .8);
    const center = await pixels(job.output!, 36), expected = await pixels(original, 36);
    expect(center.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / center.length).toBeLessThan(3);
    expect(job.edit!.sources[0]).toMatchObject({ blurIn: .5, blurOut: .5 });
  });
  it('separates original audio, positions music, applies volume/fades, and keeps audio timing', async () => {
    const audioTracks: TimelineAudio[] = [{ id: randomUUID(), assetId, start: .5, inSeconds: 0, outSeconds: 1, volume: .5, audioFadeIn: .2, audioFadeOut: .2 }, { id: randomUUID(), audioId: musicId, start: 1.75, inSeconds: 0, outSeconds: .75, volume: .6 }];
    const job = await exportEdit({ clips: [clip({ muted: true })], audioTracks });
    expect(job.edit).toMatchObject({ version: 'timeline-v2', audioTracks: [{ assetId, start: .5, audioFadeIn: .2 }, { audioId: musicId, start: 1.75 }] });
    const pcm = path.join(root, 'mix.f32'); await command('ffmpeg', ['-v', 'error', '-y', '-i', job.output!, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm]); const bytes = await readFile(pcm);
    const rms = (start: number, end: number) => { let sum = 0; for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++) sum += bytes.readFloatLE(i * 4) ** 2; return Math.sqrt(sum / ((end - start) * 48000)); };
    expect(rms(.1, .3)).toBeLessThan(.001); expect(rms(.8, 1)).toBeGreaterThan(.02); expect(rms(.51, .55)).toBeLessThan(rms(.8, 1) / 2); expect(rms(1.55, 1.65)).toBeLessThan(.001); expect(rms(2, 2.2)).toBeGreaterThan(.03); expect(rms(2.7, 2.9)).toBeLessThan(.001);
    expect(providerCalls).toBe(0);
  });
  it('removes sound when muted and refuses invalid trims or lossless effects before queueing', async () => {
    const job = await exportEdit({ clips: [clip({ muted: true })] });
    const metadata = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', job.output!])); expect(metadata.streams.some((stream: any) => stream.codec_type === 'audio')).toBe(false);
    for (const draft of [{ mode: 'lossless', clips: [clip({ fadeIn: .2 })] }, { audioTracks: [{ id: randomUUID(), audioId: musicId, start: 0, inSeconds: 0, outSeconds: 10 }] }, { clips: [clip({ volume: 3 })] }]) {
      const response = await request(local.app).post('/api/clip-editor/exports').set('Idempotency-Key', randomUUID()).send({ title: 'Bad edit', mode: 'mp4', clips: [clip()], ...draft }); expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(providerCalls).toBe(0);
  });
});

describe('small editor controls', () => {
  it('preserves old draft shape and clamps audio edge drags at source and timeline bounds', () => {
    const legacy = { title: 'Older edit', mode: 'lossless', clips: [clip()] }; expect(editDraftSchema.parse(legacy)).toEqual(legacy);
    const track = { id: randomUUID(), audioId: randomUUID(), start: 2, inSeconds: 1, outSeconds: 4 };
    expect(trimAudioTrack(track, 'in', -10, 8, 10)).toMatchObject({ start: 1, inSeconds: 0 }); expect(trimAudioTrack(track, 'out', 100, 8, 10).outSeconds).toBe(8); expect(trimAudioTrack(track, 'move', -10, 8, 10).start).toBe(0);
    expect(editEnvelope(0, 1, 4, 4)).toBe(0); expect(editEnvelope(.5, 1, 4, 4)).toBe(1); expect(editEnvelope(1, 1, 4, 4)).toBe(0);
    expect(hasEditEffects({ ...legacy, mode: 'lossless' })).toBe(false);
  });
  it('shows the basic local editor, separate audio lane and inline effects with accessible labels', () => {
    const page = renderToStaticMarkup(<ClipEditorWorkspace enhanced jobs={[]} assets={[]} assetAdded={() => {}} intent={null} consumed={() => {}} library={() => {}} />);
    for (const label of ['Clip editor', 'Add videos', 'Add audio', 'Export format', 'Export video']) expect(page).toContain(label);
    const track = { id: randomUUID(), audioId: musicId, start: 0, inSeconds: 0, outSeconds: 1 };
    const lanes = renderToStaticMarkup(<EditorAudioLane tracks={[track]} sources={{ [audioSourceKey(track)]: { title: 'Soundtrack', duration: 2 } }} selected={null} select={() => {}} change={() => {}} seek={() => {}} zoom={55} duration={3} />); expect(lanes).toContain('Trim start of audio 1'); expect(lanes).toContain('Trim end of audio 1');
    const source = { ...local.store.asset(assetId)!, jobId: undefined, assetId, frames: 96, fps: 24, hasAudio: true, codec: 'h264', pixelFormat: 'yuv420p', colorRange: '', colorSpace: '', colorPrimaries: '', colorTransfer: '', sampleRate: 48000, channels: 2, channelLayout: 'stereo', title: 'Clip' };
    const settings = renderToStaticMarkup(<EditorClipInspector clip={clip()} source={source} timelineDuration={3} changeClip={() => {}} changeAudio={() => {}} detach={() => {}} removeAudio={() => {}} split={() => {}} canSplit canDetach />);
    for (const label of ['Fade in', 'Fade out', 'Blur in', 'Blur out', 'Separate audio', 'Split at playhead', 'Audio fade in']) expect(settings).toContain(label);
    expect(settings).not.toContain('role="dialog"');
  });
});
