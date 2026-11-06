import type { Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { characterAdditionalReferences, characterPackInputSchema, characterSnapshot, type KieCharacterPack, type KieCharacterSnapshot } from '../shared/kie-characters';
import type { KieDraft } from '../shared/kie';
import type { Store } from './store';
import { command, ingest, probe } from './media';

const catalogKey = 'kie-character-pack-ids-v1';
const key = (id: string, revision?: number) => `kie-character-pack:${id}${revision ? `:${revision}` : ''}`;
const cropKey = (id: string) => `kie-character-crop:${id}`;
const idSchema = z.string().uuid();
async function hash(file: string) { const result = createHash('sha256'); for await (const chunk of createReadStream(file)) result.update(chunk); return result.digest('hex'); }
export function kieCharacters(store: Store) { return store.value<string[]>(catalogKey, []).map(id => store.value<KieCharacterPack | null>(key(id), null)).filter((pack): pack is KieCharacterPack => !!pack).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function validateCharacterSelection(store: Store, draft: KieDraft) {
  const snapshot = draft.characterPack;
  if (!snapshot) { if (draft.additionalReferences?.some(r => r.character)) throw new Error('Choose a saved character for labelled character references.'); return; }
  const saved = store.value<KieCharacterPack | null>(key(snapshot.id, snapshot.revision), null);
  if (!saved) throw new Error('This saved character revision is unavailable. Choose the character again.');
  const exact = characterSnapshot(saved, snapshot.references.map(r => r.id));
  if (JSON.stringify(exact) !== JSON.stringify(snapshot) || draft.faceReferenceId !== exact.face.assetId || JSON.stringify(draft.additionalReferences || []) !== JSON.stringify(characterAdditionalReferences(exact))) throw new Error('The selected character references changed. Choose the character and views again.');
}
export function registerKieCharacterRoutes(app: Express, store: Store) {
  const pending = new Map<string, Promise<unknown>>();
  let closing = false, saving = 0, cropping = 0;
  const persist = (pack: KieCharacterPack) => {
    const ids = store.value<string[]>(catalogKey, []);
    if (!ids.includes(pack.id)) ids.push(pack.id);
    store.db.exec('BEGIN IMMEDIATE');
    try { store.set(key(pack.id), pack); store.set(key(pack.id, pack.revision), pack); store.set(catalogKey, ids); store.db.exec('COMMIT'); }
    catch (error) { store.db.exec('ROLLBACK'); throw error; }
    store.emit('event', { type: 'kie-character', data: pack }); return pack;
  };
  app.get('/api/kie/characters', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(kieCharacters(store)); });
  app.get('/api/kie/characters/status', (_req, res) => res.json({ busy: cropping > 0 || saving > 0 }));
  const save = async (raw: unknown, id?: string, revision?: number) => {
    if (closing) throw new Error('The app is closing. Try again after reconnecting.');
    const input = characterPackInputSchema.parse(raw), old = id ? store.value<KieCharacterPack | null>(key(id), null) : null;
    if (id && (!old || old.revision !== revision)) throw new Error('This character was updated elsewhere. Reopen it before saving.');
    if (!id && kieCharacters(store).length >= 200) throw new Error('This installation already has 200 saved characters.');
    saving++;
    try {
      const references = [];
      for (const reference of input.references) {
        const asset = store.asset(reference.assetId); if (!asset || asset.kind !== 'image') throw new Error('A character reference is missing. Upload it again.');
        const meta = await probe(asset.path);
        if (Math.min(meta.width, meta.height) < 240 || Math.max(meta.width, meta.height) > 8000 || Math.max(meta.width / meta.height, meta.height / meta.width) > 8 || (await stat(asset.path)).size > 20_000_000) throw new Error('Character references need sides 240–8000 pixels, aspect ratio at most 8:1 and size at most 20 MB.');
        const crop = store.value<{ crop: NonNullable<KieCharacterSnapshot['face']['crop']>; sha256: string } | null>(cropKey(asset.id), null), sha256 = await hash(asset.path);
        if (crop && crop.sha256 !== sha256) throw new Error('A cropped reference changed on disk. Crop the original sheet again.');
        references.push({ ...reference, sha256, ...(crop ? { crop: crop.crop } : {}) });
      }
      // Hashing is asynchronous: repeat CAS after it, before writing anything.
      if (id && store.value<KieCharacterPack | null>(key(id), null)?.revision !== revision) throw new Error('This character was updated elsewhere. Reopen it before saving.');
      const now = new Date().toISOString();
      return persist({ id: old?.id || randomUUID(), ...input, references, revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || now, updatedAt: now, archived: old?.archived || false });
    } finally { saving--; }
  };
  app.post('/api/kie/characters', async (req, res) => res.status(201).json(await save(req.body)));
  app.put('/api/kie/characters/:id', async (req, res) => {
    const { revision, ...input } = z.object({ revision: z.number().int().positive(), name: z.unknown(), faceId: z.unknown(), references: z.unknown() }).strict().parse(req.body);
    res.json(await save(input, idSchema.parse(req.params.id), revision));
  });
  app.patch('/api/kie/characters/:id', (req, res) => {
    const id = idSchema.parse(req.params.id), input = z.object({ revision: z.number().int().positive(), archived: z.boolean() }).strict().parse(req.body);
    const old = store.value<KieCharacterPack | null>(key(id), null); if (!old || old.revision !== input.revision) throw new Error('This character changed. Refresh before trying again.');
    res.json(persist({ ...old, archived: input.archived, revision: old.revision + 1, updatedAt: new Date().toISOString() }));
  });
  app.post('/api/kie/characters/crop', async (req, res) => {
    if (closing) throw new Error('The app is closing. Try again after reconnecting.');
    if (cropping >= 2) throw new Error('Two reference crops are already being prepared. Wait for them to finish.');
    cropping++;
    try {
    const input = z.object({ assetId: z.string().min(1).max(120), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(64).max(8000), height: z.number().int().min(64).max(8000) }).strict().parse(req.body);
    const source = store.asset(input.assetId); if (!source || source.kind !== 'image') throw new Error('Choose a readable reference sheet first.');
    const sourceSHA256 = await hash(source.path), identity = createHash('sha256').update(JSON.stringify({ ...input, sourceSHA256 })).digest('hex');
    const existing = pending.get(identity); if (existing) return void res.status(201).json(await existing);
    if (pending.size >= 2) throw new Error('Two reference crops are already being prepared. Wait for them to finish.');
    const task = (async () => {
      const meta = await probe(source.path);
      if (input.x + input.width > meta.width || input.y + input.height > meta.height || Math.max(input.width / input.height, input.height / input.width) > 8) throw new Error('Keep the crop inside the sheet and no wider than 8:1.');
      const scale = Math.max(1, 240 / Math.min(input.width, input.height)), width = Math.round(input.width * scale), height = Math.round(input.height * scale);
      if (Math.max(width, height) > 8000) throw new Error('This crop is too large. Choose a smaller view.');
      const temporary = path.join(store.root, 'uploads', `character-crop-${randomUUID()}.png`);
      try {
        await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-i', source.path, '-vf', `format=rgba,crop=${input.width}:${input.height}:${input.x}:${input.y}:exact=1,scale=${width}:${height}:flags=lanczos`, '-frames:v', '1', '-threads', '1', temporary], undefined, 30000);
        if ((await stat(temporary)).size > 20_000_000) throw new Error('This cropped PNG exceeds 20 MB. Choose a smaller panel.');
        if (await hash(source.path) !== sourceSHA256) throw new Error('The sheet changed while cropping. Try again.');
        const sha256 = await hash(temporary), asset = await ingest(store, temporary, 'image', `${source.name.replace(/\.[^.]+$/, '').slice(0, 130)} - view.png`);
        store.set(cropKey(asset.id), { crop: { sourceAssetId: source.id, sourceSHA256, x: input.x, y: input.y, width: input.width, height: input.height }, sha256 });
        return { ...asset, path: '', poster: 'ready' };
      } finally { await rm(temporary, { force: true }); }
    })();
    pending.set(identity, task); try { res.status(201).json(await task); } finally { pending.delete(identity); }
    } finally { cropping--; }
  });
  return { get busy() { return cropping > 0 || saving > 0; }, shutdown: async () => { closing = true; while (cropping > 0 || saving > 0) await new Promise(resolve => setTimeout(resolve, 10)); } };
}
