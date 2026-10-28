import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { characterForImage, registerCharacterRoutes } from '../server/characters';
import { emptyImageDraft } from '../shared/image-replacement';
import { snapshotCharacter, useCharacterDraft, type Character } from '../shared/characters';
import type { Asset } from '../shared/types';

const roots: string[] = [], stores: Store[] = [];
afterEach(() => { stores.forEach(s => s.close()); stores.length = 0; roots.forEach(r => rmSync(r, { force: true, recursive: true })); roots.length = 0; });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'characters-')); roots.push(root); const store = new Store(root); stores.push(store);
  for (const id of ['body', 'face', 'other']) store.addAsset({ id, kind: 'image', name: id + '.png', width: 1800, height: 800, path: '/private/' + id, poster: '', size: 10, duration: 0, fps: 0, hasAudio: false, createdAt: '' });
  const app = express(); app.use(express.json()); registerCharacterRoutes(app, store); app.use((error: Error, _req: any, res: any, _next: any) => res.status(400).json({ error: error.message }));
  const input = { name: 'Samaira', bodyId: 'body', faceId: 'face', bodyView: { assetId: 'body', x: 16, y: 2, width: 285, height: 770 }, faceView: { assetId: 'face', x: 9, y: 4, width: 275, height: 395 } };
  return { root, store, agent: request(app), input };
}
describe('local character library', () => {
  it('persists both sheets and default views without a GPU or image generation', async () => {
    const { root, store, agent, input } = fixture();
    const c = (await agent.post('/api/characters').send(input).expect(201)).body as Character;
    expect(c).toMatchObject({ ...input, revision: 1, archived: false }); expect(store.jobs()).toEqual([]);
    expect((await agent.get('/api/characters').expect(200)).body).toEqual([c]);
    const second = new Store(root); expect(second.character(c.id)).toEqual(c); second.close();
    expect(JSON.stringify(c)).not.toContain('/private/');
  });
  it('rejects wrong sheet bindings and stale updates without mutating the profile', async () => {
    const { store, agent, input } = fixture();
    await agent.post('/api/characters').send({ ...input, faceView: { ...input.faceView, assetId: 'other' } }).expect(400);
    await agent.post('/api/characters').send({ ...input, bodyView: { ...input.bodyView, x: 1790 } }).expect(400);
    await agent.post('/api/characters').send({ ...input, faceId: 'body', faceView: null }).expect(400);
    const c = (await agent.post('/api/characters').send(input).expect(201)).body as Character;
    await agent.patch('/api/characters/' + c.id).send({ revision: 2, name: 'Wrong' }).expect(409);
    expect(store.character(c.id)).toEqual(c);
    const updated = (await agent.patch('/api/characters/' + c.id).send({ revision: 1, name: 'Updated' }).expect(200)).body;
    expect(updated.revision).toBe(2); expect(updated.name).toBe('Updated');
  });
  it('freezes per-run crop overrides and protects old snapshots when a character changes', async () => {
    const { store, agent, input } = fixture(); const c = (await agent.post('/api/characters').send(input).expect(201)).body as Character;
    const draft = useCharacterDraft(emptyImageDraft(), c); draft.settings.faceReferenceView!.x = 20;
    const snapshot = characterForImage(store, draft)!; expect(snapshot.faceView!.x).toBe(20); expect(store.character(c.id)!.faceView!.x).toBe(9);
    await agent.patch('/api/characters/' + c.id).send({ revision: 1, name: 'New name' }).expect(200);
    expect(snapshot.name).toBe('Samaira'); expect(snapshot.revision).toBe(1);
    expect(() => characterForImage(store, draft)).toThrow('character changed');
  });
  it('archives reversibly, retains sheet assets and requires reviewed views before a paid character run', async () => {
    const { store, agent, input } = fixture(); const c = (await agent.post('/api/characters').send(input).expect(201)).body as Character;
    const draft = useCharacterDraft(emptyImageDraft(), c); draft.settings.faceReferenceView = null;
    expect(() => characterForImage(store, draft)).toThrow('Choose one body view');
    await agent.patch('/api/characters/' + c.id).send({ revision: 1, archived: true }).expect(200);
    expect(store.asset(input.bodyId)).not.toBeNull(); expect(store.asset(input.faceId)).not.toBeNull();
    expect(() => characterForImage(store, useCharacterDraft(emptyImageDraft(), c))).toThrow('available character');
    await agent.patch('/api/characters/' + c.id).send({ revision: 2, archived: false }).expect(200);
    expect(store.character(c.id)!.archived).toBe(false);
  });
});
