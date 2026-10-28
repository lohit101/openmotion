import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store';
import { characterInputSchema, snapshotCharacter, type Character, type CharacterSnapshot } from '../shared/characters';
import { referenceViewIssue, type ImageDraft } from '../shared/image-replacement';

export function characterForImage(store: Store, draft: ImageDraft): CharacterSnapshot | undefined {
  if (draft.referenceMode !== 'character') return;
  const c = draft.characterId && store.character(draft.characterId);
  if (!c || c.archived) throw new Error('Choose an available character from Characters.');
  if (draft.characterRevision !== c.revision || draft.referenceId !== c.bodyId || draft.faceId !== c.faceId) throw new Error('This character changed. Select it again to review the current sheets before generating.');
  if (!draft.settings.bodyReferenceView || !draft.settings.faceReferenceView) throw new Error('Choose one body view and one facial view from your character sheets.');
  for (const [view, id] of [[draft.settings.bodyReferenceView, c.bodyId], [draft.settings.faceReferenceView, c.faceId]] as const) {
    const issue = referenceViewIssue(view, store.asset(id)); if (issue) throw new Error(issue);
  }
  return snapshotCharacter(c, draft.settings.bodyReferenceView, draft.settings.faceReferenceView);
}

export function registerCharacterRoutes(app: Express, store: Store) {
  const validate = (value: ReturnType<typeof characterInputSchema.parse>) => {
    for (const [view, id] of [[value.bodyView, value.bodyId], [value.faceView, value.faceId]] as const) {
      const asset = store.asset(id); if (!asset || asset.kind !== 'image' || asset.maskFor) throw new Error('Upload a body sheet and facial sheet as image references.');
      const issue = referenceViewIssue(view, asset); if (issue) throw new Error(issue);
    }
    if (value.bodyId === value.faceId) throw new Error('Use separate body and facial reference sheets.');
  };
  app.get('/api/characters', (_req, res) => res.json(store.characters()));
  app.post('/api/characters', (req, res) => {
    const value = characterInputSchema.parse(req.body); validate(value);
    const now = new Date().toISOString(), character: Character = { ...value, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, archived: false };
    store.saveCharacter(character); res.status(201).json(character);
  });
  app.patch('/api/characters/:id', (req, res) => {
    const previous = store.character(String(req.params.id)); if (!previous) return void res.status(404).json({ error: 'Character not found.' });
    const patch = characterInputSchema.partial().extend({ revision: z.number().int().positive(), archived: z.boolean().optional() }).parse(req.body);
    if (patch.revision !== previous.revision) return void res.status(409).json({ error: 'This character was updated elsewhere. Reopen it before saving.' });
    const value = characterInputSchema.parse({ ...previous, ...patch }); validate(value);
    const character = { ...previous, ...value, archived: patch.archived ?? previous.archived, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    store.saveCharacter(character); res.json(character);
  });
}
