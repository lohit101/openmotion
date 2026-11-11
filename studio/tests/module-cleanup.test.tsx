import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApplication } from '../server/index';
import Sidebar from '../src/Sidebar';
import { activeModelIds, assertDownloadableModelFiles, downloadableModelDefinitions, emptyModels, isRetiredModel, modelDefinitions, upscaleModelFiles } from '../shared/models';
import { emptyImageEditDraft, imageEditFiles } from '../shared/image-edit';
import { openjutsuDefaults, openjutsuFaceFiles, openjutsuFiles } from '../shared/openjutsu';
import { smoothMotionFiles } from '../shared/smooth-motion';
import { downloadRows, deletableModelFile, modelUsage } from '../shared/downloads';
import { gpuFileRestorable } from '../shared/gpu-files';
import { marketRequirements } from '../server/cloud-market';
import { offerFiltersSchema } from '../shared/cloud';
import type { Job } from '../shared/types';
import { defaults } from '../shared/types';
let root = '', local: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => { local?.idle.dispose(); local?.models.dispose(); local?.cloud.dispose(); local?.store.close(); if (root) await rm(root, { recursive: true, force: true }); local = undefined; root = ''; });
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'recast-module-cleanup-'));
  local = await createApplication({ dataRoot: root, seed: false, allowSSH: false, cloudOptions: { backgroundSafety: false } });
  return local;
}
describe('one Imagen workspace and current dependencies', () => {
  it('shows all retained tools, one Imagen entry and no Characters or separate Image Edit', () => {
    const html = renderToStaticMarkup(<Sidebar view="image" collapsed={false} toggle={() => {}} select={() => {}} libraryCount={10}/>);
    for (const name of ['Remotion', 'Imagen', 'Clarity', 'Clip editor', 'Post-processing', 'My library', 'GPU cloud', 'Settings']) expect(html).toContain(`aria-label="${name}"`);
    expect(html.match(/aria-label="Imagen"/g)).toHaveLength(1);
    for (const name of ['Characters', 'Image Edit']) expect(html).not.toContain(`aria-label="${name}"`);
  });
  it('covers every retained preset including Fix Faces ONNX, optional image adapters and output FPS', () => {
    const edit = emptyImageEditDraft().settings;
    const required = new Set([...openjutsuFiles({ ...openjutsuDefaults, loras: [...openjutsuDefaults.loras, { name: 'minimax_h3_motion_transfer_v1.0_ref2va.safetensors', strength: 1 }] }), ...openjutsuFaceFiles(openjutsuDefaults), ...imageEditFiles({ ...edit, quality: 'turbo', consistency: true, bfs: true }), ...upscaleModelFiles, ...smoothMotionFiles]);
    expect([...activeModelIds].sort()).toEqual([...required].sort()); expect(activeModelIds.size).toBe(22);
    expect(new Set(downloadableModelDefinitions.map(file => file.id)).size).toBe(activeModelIds.size);
    expect(() => assertDownloadableModelFiles([...required])).not.toThrow();
    for (const name of ['insightface/models/buffalo_l/det_10g.onnx', 'insightface/models/buffalo_l/w600k_r50.onnx']) expect(isRetiredModel(name)).toBe(false);
    expect(modelUsage('text_encoders/qwen3vl_8b_int8_convrot.safetensors').map(item => item.workflow)).toEqual(['Remotion', 'Imagen']);
  });
  it('blocks obsolete downloads while retaining explicit deletion for on-disk files', () => {
    const retired = modelDefinitions.filter(file => isRetiredModel(file.id)).map(file => file.id);
    expect(retired.length).toBeGreaterThan(20);
    for (const id of [...retired, 'face-refinement/hyperswap_1a_256.onnx']) {
      expect(() => assertDownloadableModelFiles([id])).toThrow('retired');
      expect(gpuFileRestorable({ root: 'models', path: id })).toBe(false); expect(deletableModelFile(id)).toBe(true);
    }
    expect(downloadRows(emptyModels()).map(file => file.id).sort()).toEqual([...activeModelIds].sort());
    expect(() => assertDownloadableModelFiles([...activeModelIds, retired[0]])).toThrow('retired');
  });
  it('uses the current editor for Imagen rental estimates and old Image Edit filter aliases', async () => {
    const { store } = await fixture(), settings = { ...emptyImageEditDraft().settings, resolution: '2k' as const, quality: 'turbo' as const };
    store.set('image-edit-draft', { referenceIds: [], settings });
    const before = store.imageDraft(), filters = offerFiltersSchema.parse({ workflow: 'imagen', disk: 64, minVram: 24 });
    const current = marketRequirements(store, filters), alias = marketRequirements(store, { ...filters, workflow: 'image-edit' });
    const bytes = imageEditFiles(settings).reduce((sum, id) => sum + modelDefinitions.find(file => file.id === id)!.size, 0);
    expect(current.requirements.modelGB).toBe(bytes / 1e9); expect(current.requirements.minVram).toBe(48);
    expect(alias.requirements.modelGB).toBe(current.requirements.modelGB); expect(alias.requirements.minVram).toBe(48); expect(store.imageDraft()).toEqual(before);
  });
  it('rejects removed features before setup or inference, preserves stored drafts and serves current APIs', async () => {
    const app = await fixture(), kick = vi.spyOn(app.runner, 'kick'), start = vi.spyOn(app.models, 'start');
    const old = { ...app.store.imageDraft(), characterId: 'saved-character' }; app.store.set('image-draft', old);
    const initial = JSON.stringify(app.store.draft());
    for (const route of ['/api/images/jobs', '/api/images/draft', '/api/images/mask/target', '/api/characters', '/api/video-identity/gpu/setup', '/api/jobs/example/refine-face', '/api/facial-consistency/prepare']) await request(app.app).post(route).send({}).expect(410);
    await request(app.app).get('/api/characters').expect(410); await request(app.app).get('/api/video-identity').expect(410);
    const draft = emptyImageEditDraft(); await request(app.app).post('/api/image-edit/draft').send(draft).expect(200);
    const bootstrap = await request(app.app).get('/api/bootstrap').expect(200);
    expect(bootstrap.body.imageEditDraft).toEqual(draft); expect(bootstrap.body.characters).toEqual([]);
    expect(app.store.value('image-draft', null)).toEqual(old); expect(JSON.stringify(app.store.draft())).toBe(initial);
    expect(app.store.jobs()).toHaveLength(0); expect(kick).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    await request(app.app).get('/api/openjutsu/draft').expect(200);
  });
  it('recovers lost acknowledgements for paid old images and declines even shared-only retired setup', async () => {
    const app = await fixture(), key = 'existing-paid-image';
    const job = { id: 'paid-image', title: 'Historical image', mediaType: 'image', image: { version: 'imagen-v1' }, status: 'completed', settings: defaults, segments: [] } as unknown as Job;
    app.store.addJob(job, key);
    const response = await request(app.app).post('/api/images/jobs').set('Idempotency-Key', key).send({}).expect(200);
    expect(response.body.id).toBe(job.id); expect(app.store.jobs()).toHaveLength(1);
    await expect(app.models.prepareModule({ module: 'imagen', key: 'old', files: imageEditFiles(emptyImageEditDraft().settings), runtimes: ['localIdentity'] })).rejects.toThrow('retired');
  });
});
