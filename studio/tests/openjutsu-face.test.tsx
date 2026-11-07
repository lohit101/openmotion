import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import nativeGraphs from './fixtures/openjutsu-face-graphs.json';
import { compileOpenjutsuFace } from '../server/openjutsu-workflow';
import { emptyOpenjutsuFaceDraft, openjutsuDefaults, openjutsuFaceFiles, openjutsuFiles } from '../shared/openjutsu';
import { emptyModels, modelDefinitions } from '../shared/models';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { createOpenjutsuJob } from '../server/openjutsu';
import { Store } from '../server/store';
import { Runner } from '../server/runner';
import type { ConnectionManager } from '../server/comfy';
import { ModelManager } from '../server/models';
import type { Asset, Bootstrap, Catalog, Graph } from '../shared/types';
import { command } from '../server/media';
import { createApplication } from '../server/index';
import OpenjutsuFaceWorkspace from '../src/OpenjutsuFaceWorkspace';

const repo = path.resolve(import.meta.dirname, '../..');
let folder = '', store: Store | undefined;
afterEach(async () => { store?.close(); store = undefined; if (folder) await rm(folder, { recursive: true, force: true }); folder = ''; });
for (const style of ['photo', 'mouth'] as const) it('matches the native Desktop Fix Faces graph: ' + style, () => {
  expect(compileOpenjutsuFace(openjutsuDefaults, { style, chunkSeconds: 6.5 })).toEqual(nativeGraphs[style]);
});
it('downloads only the face dependencies and shared H3 components', () => {
  const plan = moduleDownloadPlan('openjutsu-face', openjutsuDefaults);
  expect(plan.files).toEqual(openjutsuFaceFiles(openjutsuDefaults)); expect(plan.files).toHaveLength(11);
  expect(plan.runtimes).toEqual(['openjutsu-face-tools']);
  expect(plan.files).not.toContain('checkpoints/sam3.1_multiplex_fp16.safetensors');
  expect(openjutsuFiles(openjutsuDefaults)).toHaveLength(7);
  expect(openjutsuFiles(openjutsuDefaults).some(f => /buffalo|ultralytics|sam_vit_b/.test(f))).toBe(false);
});
async function fixture() {
  folder = await mkdtemp(path.join(os.tmpdir(), 'recast-face-post-')); store = new Store(folder);
  const source: Asset = { id: 'source', kind: 'video', name: 'Finished.mp4', path: path.join(folder, 'source.mp4'), width: 64, height: 96, size: 4, duration: 6, fps: 24, hasAudio: true, poster: '', createdAt: new Date().toISOString() };
  const reference: Asset = { ...source, id: 'reference', kind: 'image', name: 'Reference.png', path: path.join(folder, 'reference.png'), duration: 0, fps: 0, hasAudio: false };
  await writeFile(source.path, 'source'); await writeFile(reference.path, 'reference'); store.addAsset(source); store.addAsset(reference);
  const catalog: Catalog = {};
  for (const node of Object.values(compileOpenjutsuFace(openjutsuDefaults, { style: 'mouth', chunkSeconds: 6.5 }))) {
    catalog[node.class_type] ||= { input: { required: {} }, output: Array(20).fill('*') };
    Object.assign(catalog[node.class_type].input.required!, Object.fromEntries(Object.entries(node.inputs).map(([k, v]) => [k, [typeof v === 'number' ? 'FLOAT' : 'STRING']])));
  }
  const prompt = vi.fn(async () => ({ prompt_id: 'face-once' }));
  const client = { json: vi.fn(async (route: string, body?: unknown): Promise<any> => route === '/object_info' ? catalog : route === '/prompt' ? prompt() : { queue_running: [], queue_pending: [] }), upload: vi.fn(async (_path: string, name: string) => name + '.mp4'), watch: vi.fn(async () => ({ close: () => {} })), download: vi.fn(), cancel: vi.fn() };
  const connection = { status: { state: 'online', endpoint: 'http://127.0.0.1:8188', loras: [] }, catalog, client: () => client } as unknown as ConnectionManager;
  const runner = new Runner(store, connection, {}, repo); vi.spyOn(runner, 'kick').mockResolvedValue();
  const state = emptyModels(); state.files.forEach(f => { if (openjutsuFaceFiles(openjutsuDefaults).includes(f.id)) f.status = 'installed'; });
  const models = { state } as ModelManager, draft = { ...emptyOpenjutsuFaceDraft(), sourceId: source.id, referenceId: reference.id };
  const create = (key = 'face-request') => { const { face, parentId, ...base } = draft; return createOpenjutsuJob(store!, connection, runner, models, base, key, () => {}, draft); };
  return { source, reference, catalog, connection, client, prompt, runner, models, draft, create };
}
it('freezes separate face settings, keeps other drafts intact and deduplicates submission', async () => {
  const f = await fixture(), before = JSON.stringify([store!.draft(), store!.imageDraft()]);
  const j = await f.create(); expect(j.openjutsu?.version).toBe('openjutsu-face-v1'); expect(j.openjutsu?.face).toEqual({ style: 'photo', chunkSeconds: 6.5 });
  expect(j.workflow?.['29'].inputs.feather).toBe(8); expect(j.facialConsistency).toBeUndefined();
  expect((await f.create()).id).toBe(j.id); expect(f.prompt).not.toHaveBeenCalled(); expect(JSON.stringify([store!.draft(), store!.imageDraft()])).toBe(before);
});
it('refuses missing face weights before saving or requesting GPU work', async () => {
  const f = await fixture(); f.models.state.files.find(x => x.id.includes('buffalo_l'))!.status = 'missing';
  await expect(f.create()).rejects.toThrow('Download Fix Faces'); expect(store!.jobs()).toHaveLength(0); expect(f.prompt).not.toHaveBeenCalled();
});
it('recognizes face weights from physical inventory even when no loader lists them, and notices deletion', async () => {
  const f = await fixture(); store!.set('cloud-connected-instance', 123);
  f.catalog.LoraLoaderModelOnly.input.required!.lora_name = [[]];
  const physical = modelDefinitions.filter(file => /^(ultralytics|sams|insightface)\//.test(file.id)).map(file => ({ id: file.id, size: file.size, verified: true }));
  const manager = new ModelManager(store!, f.connection, repo, vi.fn(), vi.fn(async () => ({ files: physical, loras: [] })));
  try {
    await manager.refresh(); expect(manager.state.error).toBeNull(); expect(manager.state.files.filter(file => physical.some(p => p.id === file.id)).every(file => file.status === 'installed')).toBe(true);
    const removed = physical.pop()!; await manager.refresh(); expect(manager.state.files.find(file => file.id === removed.id)?.status).toBe('missing');
  } finally { manager.dispose(); }
});
it('requires the selected finished parent to match the exact source video bytes', async () => {
  const f = await fixture(), parent = await f.create('parent'); parent.status = 'completed'; parent.output = f.reference.path; store!.saveJob(parent); f.draft.parentId = parent.id;
  await expect(f.create('changed-parent')).rejects.toThrow('original video changed'); expect(store!.jobs()).toHaveLength(1);
});
it('retains the exact native face output and recovers a transfer without another render', async () => {
  const f = await fixture(), j = await f.create(), native = path.join(folder, 'face-native.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:size=64x96:rate=24', '-frames:v', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', native]);
  f.client.json.mockImplementation(async route => route === '/object_info' ? f.catalog : route === '/prompt' ? f.prompt() : route === '/history/face-once' ? { 'face-once': { status: { status_str: 'success' }, outputs: { '30': { gifs: [{ filename: 'fixed.mp4', type: 'output' }] } } } } : {});
  f.client.download.mockRejectedValueOnce(new Error('Connection lost')).mockImplementationOnce(async (_item, dest) => copyFile(native, dest));
  await f.runner.run(j, new AbortController().signal); expect(store!.job(j.id)?.status).toBe('interrupted');
  await f.runner.run(store!.job(j.id)!, new AbortController().signal); const result = store!.job(j.id)!;
  expect(result.status).toBe('completed'); expect(await readFile(result.output!)).toEqual(await readFile(native)); expect(f.prompt).toHaveBeenCalledOnce();
  expect(f.client.upload.mock.calls[0][1]).toContain('motion'); expect(result.workflow?.['1'].inputs.video).toContain(j.id);
});
it('opens a completed video for face processing offline without changing the parent', async () => {
  const f = await fixture(), parent = await f.create('parent'), native = path.join(folder, 'finished.mp4');
  await command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:size=64x96:rate=24', '-frames:v', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', native]);
  parent.status = 'completed'; parent.output = native; store!.saveJob(parent); const before = JSON.stringify(store!.job(parent.id));
  const local = await createApplication({ repo, dataRoot: folder, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false, fetcher: vi.fn().mockRejectedValue(new Error('No provider request expected')) } });
  try { const r = await request(local.app).post('/api/openjutsu/face/use').send({ jobId: parent.id }).expect(200); expect(r.body.draft.parentId).toBe(parent.id); expect(r.body.asset.path).toBe(''); expect(r.body.draft.length).toBe(0); expect(JSON.stringify(local.store.job(parent.id))).toBe(before); await request(local.app).post('/api/openjutsu/face/use').send({ jobId: crypto.randomUUID() }).expect(400); }
  finally { local.idle.dispose(); local.models.dispose(); local.cloud.dispose(); local.store.close(); }
});
it('shows native face choices and an explicit setup action without generating or downloading', () => {
  const data = { assets: [], jobs: [], connection: { state: 'online' }, models: emptyModels() } as unknown as Bootstrap;
  const download = vi.fn(), generate = vi.fn();
  const html = renderToStaticMarkup(<OpenjutsuFaceWorkspace data={data} downloads={{ state: data.models, online: true, blocked: false, download, remove: () => {} }} selectedId={null} select={() => {}} asset={() => {}} job={generate} back={() => {}} openGPU={() => {}} openDownloads={() => {}} library={() => {}} />);
  expect(html).toContain('Match the photo'); expect(html).toContain('one-fifth'); expect(html).toContain('Download Fix Faces'); expect(download).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});
