import type { Asset } from '../shared/types';
import type { Character } from '../shared/characters';
import type { ImageReferenceView } from '../shared/image-replacement';
import { SmallSelect } from './components';
import { ReferenceViewControl } from './ReferenceViewPicker';

export default function CharacterPicker({ characters, assets, id, revision, bodyView, faceView, choose, changeView, manage }: {
  characters: Character[]; assets: Asset[]; id: string | null; revision: number | null; bodyView: ImageReferenceView | null; faceView: ImageReferenceView | null;
  choose: (character: Character) => void; changeView: (kind: 'body' | 'face', view: ImageReferenceView | null) => void; manage: () => void;
}) {
  const selected = characters.find(c => c.id === id), available = characters.filter(c => !c.archived), changed = selected && selected.revision !== revision;
  return <div className="character-picker"><SmallSelect label="Saved character" value={id || '__choose_character__'} onChange={id => { const c = available.find(c => c.id === id); if (c) choose(c); }} options={[{ value: '__choose_character__', label: 'Choose a character', disabled: true }, ...available.map(c => ({ value: c.id, label: c.name })), ...(selected?.archived ? [{ value: selected.id, label: selected.name + ' · archived', disabled: true }] : [])]} />
    <div className="character-selection-actions"><span>{selected ? `${selected.name} · ${changed ? 'updated' : 'saved references'}` : available.length ? 'Use the same identity across your scenes.' : 'No characters yet.'}</span><button onClick={manage}>{available.length ? 'Manage characters' : 'Create a character'}</button></div>
    {selected && !selected.archived && <><div className="character-selected-sheets">{(['body', 'face'] as const).map(kind => { const asset = assets.find(a => a.id === (kind === 'body' ? selected.bodyId : selected.faceId)); return <div key={kind}><div className="character-picker-preview">{asset && <img src={`/api/assets/${asset.id}/poster`} alt={`${selected.name} ${kind} sheet`} />}</div><ReferenceViewControl asset={asset} kind={kind} view={kind === 'body' ? bodyView : faceView} change={view => changeView(kind, view)} /></div>; })}</div>{changed && <p className="image-review-warning">The character was updated. <button onClick={() => choose(selected)}>Reload sheets and views</button></p>}</>}
    {selected?.archived && <p className="image-review-warning">This character is archived. Choose another or restore it in Characters.</p>}
  </div>;
}
