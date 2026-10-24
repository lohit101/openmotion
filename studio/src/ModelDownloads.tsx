import { useEffect, useRef } from 'react';
import { ArrowClockwise, CaretDown, Check, CheckCircle, DownloadSimple, HardDrives, Pause, WarningCircle } from '@phosphor-icons/react';
import { modelDefinitions, type ModelsState } from '../shared/models';
import './models.css';

export interface DownloadControls { state: ModelsState; online: boolean; blocked: boolean; download: (files: string[]) => void; }
export const modelSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
export function DownloadButton({ files, controls, label, size = false }: { files: string[]; controls: DownloadControls; label: string; size?: boolean }) {
  const needed = files.filter(id => controls.state.files.find(file => file.id === id)?.status !== 'installed');
  const states = needed.map(id => controls.state.files.find(file => file.id === id));
  const active = states.some(file => ['downloading', 'queued'].includes(file?.status || ''));
  const failed = states.some(file => file?.status === 'failed');
  const percent = states.find(file => file?.status === 'downloading')?.percent;
  const bytes = modelDefinitions.filter(file => needed.includes(file.id)).reduce((sum, file) => sum + file.size, 0);
  const ready = !needed.length;
  const title = ready ? files.length ? `${label}: installed` : `${label}: no extra file needed` : !controls.online ? `Connect GPU to download ${label}` : active ? `${label}: download in progress` : `${failed ? 'Retry' : 'Download'} ${label} · ${modelSize(bytes)}`;
  return <button type="button" className={`model-download ${ready ? 'installed' : active ? 'transferring' : failed ? 'failed' : ''}`}
    disabled={ready || active || !controls.online || controls.blocked || controls.state.refreshing} title={title} aria-label={title}
    onClick={event => { event.stopPropagation(); controls.download(needed); }}>
    {ready ? <CheckCircle size={15} /> : failed ? <ArrowClockwise size={15} /> : <DownloadSimple size={15} className={active ? 'downloading-icon' : ''} />}
    {size && <span>{ready ? 'Installed' : active ? percent !== null && percent !== undefined ? `${percent}%` : 'Queued' : modelSize(bytes)}</span>}
  </button>;
}

export function DownloadSelect({ value, options, onChange, label, controls }: { value: string; options: { value: string; label: string; files: string[] }[];
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
      <button type="button" aria-pressed={value === option.value} className="download-option-choice" onClick={() => { onChange(option.value); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}>
        <span>{option.label}</span>{value === option.value && <Check size={12} />}
      </button><DownloadButton files={option.files} controls={controls} label={option.label} size />
    </div>)}</div></details>{selected ? <DownloadButton files={selected.files} controls={controls} label={selected.label} /> : <span className="model-download failed" title="Upload this custom LoRA to the connected GPU, or choose None" aria-label="Custom LoRA is missing"><WarningCircle size={15} /></span>}
  </div>;
}

export function RequiredFiles({ files, controls, manage }: { files: string[]; controls: DownloadControls; manage: () => void }) {
  const ready = files.filter(id => controls.state.files.find(file => file.id === id)?.status === 'installed').length;
  const bytes = modelDefinitions.filter(file => files.includes(file.id) && controls.state.files.find(item => item.id === file.id)?.status !== 'installed').reduce((sum, file) => sum + file.size, 0);
  return <div className="required-models"><div className="required-models-summary"><HardDrives size={16} /><button onClick={manage}>Model files<span>{controls.online ? `${ready} / ${files.length} ready` : 'Check after connecting'}</span></button>
    <DownloadButton files={files} controls={controls} label="files required by these settings" /></div>
    <p>{ready === files.length && controls.online ? 'All files for these settings are on your GPU.' : `Download only what these settings need${controls.online ? ` · ${modelSize(bytes)} remaining` : ''}.`} <button onClick={manage}>Manage files</button></p>
  </div>;
}

export default function ModelsWorkspace({ controls, required, refresh, cancel, create, missingCustom = [] }: { controls: DownloadControls; required: string[]; refresh: () => void; cancel: () => void; create: () => void; missingCustom?: string[] }) {
  const ready = required.filter(id => controls.state.files.find(file => file.id === id)?.status === 'installed').length;
  const missing = required.filter(id => controls.state.files.find(file => file.id === id)?.status !== 'installed');
  const remaining = modelDefinitions.filter(file => missing.includes(file.id)).reduce((sum, file) => sum + file.size, 0);
  return <section className="models-workspace" aria-label="Model downloads"><div className="models-heading"><div><span className="workspace-overline">FILES ON YOUR GPU</span><h2>Model downloads</h2><p>Download what you use. Keep the rest optional.</p></div><button className="secondary-button" disabled={controls.state.refreshing || !controls.online} onClick={refresh}><ArrowClockwise size={14} />{controls.state.refreshing ? 'Checking files…' : 'Refresh'}</button></div>
    <div className="model-recipe"><div><strong>{controls.online ? `${ready} of ${required.length} required files ready` : 'Connect your GPU to check its files'}</strong><p>For your current Motion control settings. Selecting an option never downloads files.</p></div>
      {ready === required.length && controls.online ? <button className="primary-button compact" onClick={create}><CheckCircle size={15} />Back to create</button> : <button className="primary-button compact" disabled={!controls.online || controls.blocked || controls.state.refreshing || !missing.length || missing.every(id => ['downloading', 'queued'].includes(controls.state.files.find(file => file.id === id)?.status || ''))} onClick={() => controls.download(missing)}><DownloadSimple size={15} />Download required files<span>{modelSize(remaining)}</span></button>}
    </div>
    <p className="models-billing">Downloads go directly to this GPU’s disk. Compute and the host’s transfer/storage rates apply. Existing files are reused; destroying the instance removes its files.</p>
    {controls.state.error && <p className="model-page-error" role="alert"><WarningCircle size={16} />{controls.state.error}</p>}
    {missingCustom.length > 0 && <p className="model-page-error" role="alert"><WarningCircle size={16} />Selected custom LoRA missing: {missingCustom.join(', ')}. Upload it to this GPU, or choose None in Advanced settings.</p>}
    {controls.state.busy && <div className="model-download-notice" role="status"><span>Downloading your chosen files. Partial downloads can be resumed.</span><button className="secondary-button" onClick={cancel}><Pause size={13} />Cancel downloads</button></div>}
    {(['core', 'adapter'] as const).map(group => <section className="model-group" key={group}><div className="model-group-heading"><h2>{group === 'core' ? 'Shared models' : 'Feature adapters'}</h2><span>{group === 'core' ? 'Used by every render' : 'Install individually, when needed'}</span></div>
      <div className="model-file-list">{modelDefinitions.filter(file => file.group === group).map(file => {
        const state = controls.state.files.find(item => item.id === file.id), active = state?.status === 'downloading';
        return <article className={`model-file ${state?.status || 'unknown'}`} key={file.id}><div className="model-file-copy"><div className="model-file-title"><h3>{file.label}</h3>{required.includes(file.id) && <span className="model-required-label">Required</span>}</div><p>{file.description}</p><small title={file.filename}>{file.filename}</small>
          {active && <div className="model-file-progress"><div role="progressbar" aria-label={`${file.label} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? undefined} className={`meter-track ${state.percent === null ? 'indeterminate' : ''}`}><span style={state.percent === null ? undefined : { transform: `scaleX(${state.percent / 100})` }} /></div><span>{state.percent === null ? 'Connecting / verifying' : `${state.percent}%`}</span></div>}
          {state?.error && <p className="model-file-error" role="alert">{state.error}</p>}
          {state?.message.includes('longer than') && <p className="model-file-slow">{state.message}</p>}
        </div><div className="model-file-actions"><span className="model-file-size">{modelSize(file.size)}</span><small>{state?.status === 'installed' ? 'On this GPU' : state?.status === 'queued' ? 'Queued' : state?.status === 'failed' ? 'Retry available' : !controls.online ? 'GPU offline' : ''}</small><DownloadButton files={[file.id]} controls={controls} label={file.label} /></div></article>;
      })}</div>
    </section>)}
    <p className="models-footer-note">Resolution, frame rate, duration and framing share these models. They need no additional downloads. Custom LoRAs remain local uploads and appear in the LoRA selectors after refresh.</p>
  </section>;
}
