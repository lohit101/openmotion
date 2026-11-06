import { z } from 'zod';

export const characterRoleLabels = { face: 'Face', body: 'Body / head angle', expression: 'Expression', sheet: 'Whole reference sheet' } as const;
export const characterViewLabels = { front: 'Front', back: 'Back', left: 'Left profile', right: 'Right profile', 'three-quarter-left': '¾ left', 'three-quarter-right': '¾ right', other: 'Other / multiple angles' } as const;
export const characterExpressionLabels = { neutral: 'Neutral', smile: 'Smile', 'open-mouth': 'Open mouth', frown: 'Frown / angry', blink: 'Blink / closed eyes', other: 'Other expression' } as const;
export const characterRoleSchema = z.object({
  role: z.enum(['face', 'body', 'expression', 'sheet']), view: z.enum(['front', 'back', 'left', 'right', 'three-quarter-left', 'three-quarter-right', 'other']),
  expression: z.enum(['neutral', 'smile', 'open-mouth', 'frown', 'blink', 'other']), label: z.string().trim().max(80), format: z.enum(['single', 'sheet']),
}).strict();
export type KieCharacterRole = z.infer<typeof characterRoleSchema>;
export const characterReferenceInputSchema = characterRoleSchema.extend({ id: z.string().min(1).max(120), assetId: z.string().min(1).max(120) }).strict();
export const characterCropSchema = z.object({
  sourceAssetId: z.string().min(1).max(120), sourceSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(64).max(8000), height: z.number().int().min(64).max(8000),
}).strict();
export const characterReferenceSchema = characterReferenceInputSchema.extend({ sha256: z.string().regex(/^[a-f0-9]{64}$/), crop: characterCropSchema.optional() }).strict();
export const characterPackInputSchema = z.object({
  name: z.string().trim().min(1).max(80), faceId: z.string().min(1).max(120), references: z.array(characterReferenceInputSchema).min(1).max(32),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.references.map(r => r.id)).size !== value.references.length) ctx.addIssue({ code: 'custom', message: 'Each reference needs a unique ID.' });
  const face = value.references.find(r => r.id === value.faceId);
  if (!face || face.role !== 'face' || face.expression !== 'neutral') ctx.addIssue({ code: 'custom', path: ['faceId'], message: 'Choose a neutral face reference as the identity anchor.' });
});
export interface KieCharacterPack { id: string; name: string; faceId: string; references: KieCharacterReference[]; revision: number; createdAt: string; updatedAt: string; archived: boolean; }
export type KieCharacterReference = z.infer<typeof characterReferenceSchema>;
export type KieCharacterReferenceInput = z.infer<typeof characterReferenceInputSchema>;
export const characterSnapshotSchema = z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(80), revision: z.number().int().positive(), face: characterReferenceSchema, references: z.array(characterReferenceSchema).max(8) }).strict();
export type KieCharacterSnapshot = z.infer<typeof characterSnapshotSchema>;
export function characterSnapshot(pack: KieCharacterPack, referenceIds: string[]): KieCharacterSnapshot {
  const face = pack.references.find(r => r.id === pack.faceId);
  if (!face) throw new Error('This character needs a neutral face reference.');
  if (referenceIds.length > 8 || new Set(referenceIds).size !== referenceIds.length || referenceIds.includes(pack.faceId)) throw new Error('Choose up to eight different extra references.');
  const references = referenceIds.map(id => { const ref = pack.references.find(r => r.id === id); if (!ref) throw new Error('A selected character reference is unavailable.'); return ref; });
  return characterSnapshotSchema.parse({ id: pack.id, name: pack.name, revision: pack.revision, face, references });
}
export function characterReferenceLabel(reference: KieCharacterRole) {
  return reference.label || `${characterRoleLabels[reference.role]} · ${reference.role === 'expression' ? characterExpressionLabels[reference.expression] : characterViewLabels[reference.view]}`;
}
export function characterAdditionalReferences(snapshot: KieCharacterSnapshot) {
  return snapshot.references.map(({ assetId, role, view, expression, label, format }) => ({ assetId, view: (['front', 'back', 'left', 'right'].includes(view) ? view : 'other') as 'front' | 'back' | 'left' | 'right' | 'other', character: { role, view, expression, label, format } }));
}
