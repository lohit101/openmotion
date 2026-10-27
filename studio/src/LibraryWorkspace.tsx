import { useMemo, useState } from 'react';
import { FilmStrip, Heart, Image as ImageIcon, MagnifyingGlass, Plus, SquaresFour, Trash, X } from '@phosphor-icons/react';
import type { Asset, Job } from '../shared/types';
import { libraryJobs, type LibraryCollection, type LibraryMedia, type LibrarySort } from '../shared/library';
import JobCard from './JobCard';
import RunDetailsDialog from './RunDetailsDialog';
import { SmallSelect } from './components';
import './library.css';

export default function LibraryWorkspace({ jobs, assets, patch, reuse, create, openWorkspace, editVideo }: {
  jobs: Job[]; assets: Asset[]; patch: (job: Job, changes: Partial<Job>) => Promise<void>;
  reuse: (job: Job) => void; editVideo: (job: Job) => void; create: () => void; openWorkspace: (job: Job) => void;
}) {
  const [collection, setCollection] = useState<LibraryCollection>('all');
  const [media, setMedia] = useState<LibraryMedia>('all'), [search, setSearch] = useState(''), [sort, setSort] = useState<LibrarySort>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = useMemo(() => libraryJobs(jobs, collection, media, search, sort), [jobs, collection, media, search, sort]);
  const selected = jobs.find(job => job.id === selectedId);
  const index = visible.findIndex(job => job.id === selectedId);
  const counts = (value: LibraryCollection) => libraryJobs(jobs, value, 'all', '', 'newest').length;
  return <main className="library library-workspace">
    <header className="library-heading"><div><h1>My library</h1><p>Your images, videos and the settings behind them.</p></div><button className="secondary-button" onClick={create}><Plus size={16} />New creation</button></header>
    <div className="library-collections" role="tablist" aria-label="Library collection">
      {([{ id: 'all', label: 'Library', Icon: SquaresFour }, { id: 'favorites', label: 'Favourites', Icon: Heart }, { id: 'trash', label: 'Trash', Icon: Trash }] as const).map(({ id, label, Icon }) => <button key={id} role="tab" aria-selected={collection === id} onClick={() => setCollection(id)}><Icon size={17} weight={collection === id ? 'fill' : 'regular'} />{label}<span>{counts(id)}</span></button>)}
    </div>
    <section className="library-browser" aria-label={collection === 'favorites' ? 'Favourite creations' : collection === 'trash' ? 'Trashed creations' : 'All creations'}>
      <div className="library-browser-toolbar"><div className="library-media-tabs" role="group" aria-label="Media type">
        {([{ id: 'all', label: 'All media', Icon: SquaresFour }, { id: 'image', label: 'Photos', Icon: ImageIcon }, { id: 'video', label: 'Videos', Icon: FilmStrip }] as const).map(({ id, label, Icon }) => <button key={id} aria-pressed={media === id} onClick={() => setMedia(id)}><Icon size={15} />{label}</button>)}
      </div><div className="library-search-sort"><label className="search-field"><MagnifyingGlass size={16} /><input aria-label="Search library" placeholder="Search titles or prompts" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</label><SmallSelect label="Sort library" value={sort} onChange={value => setSort(value as LibrarySort)} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'name', label: 'Name A–Z' }, { value: 'fastest', label: 'Shortest run time' }, { value: 'slowest', label: 'Longest run time' }]} /></div></div>
      <p className="library-result-count" aria-live="polite">{visible.length} {visible.length === 1 ? 'creation' : 'creations'}{collection === 'favorites' ? ' in favourites' : collection === 'trash' ? ' in trash' : ''}</p>
      <div className="library-grid">{visible.map(job => <JobCard key={job.id} job={job} onSelect={() => setSelectedId(job.id)} onPatch={changes => void patch(job, changes)} onReuse={() => reuse(job)} />)}</div>
      {!visible.length && <div className="library-empty">{collection === 'favorites' ? <Heart size={34} weight="light" /> : media === 'image' ? <ImageIcon size={34} weight="light" /> : media === 'video' ? <FilmStrip size={34} weight="light" /> : <SquaresFour size={34} weight="light" />}<h2>{search ? 'No matching creations' : collection === 'favorites' ? 'Your favourites, all together' : collection === 'trash' ? 'Nothing in trash' : 'A place for every take'}</h2><p>{search ? 'Try another title or prompt, or change the media filter.' : collection === 'favorites' ? 'Use the heart on a creation to keep it here.' : 'Saved photos and videos appear here, even when the GPU is offline.'}</p>{(search || media !== 'all') && <button className="secondary-button" onClick={() => { setSearch(''); setMedia('all'); }}>Clear filters</button>}</div>}
    </section>
    {selected && <RunDetailsDialog job={selected} editVideo={() => { editVideo(selected); setSelectedId(null); }} jobs={jobs} assets={assets} open close={() => setSelectedId(null)} patch={changes => patch(selected, changes)} reuse={() => { reuse(selected); setSelectedId(null); }} openWorkspace={() => { openWorkspace(selected); setSelectedId(null); }} previous={index > 0 ? () => setSelectedId(visible[index - 1].id) : undefined} next={index >= 0 && index < visible.length - 1 ? () => setSelectedId(visible[index + 1].id) : undefined} position={index >= 0 ? `${index + 1} / ${visible.length}` : undefined} />}
  </main>;
}
