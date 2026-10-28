import type { Express } from 'express';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import { command, filmstrip, poster, videoFrameInfo } from './media';
import { clipSourceKey, editDraftSchema, type ClipEditReceipt, type EditDraft, type EditorSource, type LocalExport, type TimelineClip } from '../shared/clip-editor';
import { defaults, type Asset, type Job } from '../shared/types';

interface ResolvedSource { meta: EditorSource; file: string; signature: string; canCopy: boolean; }
interface SavedExport extends LocalExport { requestKey: string; fingerprint: string; draft: EditDraft; }
interface ResolvedClip { clip: TimelineClip; source: ResolvedSource; }
const ratio = (value: string) => { const [n, d = 1] = String(value).split('/').map(Number); return d ? n / d : 0; };
const concatPath = (file: string) => "file '" + file.replace(/'/g, "'\\''") + "'";

export class ClipEditor {
  private cache = new Map<string, { stamp: string; source: ResolvedSource }>();
  private pending = new Map<string, Promise<ResolvedSource>>();
  private previews = new Map<string, Promise<string>>();
  private records: SavedExport[];
  private abort: AbortController | null = null;
  private active: string | null = null;
  private closing = false;
  constructor(public store: Store) {
    this.records = store.value<SavedExport[]>('clip-editor-exports', []);
    for (const row of this.records) if (['queued', 'exporting'].includes(row.status)) { row.status = 'failed'; row.stage = 'Export interrupted'; row.error = 'The local app restarted. Source clips and your timeline are unchanged; export again to retry.'; }
    this.persist();
  }
  private persist() { this.store.set('clip-editor-exports', this.records); }
  private public(row: SavedExport): LocalExport { const { requestKey: _key, fingerprint: _hash, draft: _draft, ...value } = row; return value; }
  list() { return this.records.slice(0, 30).map(row => this.public(row)); }
  get(id: string) { const row = this.records.find(item => item.id === id); return row ? this.public(row) : null; }
  async source(key: string): Promise<ResolvedSource> {
    const assetId = key.startsWith('asset:') ? z.string().uuid().parse(key.slice(6)) : null;
    const asset = assetId ? this.store.asset(assetId) : null;
    const job = assetId ? null : this.store.job(key);
    if (assetId ? !asset || asset.kind !== 'video' : !job || job.deleted || job.mediaType === 'image' || job.status !== 'completed' || !job.output) throw new Error('Choose an imported video or a completed video from your library.');
    const file = asset ? asset.path : job!.edit?.format === 'mkv' ? path.join(this.store.root, 'jobs', job!.id, 'master.mkv') : job!.output!;
    const title = asset ? asset.name : job!.title;
    if (!existsSync(file) || !(await stat(file)).isFile()) throw new Error('This saved video is unavailable on this computer.');
    const info = await stat(file), stamp = `${key}:${file}:${info.size}:${info.mtimeMs}`, cached = this.cache.get(key);
    if (cached?.stamp === stamp) return { ...cached.source, meta: { ...cached.source.meta, title } };
    const pending = this.pending.get(stamp); if (pending) return pending;
    const work = (async () => {
      const data = JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_data_hash', 'sha256', '-show_streams', '-show_format', '-of', 'json', file], undefined, 120000));
      const v = data.streams.find((stream: any) => stream.codec_type === 'video' && !stream.disposition?.attached_pic), a = data.streams.find((stream: any) => stream.codec_type === 'audio');
      const fps = ratio(v?.avg_frame_rate) || ratio(v?.r_frame_rate), frames = Number(v?.nb_read_frames || v?.nb_frames), duration = frames / fps;
      if (!v || !(fps >= 1 && fps <= 120) || !Number.isSafeInteger(frames) || frames < 1 || duration > 600) throw new Error('Clip editor supports readable constant-rate videos up to ten minutes.');
      if (Math.abs(ratio(v.r_frame_rate) - fps) > .001 || Math.abs(Number(v.duration || duration) - duration) > Math.max(.1, 2 / fps)) throw new Error('This video has a variable or discontinuous frame rate. Convert it to a constant frame rate before adding it for frame-accurate editing.');
      const rotation = Number(v.side_data_list?.find((item: any) => item.rotation !== undefined)?.rotation || 0);
      if (rotation % 90 || !['0:1', '1:1', undefined].includes(v.sample_aspect_ratio)) throw new Error('This video uses non-square pixels or a custom rotation. Normalize it before adding it to the editor.');
      if (!['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le'].includes(v.pix_fmt)) throw new Error('This pixel format is not supported by the lossless editor yet.');
      const rotated = Math.abs(rotation) % 180 === 90;
      const meta: EditorSource = { ...(assetId ? { assetId } : { jobId: key }), title, width: Number(rotated ? v.height : v.width), height: Number(rotated ? v.width : v.height), frames, fps, duration, codec: v.codec_name, pixelFormat: v.pix_fmt, colorRange: v.color_range || '', colorSpace: v.color_space || '', colorPrimaries: v.color_primaries || '', colorTransfer: v.color_transfer || '', hasAudio: !!a, sampleRate: Number(a?.sample_rate || 48000), channels: Number(a?.channels || 2), channelLayout: a?.channel_layout || (a?.channels === 1 ? 'mono' : 'stereo') };
      const source = { meta, file, canCopy: rotation % 360 === 0, signature: JSON.stringify(data.streams.map((stream: any) => [stream.codec_type, stream.codec_name, stream.profile, stream.width, stream.height, stream.pix_fmt, stream.time_base, stream.sample_rate, stream.channels, stream.channel_layout, stream.extradata_hash, stream.color_range, stream.color_space, stream.color_transfer, stream.color_primaries])) };
      this.cache.set(key, { stamp, source }); return source;
    })();
    this.pending.set(stamp, work);
    try { return await work; } finally { this.pending.delete(stamp); }
  }
  async sourceInfo(id: string) { return (await this.source(id)).meta; }
  async importAsset(id: string) {
    const meta = await this.sourceInfo(`asset:${z.string().uuid().parse(id)}`);
    const saved = this.store.value<string[]>('clip-editor-imports', []);
    this.store.set('clip-editor-imports', [id, ...saved.filter(value => value !== id)]);
    return meta;
  }
  async imports() {
    const items: EditorSource[] = [];
    for (const id of this.store.value<string[]>('clip-editor-imports', [])) {
      try { items.push(await this.sourceInfo(`asset:${id}`)); } catch { /* Unavailable originals never become exportable from a cached inventory. */ }
    }
    return items;
  }
  async preview(id: string) {
    const source = await this.source(id);
    if (!source.meta.assetId) return this.store.job(id)!.output!;
    if (source.meta.codec === 'h264' && ['.mp4', '.m4v', '.mov'].includes(path.extname(source.file).toLowerCase())) return source.file;
    const output = path.join(path.dirname(source.file), 'editor-preview-v1.mp4');
    if (existsSync(output)) return output;
    const pending = this.previews.get(id); if (pending) return pending;
    const task = (async () => {
      const temporary = path.join(path.dirname(source.file), `editor-preview-${randomUUID()}.mp4`);
      try {
        await command('ffmpeg', ['-v', 'error', '-y', '-threads', '2', '-i', source.file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '2', '-movflags', '+faststart', temporary], undefined, 600000);
        const check = await videoFrameInfo(temporary);
        if (check.frames !== source.meta.frames) throw new Error('Preview preparation changed the source frame count. The original video is retained.');
        await rename(temporary, output); return output;
      } finally { await rm(temporary, { force: true }); }
    })();
    this.previews.set(id, task); try { return await task; } finally { this.previews.delete(id); }
  }
  async filmstrip(id: string) {
    const { meta, file } = await this.source(id);
    const asset = { id, path: file, kind: 'video', duration: meta.duration } as Asset;
    return filmstrip(asset);
  }
  async start(input: unknown, requestKey: string) {
    const draft = editDraftSchema.parse(input); if (!draft.clips.length) throw new Error('Add at least one clip to your timeline.');
    const fingerprint = createHash('sha256').update(JSON.stringify(draft)).digest('hex'), previous = this.records.find(row => row.requestKey === requestKey);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('This export request belongs to a different timeline. Submit the updated edit again.'); return this.public(previous); }
    if (this.records.filter(row => ['queued', 'exporting'].includes(row.status)).length >= 3) throw new Error('Finish or cancel an export before queueing another.');
    await this.resolve(draft);
    // Recheck after asynchronous probes so concurrent identical requests remain idempotent.
    const duplicate = this.records.find(row => row.requestKey === requestKey);
    if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw new Error('The export request changed. Try again.'); return this.public(duplicate); }
    const row: SavedExport = { id: randomUUID(), title: draft.title, status: 'queued', stage: 'Queued on this computer', percent: 0, error: null, resultJobId: null, mode: draft.mode, createdAt: new Date().toISOString(), requestKey, fingerprint, draft };
    this.records.unshift(row); this.persist(); void this.kick(); return this.public(row);
  }
  private async resolve(draft: EditDraft): Promise<ResolvedClip[]> {
    const sources = new Map<string, ResolvedSource>();
    for (const clip of draft.clips) { const key = clipSourceKey(clip); if (!sources.has(key)) sources.set(key, await this.source(key)); }
    const clips = draft.clips.map(clip => { const source = sources.get(clipSourceKey(clip))!; if (clip.outFrame > source.meta.frames) throw new Error('A trim extends beyond its original video. Reset that clip and try again.'); return { clip, source }; });
    const first = clips[0].source.meta, duration = clips.reduce((sum, item) => sum + (item.clip.outFrame - item.clip.inFrame) / item.source.meta.fps, 0);
    if (duration > 600) throw new Error('Keep the combined video under ten minutes for this lightweight editor.');
    if (draft.mode === 'lossless' && clips.some(({ source: { meta } }) => Math.abs(meta.fps - first.fps) > .001 || ['pixelFormat', 'colorRange', 'colorSpace', 'colorTransfer', 'colorPrimaries'].some(key => meta[key as keyof EditorSource] !== first[key as keyof EditorSource]))) throw new Error('Lossless export needs matching frame rates and color formats. Choose matching clips, or use High-quality MP4 to normalize them.');
    const audio = clips.filter(item => item.source.meta.hasAudio).map(item => item.source.meta);
    if (draft.mode === 'lossless' && audio.some(meta => meta.sampleRate !== audio[0].sampleRate || meta.channels !== audio[0].channels || meta.channelLayout !== audio[0].channelLayout)) throw new Error('Lossless audio needs matching sample rates and channels. Use High-quality MP4 to normalize this mix.');
    return clips;
  }
  private update(row: SavedExport, stage: string, percent: number) { row.stage = stage; row.percent = Math.max(row.percent, Math.min(99, percent)); this.persist(); }
  private ffmpeg(args: string[], signal: AbortSignal, progress: (frame: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-filter_complex_threads', '2', ...args, '-progress', 'pipe:1', '-nostats'], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
      let buffer = '', error = '', last = 0;
      child.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop()!; for (const line of lines) if (line.startsWith('frame=')) { const frame = Number(line.slice(6)); if (Date.now() - last > 400) { progress(frame); last = Date.now(); } } });
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-6000); });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(signal.aborted ? 'Export cancelled.' : error || 'FFmpeg could not export this timeline.')));
    });
  }
  private async kick() {
    if (this.active || this.closing) return;
    const row = this.records.findLast(item => item.status === 'queued'); if (!row) return;
    this.active = row.id; this.abort = new AbortController();
    try { await this.export(row, this.abort.signal); }
    catch (error) { if (row.status !== 'cancelled') { row.status = 'failed'; row.stage = 'Export failed'; row.error = (error as Error).message.slice(0, 1800); this.persist(); } if (!this.store.job(row.id)) await rm(path.join(this.store.root, 'jobs', row.id), { recursive: true, force: true }); }
    finally { this.active = null; this.abort = null; if (!this.closing) void this.kick(); }
  }
  private async export(row: SavedExport, signal: AbortSignal) {
    const clips = await this.resolve(row.draft), first = clips[0].source.meta;
    signal.throwIfAborted();
    const width = Math.max(...clips.map(item => item.source.meta.width)), height = Math.max(...clips.map(item => item.source.meta.height));
    const duration = clips.reduce((sum, item) => sum + (item.clip.outFrame - item.clip.inFrame) / item.source.meta.fps, 0), frames = clips.reduce((sum, item) => sum + item.clip.outFrame - item.clip.inFrame, 0);
    const space = await statfs(this.store.root), required = frames * width * height * (first.pixelFormat.includes('10') ? 6 : 3) * 1.2 + 512 * 1024 ** 2;
    if (row.mode === 'lossless' && space.bavail * space.bsize < required) throw new Error(`Lossless export may need ${(required / 1e9).toFixed(1)} GB free on this computer. Free local storage or use High-quality MP4.`);
    signal.throwIfAborted();
    const folder = path.join(this.store.root, 'jobs', row.id); await mkdir(folder, { recursive: true });
    const started = Date.now(); row.status = 'exporting'; this.update(row, 'Preparing local export', 1);
    // AAC priming/padding cannot be represented independently at every join in
    // one copied MP4 stream. Multiple audio clips take the exact PCM path.
    const copy = row.mode === 'lossless' && first.codec === 'h264' && (clips.length === 1 || clips.every(item => !item.source.meta.hasAudio)) && clips.every(({ clip, source }) => source.canCopy && clip.inFrame === 0 && clip.outFrame === source.meta.frames && source.signature === clips[0].source.signature);
    let method: ClipEditReceipt['method'] = copy ? 'stream-copy' : row.mode === 'lossless' ? 'lossless-encode' : 'h264-encode';
    let format: ClipEditReceipt['format'] = copy || row.mode === 'mp4' ? 'mp4' : 'mkv';
    let master = path.join(folder, format === 'mkv' ? 'master.mkv' : 'final.mp4');
    if (copy) {
      this.update(row, 'Joining original streams without re-encoding', 5);
      try {
        if (clips.length === 1 && path.extname(clips[0].source.file).toLowerCase() === '.mp4') await copyFile(clips[0].source.file, master);
        else if (clips.length === 1) await this.ffmpeg(['-i', clips[0].source.file, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', master], signal, frame => this.update(row, 'Saving original streams without re-encoding', 5 + frame / frames * 85));
        else { const list = path.join(folder, 'concat.txt'); await writeFile(list, clips.map(item => concatPath(item.source.file)).join('\n')); await this.ffmpeg(['-copyts', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', master], signal, frame => this.update(row, 'Joining original streams without re-encoding', 5 + frame / frames * 85)); }
        const check = await videoFrameInfo(master, signal);
        if (check.frames !== frames || Math.abs(check.start) > .001 || Math.abs(check.duration - duration) > .1) throw new Error('Stream copy did not preserve the timeline exactly.');
      } catch (error) { if (signal.aborted) throw error; await rm(master, { force: true }); method = 'lossless-encode'; format = 'mkv'; master = path.join(folder, 'master.mkv'); }
    }
    if (method !== 'stream-copy') {
      const hasAudio = clips.some(item => item.source.meta.hasAudio), audio = clips.find(item => item.source.meta.hasAudio)?.source.meta;
      const rate = row.mode === 'mp4' ? 48000 : audio?.sampleRate || 48000, layout = row.mode === 'mp4' ? 'stereo' : audio?.channelLayout || 'stereo';
      const filters: string[] = [], links: string[] = [];
      clips.forEach(({ clip, source }, index) => {
        const seconds = (clip.outFrame - clip.inFrame) / source.meta.fps;
        filters.push(`[${index}:v:0]trim=start_frame=${clip.inFrame}:end_frame=${clip.outFrame},setpts=PTS-STARTPTS,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v${index}]`);
        links.push(`[v${index}]`);
        if (hasAudio) { filters.push(source.meta.hasAudio ? `[${index}:a:0]atrim=start=${clip.inFrame / source.meta.fps}:end=${clip.outFrame / source.meta.fps},asetpts=PTS-STARTPTS,aformat=sample_rates=${rate}:channel_layouts=${layout},apad=whole_dur=${seconds},atrim=duration=${seconds}[a${index}]` : `anullsrc=r=${rate}:cl=${layout},atrim=duration=${seconds},asetpts=PTS-STARTPTS[a${index}]`); links.push(`[a${index}]`); }
      });
      filters.push(`${links.join('')}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[video]${hasAudio ? '[audio]' : ''}`);
      const fps = row.mode === 'lossless' ? first.fps : Math.max(...clips.map(item => item.source.meta.fps));
      const args = clips.flatMap(item => ['-threads', '2', '-i', item.source.file]);
      const encode = row.mode === 'lossless' ? ['-c:v', 'ffv1', '-level', '3', '-g', '1', '-slicecrc', '1', '-pix_fmt', first.pixelFormat] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart'];
      const color = row.mode === 'lossless' ? [first.colorRange && ['-color_range', first.colorRange], first.colorSpace && ['-colorspace', first.colorSpace], first.colorPrimaries && ['-color_primaries', first.colorPrimaries], first.colorTransfer && ['-color_trc', first.colorTransfer]].flatMap(item => item || []) : [];
      const total = row.mode === 'lossless' ? frames : Math.round(duration * fps);
      await this.ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[video]', ...(hasAudio ? ['-map', '[audio]', '-c:a', row.mode === 'lossless' ? 'pcm_f32le' : 'aac', ...(row.mode === 'mp4' ? ['-b:a', '256k'] : [])] : ['-an']), ...encode, ...color, '-threads', '2', ...(row.mode === 'lossless' ? ['-fps_mode', 'passthrough'] : []), master], signal, frame => this.update(row, row.mode === 'lossless' ? 'Writing frame-accurate lossless master' : 'Encoding high-quality MP4', 5 + Math.min(1, frame / total) * (row.mode === 'lossless' ? 70 : 85)));
    }
    signal.throwIfAborted();
    let preview = master;
    if (format === 'mkv') { preview = path.join(folder, 'preview.mp4'); await this.ffmpeg(['-threads', '2', '-i', master, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-threads', '2', '-movflags', '+faststart', preview], signal, frame => this.update(row, 'Preparing playable preview · master stays lossless', 76 + Math.min(1, frame / frames) * 18)); }
    this.update(row, 'Checking the completed export', 95);
    const checked = await videoFrameInfo(master, signal), expected = row.mode === 'mp4' ? Math.round(duration * Math.max(...clips.map(item => item.source.meta.fps))) : frames;
    if (checked.frames !== expected || Math.abs(checked.start) > .001) throw new Error('Export validation found a frame count or timestamp mismatch. Sources were kept; no incorrect result was added to the library.');
    const thumb = path.join(folder, 'poster.jpg'); await poster(preview, thumb); signal.throwIfAborted();
    const receipt: ClipEditReceipt = { version: 'timeline-v1', mode: row.mode, method, format, videoCodec: format === 'mkv' ? 'ffv1' : 'h264', duration, frames: expected, fps: row.mode === 'mp4' ? Math.max(...clips.map(item => item.source.meta.fps)) : first.fps, width, height, sources: clips.map(({ clip, source }) => ({ ...clip, title: source.meta.title, fps: source.meta.fps, sourceFrames: source.meta.frames, width: source.meta.width, height: source.meta.height })) };
    await writeFile(path.join(folder, 'clip-edit.json'), JSON.stringify(receipt, null, 2));
    const original = clips[0].clip.jobId ? this.store.job(clips[0].clip.jobId) : null;
    const job: Job = { id: row.id, title: row.title, status: 'completed', settings: { ...(original?.settings || defaults), start: 0, seconds: duration, fps: receipt.fps as Job['settings']['fps'] }, sourceId: clips[0].clip.assetId || original?.sourceId || '', referenceId: original?.referenceId || '', createdAt: row.createdAt, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), favorite: false, deleted: false, width, height, progress: { stage: 'Local edit complete', node: null, value: null, max: null, unit: 'frames', segment: 1, segments: 1, completedFrames: expected, targetFrames: expected, updatedAt: Date.now() }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: preview, poster: thumb, cancelRequested: false, elapsedSeconds: (Date.now() - started) / 1000, origin: 'edit', workflow: null, edit: receipt };
    this.store.addJob(job); row.status = 'completed'; row.stage = 'Saved to your library'; row.percent = 100; row.resultJobId = job.id; this.persist();
  }
  cancel(id: string) { const row = this.records.find(item => item.id === id); if (!row) throw new Error('Export not found.'); if (['queued', 'exporting'].includes(row.status)) { row.status = 'cancelled'; row.stage = 'Export cancelled · source clips kept'; row.error = null; this.persist(); if (this.active === id) this.abort?.abort(); } return this.public(row); }
  async shutdown() { this.closing = true; if (this.active) this.cancel(this.active); while (this.active) await new Promise(resolve => setTimeout(resolve, 30)); }
}

export function registerClipEditorRoutes(app: Express, store: Store) {
  const editor = new ClipEditor(store);
  app.get('/api/clip-editor/imports', async (_req, res) => res.json(await editor.imports()));
  app.post('/api/clip-editor/imports', async (req, res) => { const { assetId } = z.object({ assetId: z.string().uuid() }).strict().parse(req.body); res.status(201).json(await editor.importAsset(assetId)); });
  app.get('/api/clip-editor/sources/:id', async (req, res) => res.json(await editor.sourceInfo(String(req.params.id))));
  app.get('/api/clip-editor/sources/:id/filmstrip', async (req, res) => res.sendFile(await editor.filmstrip(String(req.params.id))));
  app.get('/api/clip-editor/sources/:id/preview', async (req, res) => res.sendFile(await editor.preview(String(req.params.id))));
  app.get('/api/clip-editor/exports', (_req, res) => res.json(editor.list()));
  app.get('/api/clip-editor/exports/:id', (req, res) => { const value = editor.get(String(req.params.id)); if (!value) return void res.sendStatus(404); res.json(value); });
  app.post('/api/clip-editor/exports', async (req, res) => { const key = z.string().uuid().parse(req.get('Idempotency-Key')); res.status(202).json(await editor.start(req.body, key)); });
  app.post('/api/clip-editor/exports/:id/cancel', (req, res) => res.json(editor.cancel(String(req.params.id))));
  return editor;
}
