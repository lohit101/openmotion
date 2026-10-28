import { z } from 'zod';
import { imageReferenceViewSchema, sourceFrameImageSettings, type ImageDraft, type ImageReferenceView } from './image-replacement';

export const characterInputSchema = z.object({
  name: z.string().trim().min(1).max(80), bodyId: z.string().min(1), faceId: z.string().min(1),
  bodyView: imageReferenceViewSchema.nullable().default(null), faceView: imageReferenceViewSchema.nullable().default(null),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;
export interface Character extends CharacterInput { id: string; revision: number; createdAt: string; updatedAt: string; archived: boolean; }
export interface CharacterSnapshot { id: string; name: string; revision: number; bodyId: string; faceId: string; bodyView: ImageReferenceView | null; faceView: ImageReferenceView | null; }
export function snapshotCharacter(character: Character, bodyView = character.bodyView, faceView = character.faceView): CharacterSnapshot {
  return structuredClone({ id: character.id, name: character.name, revision: character.revision, bodyId: character.bodyId, faceId: character.faceId, bodyView, faceView });
}
export function useCharacterDraft(draft: ImageDraft, character: Character): ImageDraft {
  return { ...draft, referenceMode: 'character', characterId: character.id, characterRevision: character.revision,
    referenceId: character.bodyId, faceId: character.faceId,
    settings: { ...sourceFrameImageSettings(), bodyReferenceView: character.bodyView ? { ...character.bodyView } : null, faceReferenceView: character.faceView ? { ...character.faceView } : null } };
}
