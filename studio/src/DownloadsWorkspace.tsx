import { useState } from 'react';
import { ArrowClockwise, CheckCircle, Clock, DownloadSimple, HardDrives, MagnifyingGlass, Pause, Trash, WarningCircle } from '@phosphor-icons/react';
import { deletableModelFile, downloadRows } from '../shared/downloads';
import { downloadableModelDefinitions, modelWorkingReserve } from '../shared/models';
import { moduleDownloadProgress } from '../shared/module-downloads';
import { SmallSelect } from './components';
import { DownloadButton, modelSize, type DownloadControls } from './ModelDownloads';
import './downloads.css';
import GpuFileBrowser from './GpuFileBrowser';

const checkedTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const states: Record<string, string> = { installed: 'Downloaded', unavailable: 'On disk; unavailable to ComfyUI', partial: 'Partial download', downloading: 'Downloading',reconnecting:'Reconnecting', queued: 'Queued', failed: 'Failed', missing: 'Not downloaded' };

export default function DownloadsWorkspace({ controls, required, refresh, cancel, setup }: {
  controls: DownloadControls; required: string[]; refresh: () => void; cancel: () => void; setup: () => void;
}) {
  const [location, setLocation] = useState(''), [filter, setFilter] = useState('downloaded'), [query, setQuery] = useState(''), [workflow, setWorkflow] = useState('all'), [sort, setSort] = useState('size');
  const inventories = controls.state.inventories || [];
  const liveInventory = controls.online ? inventories.find(item => item.checkedAt === controls.state.checkedAt) : undefined;
  const inventory = inventories.find(item => item.key === location) || liveInventory || inventories[0];
  const live = controls.online && (!inventory || inventory.key === liveInventory?.key);
  const rows = downloadRows(controls.state, inventory, live);
  const stored = rows.filter(file => file.onDisk > 0), active = rows.filter(file => ['queued', 'downloading','reconnecting', 'failed'].includes(file.status));
  const used = stored.reduce((total, file) => total + file.onDisk, 0), free = live ? controls.state.diskFreeBytes : inventory?.freeBytes;
  const visible = rows.filter(file => (filter === 'all' || filter === 'active' && active.includes(file) || filter === 'downloaded' && file.onDisk > 0)
    && (workflow === 'all' || file.usage.some(usage => usage.workflow === workflow))
    && `${file.label} ${file.filename} ${file.description} ${file.usage.map(usage => usage.workflow + ' ' + usage.detail).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.label.localeCompare(b.label) : (b.onDisk || b.size) - (a.onDisk || a.size));
  const moduleActive=!!controls.state.moduleSetup&&(['downloading','preparing','reconnecting'].includes(controls.state.moduleSetup.status)||!!controls.state.moduleSetup.activeRuntime);
  const fileControls = { ...controls, online: live,blocked:controls.blocked||moduleActive };
  const all=[...new Set(downloadableModelDefinitions.map(file=>file.id))],bulk=moduleDownloadProgress({module:'remotion',key:'entire-catalog',files:all,runtimes:[]},controls.state,controls.state.busy?controls.state.transferFiles:undefined);
  const insufficient=bulk.remaining>0&&controls.state.diskFreeBytes!==undefined&&bulk.remaining+modelWorkingReserve(all)>controls.state.diskFreeBytes;
  return <section className="downloads-workspace" aria-labelledby="downloads-heading">
    <header className="downloads-heading"><div><h2 id="downloads-heading">Downloads</h2><p>Your model files, what uses them and the space they take.</p></div>
      <button className="secondary-button" disabled={!controls.online || controls.state.refreshing} onClick={() => { setLocation(''); refresh(); }}><ArrowClockwise size={14} />{controls.state.refreshing ? 'Checking…' : 'Sync inventory'}</button>
    </header>
    <section className="downloads-bulk" aria-label="Download entire model catalog"><div><strong>Download all models</strong><p>All {all.length} available model files. {modelSize(bulk.remaining)} remaining. Shared files download once; module tools are prepared when requested.</p><small>Compute, transfer and storage charges apply. For a smaller setup, use the download button inside a module.</small>{insufficient&&controls.online&&<p className="model-file-error">Needs {modelSize(bulk.remaining+modelWorkingReserve(all))} free including working space.</p>}</div>
      <button className="secondary-button" disabled={!controls.online||controls.blocked||controls.state.busy||controls.state.refreshing||insufficient||bulk.missing.length===0} onClick={()=>controls.download(all)}><DownloadSimple size={16}/>{!bulk.missing.length&&controls.online?'All models installed':controls.state.busy&&!moduleActive?'Downloading · '+bulk.percent+'%':'Download all models'}</button>
    </section>
    <div className="downloads-storage">
      <HardDrives size={24} weight="light" /><div className="download-storage-total"><strong>{modelSize(used)}</strong><span>tracked model files</span></div>
      <div><strong>{stored.filter(file => file.installed).length}<small> files</small></strong><span>{stored.filter(file => file.partial > 0).length} partial downloads</span></div>
      <div><strong>{free === undefined ? 'Not checked' : modelSize(free)}</strong><span>{live ? 'free on disk' : 'free at last check'}</span></div>
    </div>
    <div className="downloads-location">
      <div className="downloads-snapshot"><span className={`download-inventory-state ${live ? 'live' : ''}`}>{live ? <CheckCircle size={14} /> : <Clock size={14} />}{live ? 'Connected GPU' : 'Saved inventory'}</span>
        <span>{inventory ? `${inventory.gpu || 'GPU'}${inventory.instanceId ? ` · Instance #${inventory.instanceId}` : ''} · Checked ${checkedTime(inventory.checkedAt)}` : controls.online ? 'Sync to save a storage inventory.' : 'Connect a GPU once to record its files.'}</span>
      </div>
      {inventories.length > 1 && <SmallSelect label="Inventory location" value={inventory?.key || ''} onChange={setLocation} options={inventories.map(item => ({ value: item.key, label: `${item.gpu || 'GPU'} · ${item.instanceId ? '#' + item.instanceId : item.endpoint}` }))} />}
    </div>
    {!live && <p className="downloads-offline">{inventory ? 'This is the last recorded inventory, not a live disk check. Files are kept on that rental; destroying its disk removes them.' : 'Your GPU can stay offline while you browse available files.'} <button onClick={setup}>Open GPU cloud</button></p>}
    <GpuFileBrowser controls={controls} instanceId={liveInventory?.instanceId} />
    {controls.state.error && <p className="model-page-error" role="alert"><WarningCircle size={16} />{controls.state.error}</p>}
    {controls.state.busy && <div className="model-download-notice" role="status"><span>{controls.state.deleting ? 'Deleting the selected file…' : moduleActive ? controls.state.moduleSetup?.message : 'Downloading your selected files. Progress comes from the transfer.'}</span>{!controls.state.deleting&&!controls.state.moduleSetup?.activeRuntime && <button className="secondary-button" onClick={cancel}><Pause size={13} />Cancel downloads</button>}</div>}
    <div className="downloads-tools"><div className="downloads-filters" role="group" aria-label="Download status">
      {[['downloaded', 'On disk', stored.length], ['active', 'Transfers', active.length], ['all', 'All files', rows.length]].map(([id, label, count]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(String(id))}>{label}<span>{count}</span></button>)}
    </div><label className="downloads-search"><MagnifyingGlass size={15} /><input aria-label="Search downloads" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files or features" /></label></div>
    <div className="downloads-filter-row"><SmallSelect label="Filter downloads by workflow" value={workflow} onChange={setWorkflow} options={[{ value: 'all', label: 'All workflows' }, ...['Viggle video', 'Remotion facial consistency', 'GPU face refinement', 'Qwen images', 'Klein images','Clarity', 'Custom LoRA', ...(rows.some(file => file.retired) ? ['Retired files'] : [])].map(value => ({ value, label: value }))]} />
      <SmallSelect label="Sort downloads" value={sort} onChange={setSort} options={[{ value: 'size', label: 'Largest files first' }, { value: 'name', label: 'Name A–Z' }]} /><span>{visible.length} {visible.length === 1 ? 'file' : 'files'}</span></div>
    {visible.length ? <div className="downloads-table-scroll"><table className="downloads-table"><thead><tr><th>File</th><th>Used by</th><th>Storage</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(file => <tr key={file.id}>
      <td><strong>{file.label}</strong><span className="download-file-name" title={file.id}>{file.filename}</span>{file.retired ? <span className="download-retired">Retired · stored files only</span> : live && required.includes(file.id) && <span className="download-selected">In current settings</span>}
        <details className="download-file-details"><summary>File details</summary><p>{file.description}</p><code>{file.id}</code>{file.size > 0 && <p>Expected full file: {modelSize(file.size)}{file.onDisk > 0 && !file.measured ? '. Recorded size uses the model manifest.' : ''}</p>}</details>
      </td><td>{file.usage.map(usage => <div className="download-usage" key={usage.workflow}><strong>{usage.workflow}</strong><span>{usage.detail}</span></div>)}</td>
      <td className="download-storage-cell"><strong>{modelSize(file.onDisk || file.size)}</strong><span>{file.partial > 0 ? `${modelSize(file.partial)} partial` : file.onDisk > 0 ? 'on disk' : 'download size'}</span></td>
      <td><span className={`download-file-status ${file.status}`}>{states[file.status]}</span>{file.status === 'downloading' && <div className="download-transfer"><progress aria-label={`${file.label} download progress`} max={100} value={file.progress?.percent ?? undefined} /><span>{file.progress?.percent == null ? 'Connecting / verifying' : `${file.progress.percent}%`}{file.progress?.bytesPerSecond ? ` · ${modelSize(file.progress.bytesPerSecond)}/s` : ''}</span></div>}{file.progress?.error && <p className="model-file-error" role="alert">{file.progress.error}</p>}</td>
      <td><div className="download-row-actions">{downloadableModelDefinitions.some(item => item.id === file.id) && <DownloadButton files={[file.id]} controls={fileControls} label={file.label} />}
        {deletableModelFile(file.id) && file.onDisk > 0 && <button className="model-delete" disabled={!live || controls.blocked || controls.state.busy || controls.state.refreshing} aria-label={`Delete ${file.label} from GPU`} title={!live ? 'Connect this GPU to delete its files' : controls.blocked || controls.state.busy ? 'Finish setup, downloads or rendering before deleting files' : `Delete ${file.label} · ${modelSize(file.onDisk)}`} onClick={() => controls.remove(file.id)}><Trash size={16} /></button>}
      </div></td>
    </tr>)}</tbody></table></div> : <div className="downloads-empty"><DownloadSimple size={30} weight="light" /><h3>{query || workflow !== 'all' ? 'No matching files' : filter === 'active' ? 'No transfers to show' : 'No downloaded files recorded'}</h3><p>{query || workflow !== 'all' ? 'Try another search or workflow.' : filter === 'active' ? 'Active downloads and failures appear here.' : 'Browse the available models, or connect your GPU and sync its inventory.'}</p>{filter !== 'all' && <button className="secondary-button" onClick={() => { setFilter('all'); setWorkflow('all'); setQuery(''); }}>Browse all files</button>}</div>}
    <p className="downloads-footnote">Delete model files or partial downloads to free space on the connected GPU. The Used by column shows which workflows will need those files downloaded again. Your saved photos and videos are kept. Shared files are counted once.</p>
  </section>;
}
