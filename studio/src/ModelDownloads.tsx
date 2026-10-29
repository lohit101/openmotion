import { useEffect, useRef } from 'react';
import { ArrowClockwise, ArrowSquareOut, CaretDown, Check, CheckCircle, DownloadSimple, HardDrives, Pause, Trash, WarningCircle } from '@phosphor-icons/react';
import { modelDefinitions, modelWorkingReserve, type ModelsState } from '../shared/models';
import './models.css';
import { InfoTip } from './InfoTip';

export interface DownloadControls { state: ModelsState; online: boolean; blocked: boolean; settingUp?: boolean; download: (files: string[]) => void; remove: (name: string) => void; }
export const modelSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`;
const missingBytes = (files: string[], state: ModelsState) => modelDefinitions.filter(file => files.includes(file.id) && state.files.find(item => item.id === file.id)?.status !== 'installed').reduce((sum, file) => sum + file.size - Math.min(file.size, Math.max(0, state.files.find(item => item.id === file.id)?.downloaded || 0)), 0);
export function DownloadButton({ files, controls, label, size = false }: { files: string[]; controls: DownloadControls; label: string; size?: boolean }) {
  if (!files.length) return null;
  const needed = files.filter(id => controls.state.files.find(file => file.id === id)?.status !== 'installed');
  const states = needed.map(id => controls.state.files.find(file => file.id === id));
  const active = states.some(file => ['downloading', 'queued'].includes(file?.status || ''));
  const failed = states.some(file => file?.status === 'failed');
  const percent = states.find(file => file?.status === 'downloading')?.percent;
  const bytes = missingBytes(needed, controls.state);
  const storageShort = !active && bytes > 0 && controls.state.diskFreeBytes !== undefined && bytes + modelWorkingReserve(files) > controls.state.diskFreeBytes;
  const ready = !needed.length;
  const title = ready ? files.length ? `${label}: installed` : `${label}: no extra file needed` : controls.settingUp ? `Finish GPU setup before downloading ${label}` : !controls.online ? `Connect GPU to download ${label}` : active ? `${label}: download in progress` : storageShort ? `Need ${modelSize(bytes + modelWorkingReserve(files))} free including working space; ${modelSize(controls.state.diskFreeBytes!)} available` : `${failed ? 'Retry' : 'Download'} ${label} · ${modelSize(bytes)}`;
  return <button type="button" className={`model-download ${ready ? 'installed' : active ? 'transferring' : failed ? 'failed' : ''}`}
    disabled={ready || active || storageShort || !controls.online || controls.blocked || controls.state.refreshing || !!controls.state.deleting} title={title} aria-label={title}
    onClick={event => { event.stopPropagation(); controls.download(needed); }}>
    {ready ? <CheckCircle size={15} /> : failed ? <ArrowClockwise size={15} /> : <DownloadSimple size={15} className={active ? 'downloading-icon' : ''} />}
    {size && <span>{ready ? 'Installed' : active ? percent !== null && percent !== undefined ? `${percent}%` : 'Queued' : modelSize(bytes)}</span>}
  </button>;
}

export function DownloadSelect({ value, options, onChange, label, controls }: { value: string; options: { value: string; label: string; files: string[]; disabled?: boolean; disabledReason?: string }[];
  onChange: (value: string) => void; label: string; controls: DownloadControls }) {
  const details = useRef<HTMLDetailsElement>(null);
  const selected = options.find(option => option.value === value);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!details.current?.parentElement?.contains(event.target as Node) && details.current) details.current.open = false; };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <div className="download-select"><details ref={details} onKeyDown={event => { if (event.key === 'Escape' && details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label={label}><span>{selected?.label || value}</span><CaretDown size={12} /></summary>
    <div className="download-options" aria-label={`${label} options`}>{options.map(option => <div className="download-option" key={option.value}>
      <button type="button" aria-pressed={value === option.value} disabled={option.disabled} title={option.disabledReason} className="download-option-choice" onClick={() => { if (option.disabled) return; onChange(option.value); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}>
        <span>{option.label}</span>{value === option.value && <Check size={12} />}
      </button><DownloadButton files={option.files} controls={controls} label={option.label} size />
    </div>)}</div></details>{selected ? <DownloadButton files={selected.files} controls={controls} label={selected.label} /> : <span className="model-download failed" title="Upload this custom LoRA to the connected GPU, or choose None" aria-label="Custom LoRA is missing"><WarningCircle size={15} /></span>}
  </div>;
}

export function RequiredFiles({ files, controls, manage, setup }: { files: string[]; controls: DownloadControls; manage?: () => void; setup: () => void }) {
  const ready = files.filter(id => controls.state.files.find(file => file.id === id)?.status === 'installed').length;
  const bytes = missingBytes(files, controls.state);
  const shortage = bytes > 0 && controls.state.diskFreeBytes !== undefined && bytes + modelWorkingReserve(files) > controls.state.diskFreeBytes;
  return <div className="required-models"><details className="required-file-details"><summary><HardDrives size={16} /><span className="required-models-title">Model files</span><span className={`required-models-status ${ready === files.length && controls.online ? 'ready' : ''}`}>{ready === files.length && controls.online && <CheckCircle size={13} />}{controls.online ? `${ready} / ${files.length} ready` : 'GPU offline'}</span><CaretDown className="required-models-caret" size={14} /></summary><div className="required-file-list">{modelDefinitions.filter(file => files.includes(file.id)).map(file => <div className="required-file-row" key={file.id}><span>{file.label}<small>{modelSize(file.size)}</small></span><DownloadButton files={[file.id]} controls={controls} label={file.label} /></div>)}<div className="required-file-footer"><InfoTip label="Required files">Download only the files for your selected settings. Changing an option starts no downloads. Installed files are reused. Use the individual buttons to download one file at a time.</InfoTip><span>Only selected settings</span>{manage && <button type="button" onClick={manage}>Manage extras</button>}</div></div></details>
    {ready < files.length && <div className="required-models-action"><span>{controls.online ? `${files.length - ready} ${files.length - ready === 1 ? 'file' : 'files'} needed` : 'Connect to check files'}</span><DownloadButton files={files} controls={controls} label="Files for current settings" size /></div>}
    {(controls.settingUp || !controls.online) && <p>{controls.settingUp ? 'Starting the blank engine. Weights stay on demand.' : 'Connect the engine, then download only what you need.'} <button onClick={setup}>View GPU</button></p>}
    {shortage && <p className="model-file-slow" role="status">Needs {modelSize(bytes + modelWorkingReserve(files))} free including working space; {modelSize(controls.state.diskFreeBytes!)} is available. Use a larger instance disk or remove unused extras before downloading this set.</p>}
  </div>;
}

export default function ModelsWorkspace({ controls, required, refresh, cancel, setup, useLora, missingCustom = [] }: { controls: DownloadControls; required: string[]; refresh: () => void; cancel: () => void; setup: () => void; useLora: (name: string) => void; missingCustom?: string[] }) {
  const installed = controls.state.installedLoras || [], optional = installed.filter(file => !file.included);
  const used = optional.reduce((sum, file) => sum + file.size + (file.partialSize || 0), 0);
  const custom = optional.filter(file => !modelDefinitions.some(definition => definition.id === 'loras/' + file.name));
  const definitions = [...modelDefinitions.filter(file => !file.included), ...custom.map(file => ({ id: 'loras/' + file.name, filename: file.name, size: file.size + (file.partialSize || 0), label: file.name.split('/').at(-1)!, description: 'Your uploaded LoRA', group: 'adapter', included: false, experimental: false, trigger: '', source: '' }))];
  return <section className="models-workspace" aria-label="Optional extras"><div className="models-heading"><div><span className="workspace-overline">MAKE IT YOURS</span><h2>Extras</h2><p>Add styles and features when you need them.</p></div><button className="secondary-button" disabled={controls.state.refreshing || !controls.online} onClick={refresh}><ArrowClockwise size={14} />{controls.state.refreshing ? 'Checking storage…' : 'Refresh'}</button></div>
    <div className="extras-storage"><HardDrives size={22} /><div><strong>{controls.settingUp ? 'Engine setup is running' : controls.online ? `${modelSize(used)} used by extras` : 'Connect your GPU to check storage'}</strong><p>{controls.settingUp ? 'Downloads become available when the engine is online.' : controls.online ? `${optional.length} extra ${optional.length === 1 ? 'LoRA' : 'LoRAs'} on this GPU. Remove files here to make room for others.` : 'Installed extras and their storage sizes appear here after connecting.'}</p></div></div>
    <p className="extras-included">The engine starts without model weights. Download the files for your selected settings from Remotion; adapters here are all optional. <button onClick={setup}>View GPU setup <ArrowSquareOut size={12} /></button></p>
    <p className="models-billing">Extras download to the connected GPU. Compute and transfer/storage rates apply. Downloading a LoRA does not enable it.</p>
    {controls.state.error && <p className="model-page-error" role="alert"><WarningCircle size={16} />{controls.state.error}</p>}
    {missingCustom.length > 0 && <p className="model-page-error" role="alert"><WarningCircle size={16} />Selected custom LoRA missing: {missingCustom.join(', ')}. Upload it to this GPU, or choose None in Advanced settings.</p>}
    {controls.state.busy && <div className="model-download-notice" role="status"><span>{controls.state.deleting ? 'Removing the LoRA from this GPU…' : 'Downloading selected files. Partial downloads can be resumed.'}</span>{!controls.state.deleting && <button className="secondary-button" onClick={cancel}><Pause size={13} />Cancel downloads</button>}</div>}
    <section className="model-group"><div className="model-group-heading"><h2>Optional LoRAs & features</h2><span>Install, try, remove, repeat</span></div>
      <div className="model-file-list">{definitions.map(file => {
        const stored = installed.find(item => item.name === file.filename);
        const state = controls.state.files.find(item => item.id === file.id) || (stored?.size ? { status: 'installed', percent: 100, error: null, message: '' } : undefined), active = state?.status === 'downloading';
        const removable = file.id.startsWith('loras/') && (stored?.size || stored?.partialSize || state?.status === 'installed');
        return <article className={`model-file ${state?.status || 'unknown'}`} key={file.id}><div className="model-file-copy"><div className="model-file-title"><h3>{file.label}</h3>{required.includes(file.id) && <span className="model-required-label">Selected</span>}</div><p>{file.description}</p><small title={file.filename}>{file.filename}</small>
          {file.experimental && <p className="extra-model-notes"><span>Experimental video support</span> Trigger <code>{file.trigger}</code> is included when selected. Compare with your baseline. <a href={file.source} target="_blank" rel="noreferrer">Publisher details <ArrowSquareOut size={11} /></a></p>}
          {active && <div className="model-file-progress"><div role="progressbar" aria-label={`${file.label} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? undefined} className={`meter-track ${state.percent === null ? 'indeterminate' : ''}`}><span style={state.percent === null ? undefined : { transform: `scaleX(${state.percent / 100})` }} /></div><span>{state.percent === null ? 'Connecting / verifying' : `${state.percent}%`}</span></div>}
          {active && state.total && <p className="model-file-transfer">{modelSize(state.downloaded || 0)} / {modelSize(state.total)}{state.bytesPerSecond ? ` · ${modelSize(state.bytesPerSecond)} / s` : ''}</p>}{state?.error && <p className="model-file-error" role="alert">{state.error}</p>}
          {state?.message.includes('longer than') && <p className="model-file-slow">{state.message}</p>}
          {file.experimental && state?.status === 'installed' && <button className="extra-use-button" disabled={controls.blocked || controls.state.busy} onClick={() => useLora(file.filename)}>Use in LoRA A</button>}
        </div><div className="model-file-actions"><span className="model-file-size">{modelSize(file.size)}</span><small>{state?.status === 'installed' ? 'On this GPU' : stored?.partialSize ? `${modelSize(stored.partialSize)} partial` : state?.status === 'queued' ? 'Queued' : state?.status === 'failed' ? 'Retry available' : !controls.online ? 'GPU offline' : ''}</small><div className="extra-file-buttons">{!custom.some(item => item.name === file.filename) && <DownloadButton files={[file.id]} controls={controls} label={file.label} />}{removable ? <button className="model-delete" disabled={!controls.online || controls.blocked || controls.state.busy} title={`Remove ${file.label} from GPU`} aria-label={`Remove ${file.label} from GPU`} onClick={() => controls.remove(file.filename)}><Trash size={16} /></button> : null}</div></div></article>;
      })}</div>
    </section>
    <p className="models-footer-note">Removing an extra deletes its weights and any partial download from this GPU. It clears that LoRA from the current draft; saved videos and render settings stay in your library. Extras can be downloaded again.</p>
  </section>;
}
