import type { Asset } from '../shared/types';
import { kiePrompt, kieViewLabels, type KieDraft } from '../shared/kie';
import { characterReferenceLabel } from '../shared/kie-characters';
import { EditorDisclosure } from './EditorControls';

export default function KieInputPreview({ draft, assets }: { draft: KieDraft; assets: Asset[] }) {
  const images = [{ id: draft.referenceId, label: 'Image1 · Character, outfit & scene' }, ...(draft.faceReferenceId ? [{ id: draft.faceReferenceId, label: 'Image2 · Facial identity' }] : []), ...(draft.additionalReferences || []).map((ref, index) => ({ id: ref.assetId, label: `Image${index + (draft.faceReferenceId ? 3 : 2)} · ${ref.character ? characterReferenceLabel(ref.character) : kieViewLabels[ref.view]}` }))];
  return <EditorDisclosure title="Review inputs & prompt" meta={`${images.filter(i => i.id).length}/10 images`} help="This is the exact image order and complete prompt used for a new generation. Files are uploaded only when you press Generate."><div className="kie-input-preview-grid">{images.map(({ id, label }) => { const asset = assets.find(a => a.id === id); return <figure key={label}>{asset ? <img src={`/api/assets/${asset.id}/poster`} alt={label} /> : <span className="kie-character-note">{id ? 'Image unavailable' : 'Not selected'}</span>}<figcaption>{label}</figcaption></figure>; })}</div><p className="kie-character-note">Video1 · Motion, gaze, expressions and lip timing · {draft.start.toFixed(2)}–{(draft.start + draft.seconds).toFixed(2)}s</p><details className="kie-base-prompt"><summary>Complete prompt</summary><p>{kiePrompt(draft.prompt, !!draft.faceReferenceId, draft.additionalReferences, draft.characterPack)}</p></details></EditorDisclosure>;
}
