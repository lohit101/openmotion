import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Aperture, ArrowClockwise, ArrowCounterClockwise, CaretDown, CaretRight, Check, CheckCircle, Clock, Copy, DotsThree, DownloadSimple, FilmStrip, GearSix, Heart, Image as ImageIcon, Info, Lightning, MagnifyingGlass, Moon, Play, Plug, Plus, SlidersHorizontal, Sparkle, SquaresFour, Sun, Trash, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, Bootstrap, Draft, Job, Settings } from '../shared/types';
import { defaults, geometry, settingsSchema } from '../shared/types';
import { defaultPrompt, migrateDemoPrompt, promptAfterModeChange, renderPrompt } from '../shared/prompts';
import { api, AssetDrop, formatTime, Modal, SmallSelect, Toggle, VideoPlayer } from './components';
import type { CloudState } from '../shared/cloud';
import { setupNotice } from '../shared/cloud-status';
import { framingNotice, FramingWarningTracker } from '../shared/framing-status';
import { samplingNote, samplingOptions, samplingSteps } from '../shared/sampling-display';
import { DPO, emptyModels, modelDefinitions, modelFilesForSettings, presetModelFiles, RELIGHT as RELIGHT_MODEL, setupModelFiles, SOCIAL_STYLE, type ModelsState } from '../shared/models';
import ModelsWorkspace, { DownloadButton, DownloadSelect, RequiredFiles, modelSize, type DownloadControls } from './ModelDownloads';
import FramingNotice from './FramingNotice';
import SettingsWorkspace, { type SettingsTab } from './SettingsWorkspace';
import { Toaster, toast } from 'sonner';
const GpuWorkspace = lazy(() => import('./GpuWorkspace'));

const activeStates = ['queued', 'running', 'reconnecting'];
const shortLora = (name: string) => name.replace(/\.safetensors$/, '').replace(/^user\//, '');

function ProgressPanel({ job, onCancel, onResume, onReuse, online }: { job: Job; onCancel: () => void; onResume: () => void; onReuse: () => void; online: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
  const hasCounter = job.progress.max !== null && job.progress.value !== null && job.progress.max > 0;
  const failed = ['failed', 'interrupted', 'cancelled'].includes(job.status);
  return <div className="progress-panel" aria-live="polite"><div className={`progress-mark ${failed ? 'error-mark' : ''}`}>{failed ? <WarningCircle size={32} weight="light" /> : <Aperture size={34} weight="light" />}</div>
    <div className="progress-kicker">{job.status === 'queued' ? 'IN THE QUEUE' : failed ? 'RUN UPDATE' : 'LIVE FROM COMFYUI'}</div><h2>{job.progress.stage}</h2>
    <p>{job.error || (job.status === 'queued' ? 'Your render will start when the GPU is available.' : 'Your character, following your motion.')}</p>
    {!failed && <div className="generation-meter"><div className={`meter-track ${hasCounter ? '' : 'indeterminate'}`} role="progressbar" aria-label={job.progress.stage} aria-valuenow={hasCounter ? job.progress.value! : undefined} aria-valuemax={hasCounter ? job.progress.max! : undefined} aria-valuemin={0}><span style={hasCounter ? { transform: `scaleX(${job.progress.value! / job.progress.max!})` } : undefined} /></div><div className="meter-caption"><span>{hasCounter ? `${Math.round(job.progress.value!)} / ${job.progress.max} ${job.progress.unit}` : 'Waiting for a progress counter'}</span><span>{formatTime(elapsed)} elapsed</span></div></div>}
    <div className="render-facts"><span>{job.width} × {job.height}</span><span>{job.settings.fps} fps</span><span>Segment {job.progress.segment} of {job.progress.segments}</span></div>
    {job.progress.completedFrames > 0 && <small>{job.progress.completedFrames} of {job.progress.targetFrames} frames saved locally</small>}
    <div className="progress-actions">{activeStates.includes(job.status) && <button className="secondary-button" onClick={onCancel}>Cancel generation</button>}{job.status === 'interrupted' && <button className="primary-button compact" disabled={!online} onClick={job.cancelRequested ? onCancel : onResume}>{job.cancelRequested ? 'Check cancellation' : job.retryRequired ? 'Render missing segment again' : 'Check & resume'}</button>}{failed && <button className="secondary-button" onClick={onReuse}>Reuse settings</button>}</div>
  </div>;
}

function Advanced({ settings: s, update, loras, downloads }: { settings: Settings; update: (v: Partial<Settings>) => void; loras: string[]; downloads: DownloadControls }) {
  const choices = [...new Set([...loras, ...modelDefinitions.filter(file => file.group === 'adapter').map(file => file.filename)])];
  const options = [{ value: 'None', label: 'None', files: [] }, ...choices.map(v => ({ value: v, label: modelDefinitions.find(file => file.filename === v)?.label || shortLora(v), files: modelDefinitions.filter(file => file.filename === v).map(file => file.id) }))];
  return <div className="advanced-body"><div className="settings-grid"><label>Framing<SmallSelect label="Framing" value={s.orientation} onChange={v => update({ orientation: v as Settings['orientation'] })} options={[{ value: 'source', label: 'Match source' }, { value: 'portrait', label: 'Portrait 9:16' }, { value: 'landscape', label: 'Landscape 16:9' }, { value: 'square', label: 'Square 1:1' }]} /></label><label>Frames per pass<SmallSelect label="Frames per pass" value={String(s.framesPerPass)} onChange={v => update({ framesPerPass: Number(v) as 49 | 81 })} options={[{ value: '81', label: '81 frames' }, { value: '49', label: '49, less VRAM' }]} /></label></div>
    <div className="feature-download-row"><Toggle label="Relight character" detail={s.mode === 'swap' ? 'Match the source lighting' : 'Available in character swap'} checked={s.relight && s.mode === 'swap'} onChange={v => update({ relight: v })} disabled={s.mode !== 'swap'} /><DownloadButton files={['loras/' + RELIGHT_MODEL]} controls={downloads} label="Character relighting" /></div>
    {s.relight && s.mode === 'swap' && <label className="slider-field"><span>Relight strength <b>{s.relightStrength.toFixed(2)}</b></span><input type="range" min="0" max="2" step="0.05" value={s.relightStrength} onChange={e => update({ relightStrength: Number(e.target.value) })} /></label>}
    <div className="feature-download-row"><label className="slider-field"><span>Detail adapter <b>{s.dpoStrength.toFixed(2)}</b></span><input type="range" min="0" max="2" step="0.05" value={s.dpoStrength} onChange={e => update({ dpoStrength: Number(e.target.value) })} /></label><DownloadButton files={['loras/' + DPO]} controls={downloads} label="Detail adapter" /></div>
    <Toggle label="Random seed" checked={s.randomSeed} onChange={v => update({ randomSeed: v })} />
    {!s.randomSeed && <label className="full-label">Seed<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} value={s.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>}
    <label className="full-label">Source person<input value={s.sourcePerson} onChange={e => update({ sourcePerson: e.target.value })} /></label>
    <div className="settings-grid"><label>Reference subject<input value={s.referencePerson} onChange={e => update({ referencePerson: e.target.value })} /></label><label>Person index<input value={s.objectIndices} onChange={e => update({ objectIndices: e.target.value })} /></label></div>
    <div className="full-label">LoRA A<DownloadSelect label="LoRA A" value={s.loraA} options={options} onChange={v => update({ loraA: v })} controls={downloads} /></div>
    {s.loraA !== 'None' && <label className="slider-field"><span>LoRA A strength <b>{s.loraAStrength.toFixed(2)}</b></span><input type="range" min="-2" max="2" step="0.05" value={s.loraAStrength} onChange={e => update({ loraAStrength: Number(e.target.value) })} /></label>}
    <div className="full-label">LoRA B<DownloadSelect label="LoRA B" value={s.loraB} options={options} onChange={v => update({ loraB: v })} controls={downloads} /></div>
    {s.loraB !== 'None' && <label className="slider-field"><span>LoRA B strength <b>{s.loraBStrength.toFixed(2)}</b></span><input type="range" min="-2" max="2" step="0.05" value={s.loraBStrength} onChange={e => update({ loraBStrength: Number(e.target.value) })} /></label>}
    <small className="field-hint">Use adapters compatible with SCAIL-2. The two slots are additional to the detail and relighting adapters.</small>
    <label className="full-label">Negative prompt<textarea rows={3} value={s.negativePrompt} onChange={e => update({ negativePrompt: e.target.value })} /></label>
  </div>;
}

function JobCard({ job, selected, onSelect, onPatch, onReuse }: { job: Job; selected?: boolean; onSelect: () => void; onPatch: (v: Partial<Job>) => void; onReuse: () => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const done = job.status === 'completed';
  return <article className={`job-card ${selected ? 'selected' : ''}`}>
    <button className="job-media" onClick={onSelect} onMouseEnter={() => { if (done) void preview.current?.play().catch(() => undefined); }} onMouseLeave={() => { preview.current?.pause(); if (preview.current) preview.current.currentTime = 0; }} aria-label={`Open ${job.title}`}>
      {done ? <video ref={preview} muted playsInline loop preload="none" poster={`/api/jobs/${job.id}/poster`} src={`/api/jobs/${job.id}/video`} /> : <div className="job-pending"><FilmStrip size={28} /><span>{job.status === 'running' ? job.progress.stage : job.status}</span></div>}
      {done && <span className="job-play"><Play size={14} weight="fill" /></span>}
    </button><div className="job-card-content"><button className="job-title" onClick={onSelect}>{job.title}</button><Menu.Root><Menu.Trigger asChild><button className="text-icon" aria-label={`Actions for ${job.title}`}><DotsThree size={21} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="dropdown-content" sideOffset={5} align="end"><Menu.Item onSelect={onReuse}><ArrowCounterClockwise size={15} />Reuse settings</Menu.Item><Menu.Item onSelect={() => onPatch({ favorite: !job.favorite })}><Heart size={15} />{job.favorite ? 'Remove favorite' : 'Add to favorites'}</Menu.Item>{done && <Menu.Item asChild><a href={`/api/jobs/${job.id}/video?download=1`}><DownloadSimple size={15} />Download video</a></Menu.Item>}<Menu.Separator /><Menu.Item onSelect={() => onPatch({ deleted: !job.deleted })}><Trash size={15} />{job.deleted ? 'Restore to library' : 'Move to trash'}</Menu.Item></Menu.Content></Menu.Portal></Menu.Root><small>{formatTime(job.progress.targetFrames / job.settings.fps)} <span>/</span> {job.width} × {job.height}{job.favorite && <Heart size={11} weight="fill" />}</small></div>
  </article>;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null), [draft, setDraft] = useState<Draft>({ sourceId: null, referenceId: null, settings: defaults });
  const [view, setView] = useState<'create' | 'library' | 'gpu' | 'settings'>('create'), [selectedId, setSelectedId] = useState<string | null>(null), [compare, setCompare] = useState(false), [advanced, setAdvanced] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connection');
  const openModels = () => { setSettingsTab('extras'); setView('settings'); };
  const [info, setInfo] = useState(false), [message, setMessageValue] = useState(''), [creating, setCreating] = useState(false), [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [sort, setSort] = useState('newest');
  const setMessage = useCallback((text: string) => { setMessageValue(text); if (text) toast.error(text, { duration: 10000 }); }, []);
  const seenNotices = useRef(new Set<string>());
  const renderStates = useRef(new Map<string, string>());
  useEffect(() => {
    for (const job of data?.jobs || []) {
      const state = `${job.status}:${job.error || ''}`, previous = renderStates.current.get(job.id);
      renderStates.current.set(job.id, state);
      if (!previous || previous === state) continue;
      if (job.status === 'reconnecting') toast.warning('Restoring GPU connection', { id: `render-${job.id}`, description: 'Checking the existing job. No new segment has been submitted.' });
      else if (job.status === 'interrupted' || job.status === 'failed') toast.error(job.retryRequired ? 'Render segment is missing' : job.status === 'failed' ? 'Generation failed' : 'Generation interrupted', { id: `render-${job.id}`, description: job.error || 'Open the run for details.', duration: 14000 });
      else if (previous.startsWith('reconnecting:')) toast.dismiss(`render-${job.id}`);
    }
  }, [data?.jobs]);
  const framingWarnings = useRef(new FramingWarningTracker());
  useEffect(() => {
    if (!data) return;
    for (const notice of framingWarnings.current.collect(data.jobs)) toast.warning(notice.title, { id: `framing-${notice.jobId}`, description: notice.message, duration: 12000 });
  }, [data?.jobs]);
  useEffect(() => {
    const launch = data?.cloud.launches.find(l => l.phase !== 'destroyed'); if (!launch) return;
    const notice = setupNotice(launch); if (!notice || seenNotices.current.has(notice.key)) return;
    seenNotices.current.add(notice.key);
    toast[notice.tone](notice.title, { id: `setup-${launch.id}`, description: notice.message, duration: notice.tone === 'error' ? 14000 : 9000 });
  }, [data?.cloud]);
  const [theme, setTheme] = useState(() => localStorage.getItem('recast-theme') || 'dark');
  const initialized = useRef(false), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), requestId = useRef<string | null>(null), promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('recast-theme', theme); }, [theme]);
  const receiveBootstrap = useCallback((value: Bootstrap) => {
    setData(value);
    if (!initialized.current) { initialized.current = true; setDraft({ ...value.draft, settings: { ...value.draft.settings, prompt: migrateDemoPrompt(value.draft.settings.prompt, value.draft.settings.mode) } }); setSelectedId(value.jobs.find(j => !j.deleted)?.id || null); }
  }, []);
  useEffect(() => {
    let disposed = false;
    void api<Bootstrap>('/bootstrap').then(v => { if (!disposed) receiveBootstrap(v); }).catch(e => setMessage(e.message));
    const stream = new EventSource('/api/events');
    stream.onmessage = event => {
      const e = JSON.parse(event.data);
      if (e.type === 'bootstrap') receiveBootstrap(e.data);
      else if (e.type === 'job') setData(old => old ? { ...old, jobs: [e.data, ...old.jobs.filter(j => j.id !== e.data.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } : old);
      else if (e.type === 'asset') setData(old => old ? { ...old, assets: [e.data, ...old.assets.filter(a => a.id !== e.data.id)] } : old);
      else if (e.type === 'connection') setData(old => old ? { ...old, connection: e.data } : old);
      else if (e.type === 'cloud') setData(old => old ? { ...old, cloud: e.data } : old);
      else if (e.type === 'models') setData(old => old ? { ...old, models: e.data } : old);
      else if (e.type === 'lora-removed') setDraft(old => ({ ...old, settings: { ...old.settings, ...(old.settings.loraA === e.data.name ? { loraA: 'None' } : {}), ...(old.settings.loraB === e.data.name ? { loraB: 'None' } : {}) } }));
    };
    return () => { disposed = true; stream.close(); };
  }, [receiveBootstrap]);
  useEffect(() => {
    if (!initialized.current) return;
    saveTimer.current = setTimeout(() => { void api('/draft', draft).catch(e => setMessage('Draft not saved: ' + e.message)); }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft]);
  const refreshModels = useCallback(() => {
    void api<ModelsState>('/models').then(models => setData(old => old ? { ...old, models } : old)).catch(error => setMessage(error.message));
  }, [setMessage]);
  useEffect(() => { if (data && !data.cloud.busy) refreshModels(); }, [data?.connection.state, data?.connection.checkedAt, data?.cloud.busy, refreshModels]);
  const lastModelStates = useRef(new Map<string, string>());
  useEffect(() => {
    for (const file of data?.models?.files || []) {
      const before = lastModelStates.current.get(file.id), label = modelDefinitions.find(model => model.id === file.id)?.label || 'Model';
      if (['downloading', 'queued'].includes(before || '') && file.status === 'installed') toast.success(`${label} downloaded`, { description: 'Available on this GPU.' });
      if (file.status === 'failed' && before !== 'failed') toast.error(`${label} download failed`, { description: file.error || 'Partial files are kept. Click retry to resume.', duration: 12000 });
      if (file.message.includes('longer than') && !seenNotices.current.has('slow-' + file.id)) { seenNotices.current.add('slow-' + file.id); toast.warning('Download is taking longer than usual', { description: 'The transfer is still running. You can cancel and resume it.' }); }
      lastModelStates.current.set(file.id, file.status);
    }
  }, [data?.models]);
  const downloadModels = useCallback((files: string[]) => {
    void api<ModelsState>('/models/download', { files }).then(models => { setData(old => old ? { ...old, models } : old); toast.message('Downloads queued', { description: 'Only the files you requested will be installed.' }); }).catch(error => setMessage(error.message));
  }, [setMessage]);
  const removeLora = useCallback((name: string) => {
    void api<{ freedBytes: number; models: ModelsState }>('/models/delete', { name }).then(result => {
      setData(old => old ? { ...old, models: result.models } : old);
      setDraft(old => ({ ...old, settings: { ...old.settings, ...(old.settings.loraA === name ? { loraA: 'None' } : {}), ...(old.settings.loraB === name ? { loraB: 'None' } : {}) } }));
      toast.success('LoRA removed', { description: `${modelSize(result.freedBytes)} freed on your GPU. You can download it again.` });
    }).catch(error => setMessage(error.message));
  }, [setMessage]);
  const assets = data?.assets || [], jobs = data?.jobs || [], connection = data?.connection;
  const source = assets.find(a => a.id === draft.sourceId), reference = assets.find(a => a.id === draft.referenceId);
  const selected = jobs.find(j => j.id === selectedId && !j.deleted) || jobs.find(j => !j.deleted);
  const selectedFramingNotice = selected ? framingNotice(selected) : null;
  const recent = jobs.filter(j => !j.deleted).slice(0, 6), online = connection?.state === 'online';
  const modelState = data?.models || emptyModels();
  const requiredFiles = modelFilesForSettings(draft.settings);
  const missingCustom = [draft.settings.loraA, draft.settings.loraB].filter(name => name !== 'None' && !connection?.loras.includes(name) && !modelDefinitions.some(file => file.filename === name));
  const modelsReady = requiredFiles.every(id => modelState.files.find(file => file.id === id)?.status === 'installed') &&
    [draft.settings.loraA, draft.settings.loraB].every(name => name === 'None' || connection?.loras.includes(name));
  const needsSetupFiles = setupModelFiles.some(id => modelState.files.find(file => file.id === id)?.status !== 'installed');
  const downloads: DownloadControls = { state: modelState, online, blocked: !!data?.cloud.busy || jobs.some(job => activeStates.includes(job.status)), settingUp: !!data?.cloud.busy, download: downloadModels, remove: removeLora };
  const [width, height] = geometry(draft.settings, source || { width: 480, height: 832 });
  const valid = settingsSchema.safeParse(draft.settings).success && !!source && !!reference && draft.settings.start + draft.settings.seconds <= (source?.duration || 0) + 1 / draft.settings.fps && draft.settings.seconds * draft.settings.fps >= 5;
  const update = (changes: Partial<Settings>) => setDraft(old => ({ ...old, settings: { ...old.settings, ...(changes.mode && changes.prompt === undefined ? { prompt: promptAfterModeChange(old.settings.prompt, changes.mode) } : {}), ...changes } }));
  const selectAsset = (kind: 'video' | 'image', asset: Asset | null) => {
    if (asset) setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old);
    setDraft(old => ({ ...old, [kind === 'video' ? 'sourceId' : 'referenceId']: asset?.id || null, settings: { ...old.settings, prompt: migrateDemoPrompt(old.settings.prompt, old.settings.mode), ...(kind === 'video' && asset ? { start: 0, seconds: Math.min(3, Math.floor(asset.duration * old.settings.fps) / old.settings.fps) } : {}) } }));
  };
  const patch = async (job: Job, changes: Partial<Job>) => { try { await api('/jobs/' + job.id, changes, 'PATCH'); } catch (e) { setMessage((e as Error).message); } };
  const reuse = (job: Job) => { setDraft({ sourceId: job.sourceId, referenceId: job.referenceId, settings: { ...job.settings, prompt: migrateDemoPrompt(job.settings.prompt, job.settings.mode), randomSeed: false } }); setView('create'); setSelectedId(job.id); toast.success('Inputs and settings loaded.'); };
  const generate = useCallback(async () => {
    if (creating || !online || !valid || !modelsReady || modelState.busy) return;
    setCreating(true); setMessage(''); requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId.current }, body: JSON.stringify({ sourceId: draft.sourceId, referenceId: draft.referenceId, settings: draft.settings }) });
      const result = await response.json(); if (!response.ok) { requestId.current = null; throw new Error(result.error); }
      requestId.current = null; setData(old => old ? { ...old, jobs: [result, ...old.jobs.filter(j => j.id !== result.id)] } : old); setSelectedId(result.id); setView('create'); setCompare(false);
    } catch (e) { setMessage((e as Error).message); } finally { setCreating(false); }
  }, [creating, online, valid, draft, modelsReady, modelState.busy]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void generate(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [generate]);
  const visibleJobs = useMemo(() => {
    let list = jobs.filter(j => filter === 'trash' ? j.deleted : !j.deleted && (filter !== 'favorites' || j.favorite));
    if (search.trim()) list = list.filter(j => (j.title + ' ' + j.settings.prompt).toLowerCase().includes(search.toLowerCase()));
    return [...list].sort((a, b) => sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  }, [jobs, filter, search, sort]);
  const handleJobAction = async (action: 'cancel' | 'resume') => { if (!selected) return; try { await api(`/jobs/${selected.id}/${action}`, action === 'resume' ? { retryMissing: !!selected.retryRequired } : {}); } catch (e) { setMessage((e as Error).message); } };
  const setCloud = useCallback((cloud: CloudState) => setData(old => old ? { ...old, cloud } : old), []);
  if (!data) return <div className="app-loading"><Aperture size={40} weight="light" /><h1>Recast Studio</h1><span className="activity-line" /><p>{message || 'Opening your local workspace'}</p>{message && <button className="secondary-button" onClick={() => location.reload()}>Retry</button>}</div>;
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand-mark" onClick={() => setView('create')} aria-label="Recast home"><Aperture weight="bold" size={28} /><span className="wordmark">recast<span>studio</span></span></button>
      <div className="topbar-controls"><button className={`connection-button ${data.cloud.busy ? 'connecting' : connection!.state}`} onClick={() => setView('gpu')} title={data.cloud.busy ? 'Preparing GPU' : online ? connection!.gpu || 'GPU connected' : connection!.state === 'connecting' ? 'Connecting' : 'GPU offline'}><span className="status-dot" />{data.cloud.busy ? 'Preparing GPU' : online ? connection!.gpu || 'GPU connected' : connection!.state === 'connecting' ? 'Connecting' : 'GPU offline'}<CaretDown size={12} /></button>
        <button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>
    <aside className="nav-rail">
      <nav className="rail-main" aria-label="Workspace">
        <button className={`rail-link ${view === 'create' ? 'active' : ''}`} aria-current={view === 'create' ? 'page' : undefined} onClick={() => setView('create')} title="Motion control"><SlidersHorizontal size={21} /><span>Motion control</span></button>
      </nav>
      <div className="rail-bottom"><nav className="rail-utilities" aria-label="Library and GPU">
        <button className={`rail-link ${view === 'library' ? 'active' : ''}`} aria-current={view === 'library' ? 'page' : undefined} onClick={() => setView('library')} title="My library"><SquaresFour size={21} /><span>My library</span><small className="rail-count">{jobs.filter(j => !j.deleted).length}</small></button>
        <button className={`rail-link ${view === 'gpu' ? 'active' : ''}`} aria-current={view === 'gpu' ? 'page' : undefined} onClick={() => setView('gpu')} title="GPU cloud"><Lightning size={21} /><span>GPU cloud</span></button>
      </nav><div className="rail-settings"><button className={`rail-link ${view === 'settings' ? 'active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')} title="Settings"><GearSix size={21} /><span>Settings</span></button></div></div>
    </aside>
    {view === 'settings' ? <SettingsWorkspace tab={settingsTab} onTabChange={setSettingsTab} connection={connection!} error={setMessage} browse={() => setView('gpu')} models={<ModelsWorkspace controls={downloads} required={requiredFiles} missingCustom={missingCustom} refresh={refreshModels} cancel={() => { void api<ModelsState>('/models/cancel', {}).then(models => { setData(old => old ? { ...old, models } : old); toast.message('Downloads cancelled. Partial files are kept.'); }).catch(error => setMessage(error.message)); }} setup={() => setView('gpu')} useLora={name => { setDraft(old => ({ ...old, settings: { ...old.settings, loraA: name, loraAStrength: name === SOCIAL_STYLE ? 0.35 : 0.8 } })); setView('create'); }} />} /> : view === 'gpu' ? <Suspense fallback={<main className="gpu-loading">Opening GPU cloud</main>}><GpuWorkspace cloud={data.cloud} setCloud={setCloud} notify={setMessage} onCreate={() => setView('create')} /></Suspense> : view === 'create' ? <main className="create-layout"><section className="editor"><div className="editor-scroll"><div className="editor-heading"><span className="section-icon"><FilmStrip size={19} /></span><h1>Motion control</h1><span className="model-tag">SCAIL-2</span></div><p className="editor-description">New character. Same performance.</p><div className="mode-tabs" role="group" aria-label="Generation mode"><button aria-pressed={draft.settings.mode === 'swap'} className={draft.settings.mode === 'swap' ? 'active' : ''} onClick={() => update({ mode: 'swap' })}>Character swap</button><button aria-pressed={draft.settings.mode === 'motion'} className={draft.settings.mode === 'motion' ? 'active' : ''} onClick={() => update({ mode: 'motion' })}>Motion transfer</button></div>
      <div className="input-pair"><AssetDrop kind="video" asset={source} onAsset={a => selectAsset('video', a)} onError={setMessage} /><AssetDrop kind="image" asset={reference} onAsset={a => selectAsset('image', a)} onError={setMessage} /></div>
      {draft.settings.mode === 'swap' && <p className="framing-hint">The reference supplies appearance. The video supplies position, scale and camera framing.</p>}
      <div className="prompt-field"><label htmlFor="prompt">Prompt<span>Optional refinements</span></label><textarea id="prompt" ref={promptRef} value={draft.settings.prompt} onChange={e => update({ prompt: e.target.value })} maxLength={8000} spellCheck={false} placeholder="Leave empty to use the default. Add only specific details you want to refine." /><div className="prompt-bottom"><span>{draft.settings.prompt.trim() ? `${draft.settings.prompt.length.toLocaleString()} / 8,000` : 'Default prompt active'}</span><div><button onClick={() => { update({ prompt: defaultPrompt(draft.settings.mode) }); promptRef.current?.focus(); }}>Use default</button><button onClick={() => { update({ prompt: '' }); promptRef.current?.focus(); }}>Clear</button></div></div></div>
      <div className="settings-grid"><div className="download-field"><span>Quality</span><DownloadSelect label="Quality preset" value={draft.settings.preset} onChange={v => update({ preset: v as Settings['preset'] })} options={samplingOptions.map(option => ({ ...option, files: presetModelFiles(option.value, draft.settings.mode) }))} controls={downloads} /></div><label>Resolution<SmallSelect label="Resolution" value={draft.settings.resolution} onChange={v => update({ resolution: v as '480' | '704' })} options={[{ value: '480', label: '480p' }, { value: '704', label: '704p' }]} /></label></div>
      <div className="settings-grid"><label>Frame rate<SmallSelect label="Frame rate" value={String(draft.settings.fps)} onChange={v => update({ fps: Number(v) as 16 | 24 | 30 })} options={[{ value: '16', label: '16 fps' }, { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }]} /></label><label>Duration <span className="label-unit">seconds</span><input type="number" min="0.2" max={Math.min(30, source?.duration || 30)} step="0.1" value={draft.settings.seconds} onChange={e => update({ seconds: Number(e.target.value) })} /></label></div>
      {source && <label className="start-range"><span>Clip starts at <b>{draft.settings.start.toFixed(2)}s</b></span><input type="range" aria-label="Clip start time" min={0} max={Math.max(0, source.duration - draft.settings.seconds)} step={1 / draft.settings.fps} value={draft.settings.start} onChange={e => update({ start: Number(e.target.value) })} /><small>{width} × {height} output <span>{Math.ceil(draft.settings.seconds * draft.settings.fps)} frames</span></small></label>}
      {(draft.settings.preset !== 'fast' || draft.settings.resolution === '704' || draft.settings.mode === 'motion') && <div className="preset-note"><Info size={15} /><span>{draft.settings.mode === 'motion' ? 'Motion transfer uses the reference scene. This mode has not been GPU-tested in this app.' : samplingNote(draft.settings.preset)}</span></div>}
      <RequiredFiles files={requiredFiles} controls={downloads} manage={openModels} setup={() => setView('gpu')} /><button className="advanced-trigger" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><SlidersHorizontal size={15} /> Advanced settings<CaretRight size={14} className={advanced ? 'rotated' : ''} /></button>
      {advanced && <Advanced settings={draft.settings} update={update} loras={connection!.loras} downloads={downloads} />}
    </div><div className="generate-footer"><button className="primary-button generate" disabled={!online || !valid || creating || !modelsReady || modelState.busy} onClick={() => void generate()}><Sparkle size={18} weight="fill" />{creating ? 'Submitting...' : 'Generate'}<kbd>⌘ ↵</kbd></button><div className="generate-caption">{!online ? <><Plug size={12} /><button onClick={() => setView('gpu')}>Connect GPU to generate</button></> : !modelsReady || modelState.busy ? <><DownloadSimple size={12} /><button onClick={needsSetupFiles ? () => setView('gpu') : openModels}>{needsSetupFiles ? 'Required files are part of GPU setup' : modelState.busy ? 'Updating extra model files' : 'Download selected extras to generate'}</button></> : !valid ? 'Add both inputs and choose a valid clip range.' : <><CheckCircle size={12} />Ready on your GPU</>}</div></div></section>
    <section className="workspace"><div className="workspace-header"><div><span className="workspace-overline">YOUR WORKSPACE</span><h2>{selected?.title || 'Your next creation'}</h2></div><div className="workspace-actions">{selected?.status === 'completed' && <><button className="icon-button" title="Render details" aria-label="Render details" onClick={() => setInfo(true)}><Info size={18} /></button><button className="icon-button" title="Reuse settings" aria-label="Reuse selected render settings" onClick={() => reuse(selected)}><ArrowCounterClockwise size={18} /></button><a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`}><DownloadSimple size={15} />Download</a></>}</div></div>
      {selected && <FramingNotice job={selected} onCompare={() => setCompare(true)} />}
      <div className={`preview-stage ${selected?.status === 'completed' ? 'has-result' : ''}`}>
        {selected?.status === 'completed' ? <><div className="preview-toolbar"><div className="preview-tabs"><button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}>Result</button><button className={compare ? 'active' : ''} onClick={() => setCompare(true)}>Compare</button></div><span className={`result-indicator ${selectedFramingNotice ? 'needs-review' : ''}`}>{selectedFramingNotice ? <WarningCircle size={12} /> : <Check size={12} />}{selectedFramingNotice?.badge || (selected.origin === 'import' ? 'Previous GPU render' : 'Completed')}</span></div><VideoPlayer job={selected} compare={compare} /></> : selected ? <ProgressPanel job={selected} online={online} onCancel={() => void handleJobAction('cancel')} onResume={() => void handleJobAction('resume')} onReuse={() => reuse(selected)} /> : <div className="canvas-empty"><FilmStrip size={40} weight="thin" /><h2>Make the motion yours.</h2><p>Add a video and a character to create your first shot.</p></div>}
      </div><div className="workspace-bottom"><div className="recent-heading"><h3>Recent creations <span>{jobs.filter(j => !j.deleted).length}</span></h3><button onClick={() => setView('library')}>View library <CaretRight size={13} /></button></div><div className="recent-grid">{recent.map(job => <JobCard key={job.id} job={job} selected={job.id === selected?.id} onSelect={() => { setSelectedId(job.id); setCompare(false); }} onPatch={v => void patch(job, v)} onReuse={() => reuse(job)} />)}{!recent.length && <div className="empty-recent">Your generated videos will appear here.</div>}</div></div>
    </section></main> : <main className="library"><div className="library-heading"><div><span className="workspace-overline">YOUR CREATIVE ARCHIVE</span><h1>My library<span>{jobs.filter(j => !j.deleted).length} creations</span></h1></div><button className="primary-button compact" onClick={() => { setView('create'); promptRef.current?.focus(); }}><Plus size={16} />New creation</button></div><div className="library-controls"><div className="library-filters">{[{ value: 'all', label: 'All creations' }, { value: 'favorites', label: 'Favorites' }, { value: 'trash', label: 'Trash' }].map(f => <button key={f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>{f.value === 'favorites' && <Heart size={14} />}{f.value === 'trash' && <Trash size={14} />}{f.label}</button>)}</div><label className="search-field"><MagnifyingGlass size={16} /><input aria-label="Search library" placeholder="Search your creations" value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="text-icon" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</label><SmallSelect label="Sort library" value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} /></div><div className="library-grid">{visibleJobs.map(job => <JobCard key={job.id} job={job} onSelect={() => { if (job.deleted) { void patch(job, { deleted: false }); } setSelectedId(job.id); setView('create'); setCompare(false); }} onPatch={v => void patch(job, v)} onReuse={() => reuse(job)} />)}</div>{!visibleJobs.length && <div className="library-empty"><SquaresFour size={36} weight="light" /><h2>{filter === 'favorites' ? 'Keep your best takes close.' : filter === 'trash' ? 'Nothing in trash.' : search ? 'No matching creations.' : 'Your library starts here.'}</h2><p>{filter === 'favorites' ? 'Save a creation with the heart in its menu.' : search ? 'Try a different title or prompt.' : 'Your videos stay here, even when the GPU is offline.'}</p></div>}</main>}
    <Toaster theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton visibleToasts={3} toastOptions={{ className: 'recast-toast' }} />
    {selected && <Modal open={info} onOpenChange={setInfo} title="Render details" description="The inputs and settings saved with this creation."><label className="full-label">Title<input defaultValue={selected.title} key={selected.id + selected.title} onBlur={e => { if (e.target.value.trim() && e.target.value !== selected.title) void patch(selected, { title: e.target.value }); }} /></label><div className="details-grid">{[['Model', 'SCAIL-2 INT8'], ['Resolution', `${selected.width} × ${selected.height}`], ['Frame rate', `${selected.settings.fps} fps`], ['Steps', String(samplingSteps(selected.settings.preset))], ['Seed', String(selected.settings.seed)], ['Render time', selected.elapsedSeconds ? `${Math.round(selected.elapsedSeconds)} seconds` : 'In progress']].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="detail-prompt"><label>Prompt sent to model</label><p>{renderPrompt(selected.settings, selected.promptVersion) || 'Empty prompt'}</p></div><div className="modal-actions">{selected.referenceFraming?.status === 'aligned' && <a className="secondary-button" href={`/api/jobs/${selected.id}/aligned-reference`} target="_blank" rel="noreferrer"><ImageIcon size={14} />View aligned reference</a>}<button className="secondary-button" onClick={() => { reuse(selected); setInfo(false); }}><ArrowCounterClockwise size={14} />Reuse settings</button>{selected.workflow !== null || selected.output ? <a className="secondary-button" href={`/api/jobs/${selected.id}/workflow`}><DownloadSimple size={14} />Export workflow</a> : null}</div></Modal>}
  </div>;
}
