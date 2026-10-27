import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FieldLabel, InfoTip } from './InfoTip';
import { EditorDisclosure, EditorSection, PromptEditor } from './EditorControls';
import { Aperture, ArrowCounterClockwise, CaretDown, CaretRight, Check, CheckCircle, DownloadSimple, FilmStrip, Info, Moon, Plug, Sparkle, Sun, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, Bootstrap, Draft, Job, Settings } from '../shared/types';
import { defaults, geometry, outputDimensions, settingsSchema } from '../shared/types';
import { defaultPrompt, migrateDemoPrompt, promptAfterModeChange } from '../shared/prompts';
import { api, AssetDrop, formatTime, SmallSelect, Toggle, VideoPlayer } from './components';
import type { CloudState } from '../shared/cloud';
import { setupNotice } from '../shared/cloud-status';
import { framingNotice, FramingWarningTracker } from '../shared/framing-status';
import { samplingNote, samplingOptions } from '../shared/sampling-display';
import { defaultVigglePrompt, engineIssue, isViggle, referenceModeForRun } from '../shared/engines';
import { DPO, emptyModels, IMAGE_IDENTITY, imageFilesForSettings, imageModelFiles, modelDefinitions, modelFilesForSettings, presetModelFiles, RELIGHT as RELIGHT_MODEL, SOCIAL_STYLE, type ModelsState } from '../shared/models';
import ModelsWorkspace, { DownloadButton, DownloadSelect, RequiredFiles, modelSize, type DownloadControls } from './ModelDownloads';
import FramingNotice from './FramingNotice';
import DownloadsWorkspace from './DownloadsWorkspace';
import Sidebar, { initialSidebarCollapsed, type WorkspaceView } from './Sidebar';
import SettingsWorkspace, { type SettingsTab } from './SettingsWorkspace';
import { Toaster, toast } from 'sonner';
import { clipFrameCount, normalizeClip, DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS } from '../shared/clip';
import { viggleWindows } from '../shared/viggle-segments';
import { emptyImageDraft, isImageJob, type ImageDraft } from '../shared/image-replacement';
const GpuWorkspace = lazy(() => import('./GpuWorkspace'));
const ImageWorkspace = lazy(() => import('./ImageWorkspace'));
const LibraryWorkspace = lazy(() => import('./LibraryWorkspace'));
import JobCard from './JobCard';
import RunDetailsDialog from './RunDetailsDialog';
import WorkspaceWelcome from './WorkspaceWelcome';

const activeStates = ['queued', 'running', 'reconnecting'];
const shortLora = (name: string) => name.replace(/\.safetensors$/, '').replace(/^user\//, '');

function ProgressPanel({ job, onCancel, onResume, onReuse, online }: { job: Job; onCancel: () => void; onResume: () => void; onReuse: () => void; online: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const elapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
  const hasCounter = job.progress.max !== null && job.progress.value !== null && job.progress.max > 0;
  const failed = ['failed', 'interrupted', 'cancelled'].includes(job.status);
  const [width, height] = outputDimensions(job);
  return <div className="progress-panel" aria-live="polite"><div className={`progress-mark ${failed ? 'error-mark' : ''}`}>{failed ? <WarningCircle size={32} weight="light" /> : <Aperture size={34} weight="light" />}</div>
    <div className="progress-kicker">{job.status === 'queued' ? 'IN THE QUEUE' : failed ? 'RUN UPDATE' : 'LIVE FROM COMFYUI'}</div><h2>{job.progress.stage}</h2>
    <p>{job.error || (job.status === 'queued' ? 'Your render will start when the GPU is available.' : 'Your character, following your motion.')}</p>
    {!failed && <div className="generation-meter"><div className={`meter-track ${hasCounter ? '' : 'indeterminate'}`} role="progressbar" aria-label={job.progress.stage} aria-valuenow={hasCounter ? job.progress.value! : undefined} aria-valuemax={hasCounter ? job.progress.max! : undefined} aria-valuemin={0}><span style={hasCounter ? { transform: `scaleX(${job.progress.value! / job.progress.max!})` } : undefined} /></div><div className="meter-caption"><span>{hasCounter ? job.progress.unit === 'bytes' ? `${(job.progress.value! / 1048576).toFixed(1)} / ${(job.progress.max! / 1048576).toFixed(1)} MB` : `${Math.round(job.progress.value!)} / ${job.progress.max} ${job.progress.unit}` : 'Waiting for a progress counter'}</span><span>{formatTime(elapsed)} elapsed</span></div></div>}
    <div className="render-facts"><span>{width} × {height}</span><span>{job.settings.fps} fps</span><span>Segment {job.progress.segment} of {job.progress.segments}</span></div>
    {job.viggleSegmentation && <p className="field-hint">{(job.progress.completedFrames / job.settings.fps).toFixed(2)}s of {(job.progress.targetFrames / job.settings.fps).toFixed(2)}s saved locally. Completed segments are kept if the connection drops.</p>}
    {job.progress.completedFrames > 0 && <small>{job.progress.completedFrames} of {job.progress.targetFrames} frames saved locally</small>}
    <div className="progress-actions">{job.keyframe && <a className="secondary-button" href={`/api/jobs/${job.id}/keyframe`} target="_blank" rel="noreferrer">View conditioning frame</a>}{activeStates.includes(job.status) && <button className="secondary-button" onClick={onCancel}>Cancel generation</button>}{job.status === 'interrupted' && <button className="primary-button compact" disabled={!online} onClick={job.cancelRequested ? onCancel : onResume}>{job.cancelRequested ? 'Check cancellation' : job.retryRequired ? 'Render missing segment again' : 'Check & resume'}</button>}{failed && <button className="secondary-button" onClick={onReuse}>Reuse settings</button>}</div>
  </div>;
}

function Advanced({ settings: s, update, loras, downloads }: { settings: Settings; update: (v: Partial<Settings>) => void; loras: string[]; downloads: DownloadControls }) {
  const choices = [...new Set([...loras.filter(name => !modelDefinitions.some(file => file.filename === name && file.engine !== 'scail2')), ...modelDefinitions.filter(file => file.group === 'adapter' && file.engine === 'scail2').map(file => file.filename)])];
  const options = [{ value: 'None', label: 'None', files: [] }, ...choices.map(v => ({ value: v, label: modelDefinitions.find(file => file.filename === v)?.label || shortLora(v), files: modelDefinitions.filter(file => file.filename === v).map(file => file.id) }))];
  const kleinReady = imageModelFiles.every(id => downloads.state.files.find(file => file.id === id)?.status === 'installed');
  if (isViggle(s)) return <div className="advanced-body">
    <div className="full-label"><FieldLabel label="Reference preparation" help={s.referencePreparation === 'prepared' ? 'Upload a frame from this exact shot with the character already replaced. This skips image editing and its downloads.' : 'The image editor first puts your character into a source frame, preserving pose, camera distance and scene lighting. Changing an option starts no downloads.'} />
      <DownloadSelect label="Reference preparation" value={s.referencePreparation} controls={downloads} onChange={v => update({ referencePreparation: v as Settings['referencePreparation'] })} options={[{ value: 'auto', label: 'Automatic · match character to source frame', files: imageModelFiles, disabled: !kleinReady, disabledReason: downloads.online ? 'Download the three Klein files to enable automatic frame preparation.' : 'Connect your GPU to check whether Klein is installed.' }, { value: 'prepared', label: 'Use an already edited source frame', files: [] }]} />
    </div>
    {!kleinReady && s.referencePreparation === 'auto' && <p className="field-hint">Automatic preparation needs Klein. Prepare a frame in Image replacement, or download Klein beside Automatic.</p>}
    <div className="full-label"><FieldLabel label="Segment reference" help={<>{s.viggleReferenceMode === 'previous' ? 'Long clips carry appearance from the last generated frame into the next segment. Small identity errors can also carry forward.' : 'Long clips keep the original prepared frame as the appearance reference for every segment.'} Both modes retain five-frame motion anchors.</>} />
      <SmallSelect label="Segment reference" value={s.viggleReferenceMode} onChange={v => update({ viggleReferenceMode: v as Settings['viggleReferenceMode'] })} options={[{ value: 'previous', label: 'Previous segment’s last frame' }, { value: 'original', label: 'Original prepared frame' }]} />
    </div>
    <Toggle label="Random seed" checked={s.randomSeed} onChange={v => update({ randomSeed: v })} detail="Use a new seed for each generation. Turn off to keep a fixed seed." />
    {!s.randomSeed && <label className="full-label">Seed<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} value={s.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>}
  </div>;
  return <div className="advanced-body"><div className="settings-grid"><label>Framing<SmallSelect label="Framing" value={s.orientation} onChange={v => update({ orientation: v as Settings['orientation'] })} options={[{ value: 'source', label: 'Match source' }, { value: 'portrait', label: 'Portrait 9:16' }, { value: 'landscape', label: 'Landscape 16:9' }, { value: 'square', label: 'Square 1:1' }]} /></label><label>Frames per pass<SmallSelect label="Frames per pass" value={String(s.framesPerPass)} onChange={v => update({ framesPerPass: Number(v) as 49 | 81 })} options={[{ value: '81', label: '81 frames' }, { value: '49', label: '49, less VRAM' }]} /></label></div>
    <div className="feature-download-row"><Toggle label="Relight character" detail={s.mode === 'swap' ? 'Match the source lighting' : 'Available in character swap'} checked={s.relight && s.mode === 'swap'} onChange={v => update({ relight: v })} disabled={s.mode !== 'swap'} detailVisible={s.mode !== 'swap'} /><DownloadButton files={['loras/' + RELIGHT_MODEL]} controls={downloads} label="Character relighting" /></div>
    {s.relight && s.mode === 'swap' && <label className="slider-field"><span>Relight strength <b>{s.relightStrength.toFixed(2)}</b></span><input type="range" min="0" max="2" step="0.05" value={s.relightStrength} onChange={e => update({ relightStrength: Number(e.target.value) })} /></label>}
    <div className="feature-download-row"><label className="slider-field"><span>Detail adapter <b>{s.dpoStrength.toFixed(2)}</b></span><input type="range" min="0" max="2" step="0.05" value={s.dpoStrength} onChange={e => update({ dpoStrength: Number(e.target.value) })} /></label><DownloadButton files={['loras/' + DPO]} controls={downloads} label="Detail adapter" /></div>
    <Toggle label="Random seed" checked={s.randomSeed} onChange={v => update({ randomSeed: v })} />
    {!s.randomSeed && <label className="full-label">Seed<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} value={s.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>}
    <label className="full-label">Source person<input value={s.sourcePerson} onChange={e => update({ sourcePerson: e.target.value })} /></label>
    <div className="settings-grid"><label>Reference subject<input value={s.referencePerson} onChange={e => update({ referencePerson: e.target.value })} /></label><label>Person index<input value={s.objectIndices} onChange={e => update({ objectIndices: e.target.value })} /></label></div>
    <div className="full-label"><FieldLabel label="LoRA A" help="Use adapters compatible with SCAIL-2. The two slots are additional to the detail and relighting adapters." /><DownloadSelect label="LoRA A" value={s.loraA} options={options} onChange={v => update({ loraA: v })} controls={downloads} /></div>
    {s.loraA !== 'None' && <label className="slider-field"><span>LoRA A strength <b>{s.loraAStrength.toFixed(2)}</b></span><input type="range" min="-2" max="2" step="0.05" value={s.loraAStrength} onChange={e => update({ loraAStrength: Number(e.target.value) })} /></label>}
    <div className="full-label"><FieldLabel label="LoRA B" help="Use adapters compatible with SCAIL-2. The two slots are additional to the detail and relighting adapters." /><DownloadSelect label="LoRA B" value={s.loraB} options={options} onChange={v => update({ loraB: v })} controls={downloads} /></div>
    {s.loraB !== 'None' && <label className="slider-field"><span>LoRA B strength <b>{s.loraBStrength.toFixed(2)}</b></span><input type="range" min="-2" max="2" step="0.05" value={s.loraBStrength} onChange={e => update({ loraBStrength: Number(e.target.value) })} /></label>}
    <label className="full-label">Negative prompt<textarea rows={3} value={s.negativePrompt} onChange={e => update({ negativePrompt: e.target.value })} /></label>
  </div>;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null), [draft, setDraft] = useState<Draft>({ sourceId: null, referenceId: null, settings: defaults });
  const [imageDraft, setImageDraft] = useState<ImageDraft>(emptyImageDraft);
  const [view, setView] = useState<WorkspaceView>('create'), [selectedId, setSelectedId] = useState<string | null>(null), [compare, setCompare] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const toggleSidebar = () => setSidebarCollapsed(previous => {
    try { localStorage.setItem('recast-sidebar-collapsed', String(!previous)); } catch { /* Keep the preference for this session. */ }
    return !previous;
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connection');
  const openModels = () => { setSettingsTab('extras'); setView('settings'); };
  const [info, setInfo] = useState(false), [message, setMessageValue] = useState(''), [creating, setCreating] = useState(false);
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
    const launch = data?.cloud.launches.find(l => l.phase !== 'destroyed' || l.autoCleanup); if (!launch) return;
    const notice = setupNotice(launch); if (!notice || seenNotices.current.has(notice.key)) return;
    seenNotices.current.add(notice.key);
    toast[notice.tone](notice.title, { id: `setup-${launch.id}`, description: notice.message, duration: notice.tone === 'error' ? 14000 : 9000 });
  }, [data?.cloud]);
  const [theme, setTheme] = useState(() => localStorage.getItem('recast-theme') || 'dark');
  const initialized = useRef(false), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), requestId = useRef<string | null>(null), promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('recast-theme', theme); }, [theme]);
  const receiveBootstrap = useCallback((value: Bootstrap) => {
    setData(value);
    if (!initialized.current) { initialized.current = true; const settings = { ...defaults, ...value.draft.settings, prompt: migrateDemoPrompt(value.draft.settings.prompt, value.draft.settings.mode) }; const source = value.assets.find(asset => asset.id === value.draft.sourceId); const clip = source ? normalizeClip(settings, source.duration, settings.fps) : null; setDraft({ ...value.draft, settings: { ...settings, ...clip } }); setImageDraft(value.imageDraft || emptyImageDraft()); }
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
      else if (e.type === 'lora-removed') { setDraft(old => ({ ...old, settings: { ...old.settings, ...(old.settings.loraA === e.data.name ? { loraA: 'None' } : {}), ...(old.settings.loraB === e.data.name ? { loraB: 'None' } : {}) } })); if (e.data.name === IMAGE_IDENTITY) setImageDraft(old => ({ ...old, settings: { ...old.settings, identityRefine: false } })); }
    };
    return () => { disposed = true; stream.close(); };
  }, [receiveBootstrap]);
  useEffect(() => {
    if (!initialized.current) return;
    saveTimer.current = setTimeout(() => { void api('/draft', draft).catch(e => setMessage('Draft not saved: ' + e.message)); }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft]);
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => { void api('/images/draft', imageDraft).catch(e => setMessage('Image draft not saved: ' + e.message)); }, 500);
    return () => clearTimeout(timer);
  }, [imageDraft, setMessage]);
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
  const cancelDownloads = useCallback(() => { void api<ModelsState>('/models/cancel', {}).then(models => { setData(old => old ? { ...old, models } : old); toast.message('Downloads cancelled. Partial files are kept.'); }).catch(error => setMessage(error.message)); }, [setMessage]);
  const removeLora = useCallback((name: string) => {
    void api<{ freedBytes: number; models: ModelsState }>('/models/delete', { name }).then(result => {
      setData(old => old ? { ...old, models: result.models } : old);
      setDraft(old => ({ ...old, settings: { ...old.settings, ...(old.settings.loraA === name ? { loraA: 'None' } : {}), ...(old.settings.loraB === name ? { loraB: 'None' } : {}) } }));
      toast.success('LoRA removed', { description: `${modelSize(result.freedBytes)} freed on your GPU. You can download it again.` });
    }).catch(error => setMessage(error.message));
  }, [setMessage]);
  const assets = data?.assets || [], jobs = data?.jobs || [], connection = data?.connection;
  const source = assets.find(a => a.id === draft.sourceId), reference = assets.find(a => a.id === draft.referenceId);
  const selected = jobs.find(j => j.id === selectedId && !j.deleted && !isImageJob(j));
  const activeVideo = jobs.find(job => !job.deleted && !isImageJob(job) && activeStates.includes(job.status));
  const selectedFramingNotice = selected ? framingNotice(selected) : null;
  const recent = jobs.filter(j => !j.deleted && !isImageJob(j)).slice(0, 6), online = connection?.state === 'online';
  const modelState = data?.models || emptyModels();
  const requiredFiles = modelFilesForSettings(draft.settings);
  const missingCustom = (isViggle(draft.settings) ? [] : [draft.settings.loraA, draft.settings.loraB]).filter(name => name !== 'None' && !connection?.loras.includes(name) && !modelDefinitions.some(file => file.filename === name));
  const modelsReady = requiredFiles.every(id => modelState.files.find(file => file.id === id)?.status === 'installed') &&
    [draft.settings.loraA, draft.settings.loraB].every(name => name === 'None' || connection?.loras.includes(name));
  const downloads: DownloadControls = { state: modelState, online, blocked: !!data?.cloud.busy || jobs.some(job => activeStates.includes(job.status)), settingUp: !!data?.cloud.busy, download: downloadModels, remove: removeLora };
  const [width, height] = geometry(draft.settings, source || { width: 480, height: 832 });
  const engine = isViggle(draft.settings), engineError = engineIssue(draft.settings);
  const valid = !engineError && settingsSchema.safeParse(draft.settings).success && draft.settings.seconds <= MAX_CLIP_SECONDS && !!source && !!reference && draft.settings.start + draft.settings.seconds <= (source?.duration || 0) + 1 / draft.settings.fps && draft.settings.seconds * draft.settings.fps >= 5;
  const update = (changes: Partial<Settings>) => setDraft(old => {
    const settings = { ...old.settings, ...(changes.mode && changes.prompt === undefined ? { prompt: promptAfterModeChange(old.settings.prompt, changes.mode) } : {}), ...changes };
    const input = assets.find(asset => asset.id === old.sourceId);
    const clip = input && ['fps', 'start', 'seconds', 'engine'].some(key => key in changes) ? normalizeClip(settings, input.duration, settings.fps) : null;
    return { ...old, settings: { ...settings, ...clip } };
  });
  const changeEngine = (value: string) => {
    const target = value as Settings['engine'];
    const previousDefault = draft.settings.prompt === defaultPrompt(draft.settings.mode) || draft.settings.prompt === defaultVigglePrompt || !draft.settings.prompt.trim();
    update({ engine: target, ...(target === 'viggle' ? { mode: 'swap', fps: 24, orientation: 'source', resolution: '480', loraA: 'None', loraB: 'None' } : {}), ...(previousDefault ? { prompt: target === 'viggle' ? defaultVigglePrompt : defaultPrompt(draft.settings.mode) } : {}) });
  };
  const selectAsset = (kind: 'video' | 'image', asset: Asset | null) => {
    if (kind === 'video' && asset && !normalizeClip({ start: 0, seconds: DEFAULT_CLIP_SECONDS }, asset.duration, draft.settings.fps)) { setMessage('This video is too short. Choose a video with at least five frames.'); return; }
    if (asset) setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old);
    setDraft(old => ({ ...old, [kind === 'video' ? 'sourceId' : 'referenceId']: asset?.id || null, settings: { ...old.settings, prompt: migrateDemoPrompt(old.settings.prompt, old.settings.mode), ...(kind === 'video' && asset ? normalizeClip({ start: 0, seconds: DEFAULT_CLIP_SECONDS }, asset.duration, old.settings.fps) : {}) } }));
  };
  const patch = async (job: Job, changes: Partial<Job>) => { try { const updated = await api<Job>('/jobs/' + job.id, changes, 'PATCH'); setData(old => old ? { ...old, jobs: old.jobs.map(item => item.id === updated.id ? updated : item) } : old); } catch (e) { setMessage((e as Error).message); } };
  const reuse = (job: Job) => { if (isImageJob(job) && job.image) { setImageDraft({ sourceId: job.sourceId, referenceId: job.referenceId, maskId: job.image.maskId, faceId: job.image.faceId, settings: { ...job.image.settings, randomSeed: false } }); setSelectedId(job.id); setView('image'); toast.success('Image inputs and settings loaded.'); return; } const original = assets.find(asset => asset.id === job.sourceId); const clip = original ? normalizeClip(job.settings, original.duration, job.settings.fps) : null; setDraft({ sourceId: job.sourceId, referenceId: job.referenceId, settings: { ...defaults, ...job.settings, ...clip, viggleReferenceMode: referenceModeForRun(job), prompt: migrateDemoPrompt(job.settings.prompt, job.settings.mode), randomSeed: false } }); setView('create'); setSelectedId(job.id); toast.success('Inputs and settings loaded.'); };
  const generate = useCallback(async () => {
    if (creating || !online || !valid || !modelsReady || modelState.busy) return;
    setCreating(true); setMessage(''); requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId.current }, body: JSON.stringify({ sourceId: draft.sourceId, referenceId: draft.referenceId, settings: draft.settings }) });
      const result = await response.json(); if (!response.ok) { requestId.current = null; throw new Error(result.error); }
      requestId.current = null; setData(old => old ? { ...old, jobs: [result, ...old.jobs.filter(j => j.id !== result.id)] } : old); setSelectedId(result.id); setView('create'); setCompare(false);
    } catch (e) { setMessage((e as Error).message); } finally { setCreating(false); }
  }, [creating, online, valid, draft, modelsReady, modelState.busy]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (view === 'create' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void generate(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [generate, view]);
  const closePreview = () => { setSelectedId(null); setCompare(false); setInfo(false); };
  const handleJobAction = async (action: 'cancel' | 'resume') => { if (!selected) return; try { await api(`/jobs/${selected.id}/${action}`, action === 'resume' ? { retryMissing: !!selected.retryRequired } : {}); } catch (e) { setMessage((e as Error).message); } };
  const setCloud = useCallback((cloud: CloudState) => setData(old => old ? { ...old, cloud } : old), []);
  if (!data) return <div className="app-loading"><Aperture size={40} weight="light" /><h1>Recast Studio</h1><span className="activity-line" /><p>{message || 'Opening your local workspace'}</p>{message && <button className="secondary-button" onClick={() => location.reload()}>Retry</button>}</div>;
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <header className="topbar">
      <button className="brand-mark" onClick={() => setView('create')} aria-label="Recast home"><Aperture weight="bold" size={28} /><span className="wordmark">recast<span>studio</span></span></button>
      <div className="topbar-controls"><button className={`connection-button ${data.cloud.busy ? 'connecting' : connection!.state}`} onClick={() => setView('gpu')} title={data.cloud.busy ? 'Preparing GPU' : online ? connection!.gpu || 'GPU connected' : connection!.state === 'connecting' ? 'Connecting' : 'GPU offline'}><span className="status-dot" />{data.cloud.busy ? 'Preparing GPU' : online ? connection!.gpu || 'GPU connected' : connection!.state === 'connecting' ? 'Connecting' : 'GPU offline'}<CaretDown size={12} /></button>
        <button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>
    <Sidebar view={view} select={setView} collapsed={sidebarCollapsed} toggle={toggleSidebar} libraryCount={jobs.filter(j => !j.deleted).length} />
    {view === 'settings' ? <SettingsWorkspace tab={settingsTab} onTabChange={setSettingsTab} connection={connection!} error={setMessage} browse={() => setView('gpu')} downloads={<DownloadsWorkspace controls={downloads} required={[...new Set([...requiredFiles, ...imageFilesForSettings(imageDraft.settings)])]} refresh={refreshModels} cancel={cancelDownloads} setup={() => setView('gpu')} />} models={<ModelsWorkspace controls={downloads} required={requiredFiles} missingCustom={missingCustom} refresh={refreshModels} cancel={cancelDownloads} setup={() => setView('gpu')} useLora={name => { setDraft(old => ({ ...old, settings: { ...old.settings, engine: 'scail2', loraA: name, loraAStrength: name === SOCIAL_STYLE ? 0.35 : 0.8 } })); setView('create'); }} />} /> : view === 'gpu' ? <Suspense fallback={<main className="gpu-loading">Opening GPU cloud</main>}><GpuWorkspace cloud={data.cloud} setCloud={setCloud} notify={setMessage} onCreate={() => setView('create')} /></Suspense> : view === 'image' ? <Suspense fallback={<main className="gpu-loading">Opening image replacement</main>}><ImageWorkspace data={data} motionDraft={draft} draft={imageDraft} setDraft={setImageDraft} downloads={downloads} selectedId={selectedId} select={setSelectedId} close={closePreview} asset={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} job={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} error={setMessage} openModels={openModels} openGPU={() => setView('gpu')} library={() => setView('library')} motion={(asset, nextDraft) => { setDraft(nextDraft); setData(old => old ? { ...old, draft: nextDraft, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old); setSelectedId(null); setView('create'); }} /></Suspense> : view === 'create' ? <main className="create-layout workflow-layout motion-layout"><section className="editor motion-editor"><div className="editor-scroll">
      <div className="editor-heading"><span className="section-icon"><FilmStrip size={19} /></span><h1>Motion control</h1></div>
      <p className="editor-description">New character. Same performance.</p>
      <EditorDisclosure title="Model & mode" meta={`${engine ? 'Viggle' : 'SCAIL-2'} · ${draft.settings.mode === 'swap' ? 'Character swap' : 'Motion transfer'}`}>
        <div className="engine-select full-label"><FieldLabel label="Video model" help={engine ? "Viggle is experimental: benchmark speed and visual quality on your GPU. Start at 480p with a short movement-focused shot; speech sync is unvalidated. Its matching accelerator is included; SCAIL/Wan style and relighting adapters do not apply." : "Choose the video model before downloading the files for your settings."} /><SmallSelect label="Video model" value={draft.settings.engine} onChange={changeEngine} options={[{ value: 'scail2', label: 'SCAIL-2 · current workflow' }, { value: 'viggle', label: 'Viggle Animate · experimental' }]} /></div>
        <div className="mode-tabs" role="group" aria-label="Generation mode"><button aria-pressed={draft.settings.mode === 'swap'} className={draft.settings.mode === 'swap' ? 'active' : ''} onClick={() => update({ mode: 'swap' })}>Character swap</button><button aria-pressed={draft.settings.mode === 'motion'} className={draft.settings.mode === 'motion' ? 'active' : ''} disabled={engine} title={engine ? 'Choose SCAIL-2 for motion transfer' : undefined} onClick={() => update({ mode: 'motion' })}>Motion transfer</button></div>
      </EditorDisclosure>
      <EditorSection title="Inputs">
        <div className="input-pair"><AssetDrop kind="video" help="The video supplies motion, timing, screen position, scale and camera framing. Click the preview to choose the clip range." asset={source} onAsset={a => selectAsset('video', a)} onError={setMessage} clip={{ start: draft.settings.start, seconds: draft.settings.seconds }} clipFps={draft.settings.fps} onClip={clip => update(clip)} /><AssetDrop kind="image" help={engine ? "Use a source-aligned edited frame to anchor character appearance, scale and scene lighting." : "The reference supplies the replacement character’s appearance."} asset={reference} onAsset={a => selectAsset('image', a)} onError={setMessage} /></div>
        {engine && <p className="editor-inline-note">Use one continuous shot with one main character.</p>}
      </EditorSection>
      <PromptEditor id="prompt" inputRef={promptRef} label={engine ? 'Frame edit prompt' : 'Prompt'} value={draft.settings.prompt} onChange={prompt => update({ prompt })} defaultValue={engine ? defaultVigglePrompt : defaultPrompt(draft.settings.mode)} disabled={engine && draft.settings.referencePreparation === 'prepared'} help={engine ? 'Used only for automatic frame preparation. An already edited frame controls character appearance directly.' : 'Leave empty to use the default prompt. Add only the details you want to refine.'} />
      <EditorSection title="Output">
        <div className="settings-grid"><div className="download-field"><FieldLabel label="Quality" help={engine ? "Viggle uses its matching distilled adapter: Fast runs three video passes; Balanced runs five." : samplingNote(draft.settings.preset)} />{engine ? <SmallSelect label="Viggle quality" value={draft.settings.viggleQuality} onChange={v => update({ viggleQuality: v as Settings['viggleQuality'] })} options={[{ value: 'fast', label: 'Fast · 3 video passes' }, { value: 'balanced', label: 'Balanced · 5 video passes' }]} /> : <DownloadSelect label="Quality preset" value={draft.settings.preset} onChange={v => update({ preset: v as Settings['preset'] })} options={samplingOptions.map(option => ({ ...option, files: presetModelFiles(option.value, draft.settings.mode) }))} controls={downloads} />}</div><div className="full-label compact-field"><FieldLabel label="Resolution" help="720p exports render slightly larger, then downsample the full frame. This takes more time and memory than 704p." /><SmallSelect label="Resolution" value={draft.settings.resolution} onChange={v => update({ resolution: v as Settings['resolution'] })} options={[{ value: '480', label: '480p' }, { value: '704', label: '704p' }, { value: '720', label: '720p / HD export' }]} /></div></div>
        {engine ? <div className="native-frame-rate"><span>Frame rate</span><strong>24 fps <small>Native</small></strong></div> : <label className="full-label">Frame rate<SmallSelect label="Frame rate" value={String(draft.settings.fps)} onChange={v => update({ fps: Number(v) as 16 | 24 | 30 })} options={[{ value: '16', label: '16 fps' }, { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }]} /></label>}
        {source && <dl className="output-summary"><div><dt>Dimensions</dt><dd>{width} × {height}</dd></div><div><dt>Length</dt><dd>{draft.settings.seconds.toFixed(2)}s</dd></div><div><dt>Frames</dt><dd>{clipFrameCount(draft.settings.seconds, draft.settings.fps)}</dd></div></dl>}
        {engine && draft.settings.seconds * 24 > 124 && draft.settings.seconds <= MAX_CLIP_SECONDS && <div className="segment-summary"><span><strong>{viggleWindows(clipFrameCount(draft.settings.seconds, 24)).length} segments</strong><small>Longer clips use more compute.</small></span><InfoTip label="Video segments">{draft.settings.viggleReferenceMode === 'previous' ? 'Previous-frame appearance handoff.' : 'Original-frame appearance reference.'} Each segment and its anchor are saved before the next starts. Use one continuous shot for the best continuity.</InfoTip></div>}
        {!engine && draft.settings.mode === 'motion' && <div className="preset-note"><Info size={15} /><span>Motion transfer uses the reference scene. This mode has not been GPU-tested in this app.</span></div>}
      </EditorSection>
      {engineError && <p className="model-page-error" role="alert">{engineError}</p>}
      <RequiredFiles files={requiredFiles} controls={downloads} manage={openModels} setup={() => setView('gpu')} />
      <EditorDisclosure title="Advanced settings" meta={engine ? 'Reference & seed' : 'Adapters & framing'}><Advanced settings={draft.settings} update={update} loras={connection!.loras} downloads={downloads} /></EditorDisclosure>
    </div><div className="generate-footer"><button className="primary-button generate" disabled={!online || !valid || creating || !modelsReady || modelState.busy} onClick={() => void generate()}><Sparkle size={18} weight="fill" />{creating ? 'Submitting...' : 'Generate'}<kbd>⌘ ↵</kbd></button><div className="generate-caption">{!online ? <><Plug size={12} /><button onClick={() => setView('gpu')}>Connect GPU to generate</button></> : !modelsReady || modelState.busy ? <><DownloadSimple size={12} /><button onClick={() => { const panel = document.querySelector<HTMLDetailsElement>('.required-file-details'); if (panel) { panel.open = true; panel.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }}>{modelState.busy ? 'Downloading selected model files' : 'Download files for these settings above'}</button></> : !valid ? 'Add both inputs and choose a valid clip range.' : <><CheckCircle size={12} />Ready on your GPU</>}</div></div></section>
    <section className={`workspace ${selected ? '' : 'workspace-idle'}`}><div className="workspace-header"><div><span className="workspace-overline">YOUR WORKSPACE</span><h2>{selected?.title || 'Preview'}</h2></div><div className="workspace-actions">{selected?.status === 'completed' && <><button className="icon-button" title="Render details" aria-label="Render details" onClick={() => setInfo(true)}><Info size={18} /></button><button className="icon-button" title="Reuse settings" aria-label="Reuse selected render settings" onClick={() => reuse(selected)}><ArrowCounterClockwise size={18} /></button><a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`}><DownloadSimple size={15} />Download</a></>}{selected && <button type="button" className="icon-button close-preview" aria-label="Close video preview" title="Close preview · keep inputs and settings" onClick={closePreview}><X size={18} /></button>}</div></div>
      {selected && <FramingNotice job={selected} onCompare={() => setCompare(true)} />}
      <div className={`preview-stage ${selected?.status === 'completed' ? 'has-result' : ''}`}>
        {selected?.status === 'completed' ? <><div className="preview-toolbar"><div className="preview-tabs"><button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}>Result</button><button className={compare ? 'active' : ''} onClick={() => setCompare(true)}>Compare</button></div><span className={`result-indicator ${selectedFramingNotice ? 'needs-review' : ''}`}>{selectedFramingNotice ? <WarningCircle size={12} /> : <Check size={12} />}{selectedFramingNotice?.badge || (selected.origin === 'import' ? 'Previous GPU render' : 'Completed')}</span></div><VideoPlayer job={selected} compare={compare} /></> : selected ? <ProgressPanel job={selected} online={online} onCancel={() => void handleJobAction('cancel')} onResume={() => void handleJobAction('resume')} onReuse={() => reuse(selected)} /> : <WorkspaceWelcome kind="video" library={() => setView('library')} openActive={activeVideo ? () => setSelectedId(activeVideo.id) : undefined} />}
      </div>{selected && <div className="workspace-bottom"><div className="recent-heading"><h3>Recent creations <span>{jobs.filter(j => !j.deleted).length}</span></h3><button onClick={() => setView('library')}>View library <CaretRight size={13} /></button></div><div className="recent-grid">{recent.map(job => <JobCard key={job.id} job={job} selected={job.id === selected?.id} onSelect={() => { setSelectedId(job.id); setCompare(false); }} onPatch={v => void patch(job, v)} onReuse={() => reuse(job)} />)}{!recent.length && <div className="empty-recent">Your generated videos will appear here.</div>}</div></div>}
    </section></main> : <Suspense fallback={<main className="gpu-loading">Opening your library</main>}><LibraryWorkspace jobs={jobs} assets={assets} patch={patch} reuse={reuse} create={() => { closePreview(); setView('create'); }} openWorkspace={job => { setSelectedId(job.id); setView(isImageJob(job) ? 'image' : 'create'); }} /></Suspense>}

    <Toaster theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton visibleToasts={3} toastOptions={{ className: 'recast-toast' }} />
    {selected && <RunDetailsDialog job={selected} jobs={jobs} assets={assets} open={info} close={() => setInfo(false)} patch={changes => patch(selected, changes)} reuse={() => { reuse(selected); setInfo(false); }} openWorkspace={() => setInfo(false)} />}

  </div>;
}
