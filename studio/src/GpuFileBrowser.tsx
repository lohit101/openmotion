import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, CaretRight, File, Folder, FolderOpen, HardDrives, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { gpuFileModelId, gpuFileRestorable, gpuFileRoots, type GpuFileEntry, type GpuFileListing, type GpuFileLocation, type GpuFileRemoval } from '../shared/gpu-files';
import { modelUsage } from '../shared/downloads';
import type { ModelsState } from '../shared/models';
import { api, SmallSelect } from './components';
import { modelSize, type DownloadControls } from './ModelDownloads';
import './gpu-files.css';

export function fileRemovalMessage(listing: GpuFileListing, file: GpuFileEntry) {
  const location = { root: listing.root, path: file.path }, model = gpuFileModelId(location);
  const fullPath = listing.absolutePath.replace(/\/$/, '') + '/' + file.name;
  return `Delete ${file.name} from GPU #${listing.instanceId}?\n\n${fullPath}\n${modelSize(file.size)} on disk.\n\n` +
    (gpuFileRestorable(location) ? `Used by: ${modelUsage(model!).map(use => use.workflow).join(', ')}.\nDownload missing dependencies again with the module's Download button.\n\n` :
      'This file is outside the downloadable model catalog. Module downloads will not restore it; keep a copy if you need it later.\n\n') +
    'Only this selected GPU file will be removed. Copies already saved on your laptop stay there.';
}

export default function GpuFileBrowser({ controls, instanceId }: { controls: DownloadControls; instanceId?: number | null }) {
  const [open, setOpen] = useState(false), [root, setRoot] = useState<GpuFileLocation['root']>('models'), [folder, setFolder] = useState('');
  const [listing, setListing] = useState<GpuFileListing | null>(null), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false), [deleting, setDeleting] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState('');
  const requestNumber = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const connected = controls.online && !!instanceId;
  useEffect(() => {
    const sequence = ++requestNumber.current, abort = new AbortController();
    if (!open || !connected || !instanceId) { setListing(null); setLoading(false); return; }
    setLoading(true); setError(''); if (!offset) setListing(null);
    void fetch('/api/gpu-files/list', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, root, path: folder, offset }), signal: abort.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'The GPU folder could not be opened.');
      if (sequence !== requestNumber.current || abort.signal.aborted) return;
      const result = value as GpuFileListing;
      if (result.instanceId !== instanceId || result.root !== root || result.path !== folder) throw new Error('The GPU changed. Refresh its files.');
      setListing(previous => ({ ...result, entries: offset && previous?.instanceId === instanceId && previous.root === root && previous.path === folder ?
        [...previous.entries, ...result.entries.filter(entry => !previous.entries.some(old => old.path === entry.path))] : result.entries }));
    }).catch(error => { if (sequence === requestNumber.current && !abort.signal.aborted) setError(error.message); })
      .finally(() => { if (sequence === requestNumber.current && !abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, connected, instanceId, root, folder, offset, revision]);
  const navigate = (path: string) => { setFolder(path); setOffset(0); setQuery(''); };
  const refresh = () => { setOffset(0); setRevision(value => value + 1); };
  const remove = async (file: GpuFileEntry) => {
    if (!listing || !connected || listing.instanceId !== instanceId || controls.blocked || controls.state.busy || !file.deletable || deleting) return;
    if (!window.confirm(fileRemovalMessage(listing, file))) return;
    setDeleting(true); setError('');
    try {
      const result = await api<GpuFileRemoval & { models: ModelsState }>('/gpu-files/delete', { instanceId, root: listing.root, path: file.path, token: file.token });
      controls.updated?.(result.models);
      toast.success(result.removed ? 'GPU file deleted' : 'File was already removed', { description: `${modelSize(result.freedBytes)} removed · ${modelSize(result.freeBytes)} free on disk.` });
      if (mounted.current) refresh();
    } catch (error) {
      const message = (error as Error).message;
      toast.error('File could not be deleted', { description: message });
      if (mounted.current) setError(message);
    } finally { if (mounted.current) setDeleting(false); }
  };
  const entries = listing?.entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())) || [];
  const blocked = !connected || controls.blocked || controls.state.busy || controls.state.refreshing || deleting;
  return <section className="gpu-files" aria-label="GPU file browser">
    <button type="button" className="gpu-files-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <FolderOpen size={20} /><span><strong>Browse GPU files</strong><small>Models, uploads, outputs and temporary files</small></span><CaretRight size={15} className={open ? 'expanded' : ''} />
    </button>
    {open && <div className="gpu-files-content">
      {!connected ? <p className="downloads-offline">Connect your managed GPU and sync its inventory to browse its drive. Browsing never starts the GPU.</p> : <>
        <div className="gpu-files-toolbar"><SmallSelect label="GPU storage folder" value={root} disabled={deleting} onChange={value => { setRoot(value as GpuFileLocation['root']); navigate(''); }} options={Object.entries(gpuFileRoots).map(([value, label]) => ({ value, label }))} />
          <button type="button" className="secondary-button" disabled={loading || deleting} onClick={refresh}><ArrowClockwise size={14} />{loading ? 'Reading…' : 'Refresh folder'}</button>
          {listing && <span><HardDrives size={14} />{modelSize(listing.freeBytes)} free / {modelSize(listing.totalBytes)}</span>}
        </div>
        <nav className="gpu-files-path" aria-label="GPU folder path"><button disabled={deleting} onClick={() => navigate('')}>{gpuFileRoots[root]}</button>{folder.split('/').filter(Boolean).map((part, index, all) => <span key={index}><CaretRight size={11} /><button disabled={deleting} onClick={() => navigate(all.slice(0, index + 1).join('/'))}>{part}</button></span>)}</nav>
        {listing && <div className="gpu-files-location"><code>{listing.absolutePath}</code><span>GPU #{listing.instanceId} · Largest files first within each folder</span></div>}
        <label className="downloads-search gpu-files-search"><MagnifyingGlass size={15} /><input aria-label="Search this GPU folder" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a file in this folder" /></label>
        {deleting && <p role="status">Deleting the selected GPU file…</p>}
        {error && <p role="alert" className="model-page-error">{error}</p>}
        <div className="gpu-files-list" aria-busy={loading}>
          {entries.map(file => <div className="gpu-file" key={file.path}>
            {file.kind === 'directory' ? <button type="button" className="gpu-file-name" disabled={deleting || loading} onClick={() => navigate(file.path)}><Folder size={18} /><span>{file.name}</span><CaretRight size={13} /></button> : <div className="gpu-file-name"><File size={18} /><span>{file.name}<small>{file.kind === 'link' ? 'Linked file · browse its real location' : gpuFileRestorable({ root, path: file.path }) ? 'Can be downloaded again' : file.name.endsWith('.lock') ? 'Runtime / transfer lock' : 'Not in the download catalog'}</small></span></div>}
            <span className="gpu-file-size">{file.kind === 'file' ? modelSize(file.size) : ''}</span>
            {file.kind !== 'directory' && <button type="button" className="model-delete" aria-label={`Delete GPU file ${file.name}`} title={!file.deletable ? 'Linked files, locks and special files cannot be removed here' : blocked ? 'Finish GPU work before deleting files' : `Delete ${file.name} from this GPU`} disabled={blocked || !file.deletable || loading} onClick={() => void remove(file)}><Trash size={16} /></button>}
          </div>)}
          {!entries.length && !loading && !error && <p className="gpu-files-empty">{query ? 'No matching files in the loaded list.' : 'This folder is empty.'}</p>}
          {loading && <p className="gpu-files-empty" role="status">Reading this folder…</p>}
        </div>
        {listing && <div className="gpu-files-pagination"><span>{listing.entries.length} of {listing.total} entries loaded</span>{listing.nextOffset !== null && <button className="secondary-button" disabled={loading || deleting} onClick={() => setOffset(listing.nextOffset!)}>Load more files</button>}</div>}
        <p className="downloads-footnote">Choose a file to delete it from this GPU. Module Download buttons restore missing catalog models to the correct location. Custom files need your own copy. Folders and linked files cannot be deleted here.</p>
      </>}
    </div>}
  </section>;
}
