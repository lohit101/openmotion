import { ArrowRight, ImageSquare } from '@phosphor-icons/react';
import type { Bootstrap, Draft, Settings } from '../shared/types';
import { FieldLabel } from './InfoTip';
import { Toggle } from './components';
import CharacterPicker from './CharacterPicker';
import { ReferenceViewImage } from './ReferenceViewPicker';

export default function RemotionCharacterRefresh({ data, draft, update, manage, prepare, preparing }: {
  data: Bootstrap; draft: Draft; update: (change: Partial<Settings>) => void; manage: () => void; prepare: () => void; preparing: boolean;
}) {
  const s = draft.settings, profile = s.imagenRepaint, photo = profile?.sourceImageJobId ? data.jobs.find(j => j.id === profile.sourceImageJobId) : null;
  const locked = photo?.image?.character;
  const source = data.assets.find(a => a.id === photo?.sourceId)?.sourceFrame;
  const mismatch = !!(locked && source && (source.videoId !== draft.sourceId || Math.abs(source.time - s.start) > 1 / 48));
  return <section className="segment-refresh-controls"><FieldLabel label="Character consistency" help="The starting segment uses your edited frame. Before each additional segment, Imagen refreshes the visible face in the previous segment’s exact last raw frame. Each repaint is saved. Body and motion anchors stay intact. An unclear or hidden face is carried forward with a recorded warning." />
    <Toggle disabled={!data.capabilities?.imagenSegmentRepaint} label="Refresh face between segments" checked={s.imagenRepaintEnabled} onChange={value => update({ imagenRepaintEnabled: value, ...(value ? { referencePreparation: 'prepared', viggleReferenceMode: 'previous' } : {}) })} detail={data.capabilities?.imagenSegmentRepaint ? 'Uses the accepted Imagen preset · one extra image edit per visible-face boundary' : 'Waiting for the local app update to finish'} />
    {s.imagenRepaintEnabled && <>{locked && profile ? <div className="segment-refresh-locked"><div className="segment-refresh-thumbs">{([['body', locked.bodyId, profile.bodyView], ['face', locked.faceId, profile.faceView]] as const).map(([kind, id, view]) => { const asset = data.assets.find(a => a.id === id); return asset && <ReferenceViewImage key={kind} asset={asset} view={view} alt={`${locked.name} frozen ${kind} view`} thumbnail />; })}</div><div><strong>{locked.name}</strong><span>References saved with your starting photo</span></div><button onClick={() => update({ imagenRepaint: { ...profile, sourceImageJobId: null } })}>Change</button></div>
      : <CharacterPicker characters={data.characters || []} assets={data.assets} id={profile?.characterId || null} revision={profile?.revision || null} bodyView={profile?.bodyView || null} faceView={profile?.faceView || null}
          choose={c => update({ imagenRepaint: { characterId: c.id, revision: c.revision, bodyView: c.bodyView, faceView: c.faceView, sourceImageJobId: null } })}
          changeView={(kind, view) => { if (profile) update({ imagenRepaint: { ...profile, [kind === 'body' ? 'bodyView' : 'faceView']: view, sourceImageJobId: null } }); }} manage={manage} />}
      {mismatch && <p className="image-review-warning">The starting photo belongs to a different video or clip start. Prepare a matching frame.</p>}
      <button type="button" className="segment-prepare-button" disabled={preparing || !draft.sourceId || !profile?.bodyView || !profile.faceView} onClick={prepare}><ImageSquare size={16} />{preparing ? 'Opening frame…' : 'Prepare starting frame in Imagen'}<ArrowRight size={15} /></button>
    </>}
  </section>;
}
