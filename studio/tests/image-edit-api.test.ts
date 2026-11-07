import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApplication } from '../server/index';
import { emptyImageEditDraft, imageEditVersion } from '../shared/image-edit';
import { imageDefaults } from '../shared/image-replacement';
import { defaults, type Asset, type Job } from '../shared/types';

let root = '', local: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => { local?.idle.dispose(); local?.models.dispose(); local?.cloud.dispose(); local?.store.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-edit-api-'));
  local = await createApplication({ dataRoot: root, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false } });
  const asset: Asset = { id: 'photo', kind: 'image', name: 'Original.png', path: path.join(root, 'photo.png'), poster: '', width: 64, height: 64, size: 4, duration: 0, fps: 0, hasAudio: false, createdAt: new Date().toISOString() };
  await writeFile(asset.path, 'test'); local.store.addAsset(asset);
  return local;
}
it('saves a separate editor draft and validates one-to-three references without touching Imagen or Remotion', async () => {
  const { app, store } = await fixture();
  const before = await request(app).get('/api/bootstrap'), draft = { ...emptyImageEditDraft(), referenceIds: ['photo'], settings: { ...emptyImageEditDraft().settings, prompt: '  precise 原样\n  ' } };
  await request(app).post('/api/image-edit/draft').send(draft).expect(200);
  const response = await request(app).get('/api/image-edit/draft').expect(200); expect(response.body).toEqual(draft);
  const after = await request(app).get('/api/bootstrap');
  expect(after.body.imageEditDraft).toEqual(draft); expect(after.body.draft).toEqual(before.body.draft); expect(after.body.imageDraft).toEqual(before.body.imageDraft);
  await request(app).post('/api/image-edit/draft').send({ ...draft, referenceIds: ['missing'] }).expect(400);
  await request(app).post('/api/image-edit/jobs').set('Idempotency-Key', 'four-images').send({ ...draft, referenceIds: ['photo', 'photo', 'photo', 'photo'] }).expect(422);
  await request(app).post('/api/image-edit/jobs').set('Idempotency-Key', 'offline').send(draft).expect(503);
  expect(store.jobs()).toEqual([]);
});
it('blocks submission during GPU idle pause and returns the real JPEG download type and filename', async () => {
  const { app, store, idle } = await fixture(); idle.state.status = 'pausing';
  const blocked = await request(app).post('/api/image-edit/jobs').send({}).expect(409); expect(blocked.body.error).toContain('idle pause');
  const folder = path.join(root, 'jobs', 'saved-edit'); await mkdir(folder, { recursive: true });
  const output = path.join(folder, 'final.jpg'); await writeFile(output, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const job: Job = { id: 'saved-edit', title: 'Saved image', mediaType: 'image', status: 'completed', sourceId: 'photo', referenceId: 'photo', settings: defaults,
    image: { version: 'image-edit-2511-v1', settings: { ...imageDefaults, model: 'qwen2511' }, faceId: null, maskId: null, edit: { settings: { ...emptyImageEditDraft().settings, format: 'jpeg' }, references: [] }, geometry: { width: 64, height: 64, contentWidth: 64, contentHeight: 64, x: 0, y: 0, outputWidth: 64, outputHeight: 64 } },
    width: 64, height: 64, createdAt: new Date().toISOString(), favorite: false, deleted: false, progress: { stage: 'Image ready', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 1, targetFrames: 1, updatedAt: Date.now() }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output, poster: null, cancelRequested: false, elapsedSeconds: 1, origin: 'render', workflow: null };
  store.addJob(job);
  const file = await request(app).get('/api/jobs/saved-edit/output?download=1').expect(200);
  expect(file.headers['content-type']).toMatch(/^image\/jpeg/); expect(file.headers['content-disposition']).toContain('Saved image.jpg');
  const image = await request(app).get('/api/jobs/saved-edit/image').expect(200); expect(image.headers['content-type']).toMatch(/^image\/jpeg/);
});

it('migrates only the editable draft and serves the new native PNG without changing paid 2511 runs', async () => {
  const { app, store } = await fixture();
  const settings = { prompt: '  exact\n提示词 ', quality: 'lightning', precision: 'bf16', aspect: '9:16', resolution: '2k', format: 'jpeg', seed: 15, randomSeed: false };
  store.set('image-edit-draft', { referenceIds: ['photo'], settings });
  const migrated = await request(app).get('/api/image-edit/draft').expect(200);
  expect(migrated.body.settings).toEqual({ ...settings, quality: 'turbo', precision: 'int8', bfs: true, consistency: true });
  expect(store.value('image-edit-draft', null)).toEqual({ referenceIds: ['photo'], settings });
  const job = { id: 'new-edit-native', mediaType: 'image', image: { version: imageEditVersion }, settings: defaults } as Job;
  store.addJob(job);
  const folder = path.join(root, 'jobs', job.id); await mkdir(folder, { recursive: true });
  const png = Buffer.from('unchanged native png fixture'); await writeFile(path.join(folder, 'gpu-result.png'), png);
  const response = await request(app).get('/api/jobs/' + job.id + '/image-native').expect(200);
  expect(response.headers['content-type']).toMatch(/^image\/png/); expect(response.body).toEqual(png);
});
