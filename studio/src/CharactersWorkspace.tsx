import { useState } from 'react';
import { Archive, ArrowRight, PencilSimple, Plus, UserFocus, UsersThree } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Asset } from '../shared/types';
import { characterInputSchema, type Character, type CharacterInput } from '../shared/characters';
import { api, AssetDrop, Modal } from './components';
import { ReferenceViewControl, ReferenceViewImage } from './ReferenceViewPicker';
import './characters.css';

const empty = (): CharacterInput => ({ name: '', bodyId: '', faceId: '', bodyView: null, faceView: null });
export default function CharactersWorkspace({ characters, assets, assetAdded, saved, use, error }: {
  characters: Character[]; assets: Asset[]; assetAdded: (asset: Asset) => void; saved: (character: Character) => void; use: (character: Character) => void; error: (message: string) => void;
}) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState<Character | null>(null), [value, setValue] = useState<CharacterInput>(empty), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const body = assets.find(a => a.id === value.bodyId), face = assets.find(a => a.id === value.faceId);
  const begin = (c: Character | null) => { setEditing(c); setValue(c ? { name: c.name, bodyId: c.bodyId, faceId: c.faceId, bodyView: c.bodyView, faceView: c.faceView } : empty()); setOpen(true); };
  const save = async () => {
    if (busy) return; const parsed = characterInputSchema.safeParse(value); if (!parsed.success) return;
    setBusy(true); try {
      const c = await api<Character>(editing ? `/characters/${editing.id}` : '/characters', { ...parsed.data, ...(editing ? { revision: editing.revision } : {}) }, editing ? 'PATCH' : 'POST');
      saved(c); setOpen(false); toast.success(editing ? 'Character updated' : 'Character saved', { description: 'Your sheets and selected views stay available without a GPU.' });
    } catch (e) { error((e as Error).message); } finally { setBusy(false); }
  };
  const archive = async (c: Character) => {
    try { saved(await api<Character>(`/characters/${c.id}`, { revision: c.revision, archived: !c.archived }, 'PATCH')); toast.success(c.archived ? 'Character restored' : 'Character archived', { description: 'Existing creations keep their saved references.' }); }
    catch (e) { error((e as Error).message); }
  };
  const list = characters.filter(c => c.archived === archived && c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <main className="characters-workspace"><header className="characters-heading"><div><span className="workspace-overline">YOUR CAST</span><h1>Characters</h1><p>One identity. Ready for your next scene.</p></div><button className="primary-button compact" onClick={() => begin(null)}><Plus size={17} />New character</button></header>
    <div className="characters-toolbar"><input type="search" aria-label="Search characters" placeholder="Search your characters" value={search} onChange={e => setSearch(e.target.value)} /><button className={`secondary-button ${archived ? 'active' : ''}`} onClick={() => setArchived(!archived)}><Archive size={16} />{archived ? 'Show active' : 'Archived'}</button><span>{list.length} {list.length === 1 ? 'character' : 'characters'}</span></div>
    {list.length ? <div className="character-grid">{list.map(c => { const b = assets.find(a => a.id === c.bodyId), f = assets.find(a => a.id === c.faceId); return <article className="character-card" key={c.id}>
      <div className="character-cover"><div>{b && <ReferenceViewImage asset={b} view={c.bodyView} alt={`${c.name} body reference`} />}</div><div>{f && <ReferenceViewImage asset={f} view={c.faceView} alt={`${c.name} facial reference`} />}</div></div>
      <div className="character-card-content"><div><h2>{c.name}</h2><span>{c.bodyView && c.faceView ? 'Body & face views saved' : 'Sheets saved · choose views in Imagen'}</span></div><button className="icon-button" aria-label={`Edit ${c.name}`} title="Edit character" onClick={() => begin(c)}><PencilSimple size={17} /></button></div>
      <footer><button className="secondary-button" onClick={() => void archive(c)}><Archive size={15} />{c.archived ? 'Restore' : 'Archive'}</button>{!c.archived && <button className="character-use" onClick={() => use(c)}>Use in Imagen<ArrowRight size={17} /></button>}</footer></article>; })}</div> : <div className="characters-empty"><UsersThree size={48} weight="light" /><h2>{search ? 'No matching characters' : archived ? 'No archived characters' : 'Build your cast'}</h2><p>Save a body sheet and a facial sheet, then choose the best views for each edit.</p>{!search && !archived && <button className="secondary-button" onClick={() => begin(null)}><Plus size={16} />Add your first character</button>}</div>}
    <Modal open={open} onOpenChange={v => { if (!busy) setOpen(v); }} title={editing ? 'Edit character' : 'New character'} description="Save two reference sheets. You can choose default views now and adjust them for each image later." wide>
      <div className="character-form"><label className="full-label">Character name<input autoComplete="off" value={value.name} maxLength={80} placeholder="Give your character a name" onChange={e => setValue(v => ({ ...v, name: e.target.value }))} /></label>
      <div className="character-sheet-inputs">{(['body', 'face'] as const).map(kind => <section key={kind}><AssetDrop kind="image" label={kind === 'body' ? 'Body sheet' : 'Facial sheet'} emptyLabel={kind === 'body' ? 'Upload body references' : 'Upload face references'} asset={kind === 'body' ? body : face} onError={error} onAsset={a => { if (a) assetAdded(a); setValue(v => ({ ...v, [kind + 'Id']: a?.id || '', [kind + 'View']: null })); }} /><ReferenceViewControl kind={kind} asset={kind === 'body' ? body : face} view={kind === 'body' ? value.bodyView : value.faceView} change={view => setValue(v => ({ ...v, [kind + 'View']: view }))} /></section>)}</div>
      <div className="character-form-footer"><span><UserFocus size={16} />Original sheets stay intact when you choose a view.</span><button className="primary-button compact" disabled={busy || !characterInputSchema.safeParse(value).success || value.bodyId === value.faceId} onClick={() => void save()}>{busy ? 'Saving…' : 'Save character'}</button></div></div>
    </Modal></main>;
}
