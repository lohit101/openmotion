import type { Asset } from '../shared/types';
import type { Dispatch, SetStateAction } from 'react';
import { kieViewLabels, type KieAdditionalReference } from '../shared/kie';
import { AssetDrop, SmallSelect } from './components';
import { EditorDisclosure } from './EditorControls';

export default function KieAdditionalReferences({ references, assets, hasFace, change, added, error }: {
  references: KieAdditionalReference[]; assets: Asset[]; hasFace: boolean; change: Dispatch<SetStateAction<KieAdditionalReference[]>>; added: (asset: Asset) => void; error: (message: string) => void;
}) {
  const slots = [...references, ...(references.length < 8 ? [null] : [])];
  return <EditorDisclosure title="More character views" meta={references.length ? `${references.length} added` : 'Optional'} help="Add back, profile or other views of the same character. Image1 keeps priority for the outfit and scene; the separate face reference keeps priority for facial identity. Extra angles can help the model interpret turns, but do not guarantee tracking or perfect consistency."><div className="kie-additional-references">{slots.map((reference, index) => {
    const imageNumber = index + (hasFace ? 3 : 2), asset = reference ? assets.find(item => item.id === reference.assetId) : undefined;
    const locate = (current: KieAdditionalReference[]) => reference ? current[index]?.assetId === reference.assetId ? index : current.findIndex(item => item.assetId === reference.assetId) : current.length;
    return <div className="kie-additional-reference" key={index}><AssetDrop kind="image" asset={asset} label={`Image${imageNumber} · ${reference ? kieViewLabels[reference.view] : 'Extra view'}`} emptyLabel="Add a character view" onError={error} onAsset={value => { if (value) added(value); change(current => { const at = locate(current); if (at < 0 || at >= 8) return current; const next = [...current]; if (value) next[at] = { assetId: value.id, view: current[at]?.view || reference?.view || 'other' }; else if (reference) next.splice(at, 1); return next; }); }} />{reference && <div className="kie-reference-view"><span>View in Image{imageNumber}</span><SmallSelect label={`View in Image${imageNumber}`} value={reference.view} onChange={value => change(current => current.map((item, at) => at === locate(current) ? { ...item, view: value as KieAdditionalReference['view'] } : item))} options={Object.entries(kieViewLabels).map(([value, label]) => ({ value, label }))} /></div>}</div>;
  })}</div><p className="kie-reference-limit">{references.length} of 8 extra views · up to 10 images including the main and facial references</p></EditorDisclosure>;
}
