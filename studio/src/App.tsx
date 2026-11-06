import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FieldLabel, InfoTip } from './InfoTip';
import { EditorDisclosure, EditorSection, PromptEditor } from './EditorControls';
import { Aperture, ArrowCounterClockwise, CaretDown, CaretRight, Check, CheckCircle, DownloadSimple, FilmStrip, Info, Moon, Plug, Sparkle, Sun, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, Bootstrap, Draft, Job, Settings } from '../shared/types';
import { defaults, geometry, settingsSchema } from '../shared/types';
import { defaultPrompt, migrateDemoPrompt, promptAfterModeChange } from '../shared/prompts';
import { api, AssetDrop, SmallSelect, Toggle, VideoPlayer } from './components';
import type { CloudState } from '../shared/cloud';
import {newestCloudState} from '../shared/cloud';
import {gpuPowerTarget} from '../shared/gpu-power';
import CloudStatusSync from './CloudStatusSync';
import { setupNotice } from '../shared/cloud-status';
import { framingNotice, FramingWarningTracker } from '../shared/framing-status';
import { defaultVigglePrompt, engineIssue, isViggle, migrateVigglePrompt, referenceModeForRun } from '../shared/engines';
import { emptyModels, IMAGE_IDENTITY, imageFilesForSettings, imageModelFiles, modelDefinitions, modelFilesForSettings, type ModelsState } from '../shared/models';
import ModelsWorkspace, { DownloadSelect, modelSize, type DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import { moduleNames, type ModuleDownloadRequest } from '../shared/module-downloads';
import FramingNotice from './FramingNotice';
import DownloadsWorkspace from './DownloadsWorkspace';
import { downloadRows, modelUsage } from '../shared/downloads';
import Sidebar, { initialSidebarCollapsed, type WorkspaceView } from './Sidebar';
import SettingsWorkspace, { type SettingsTab } from './SettingsWorkspace';
import { Toaster, toast } from 'sonner';
import { clipFrameCount, normalizeClip, clampClipEnd, DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS } from '../shared/clip';
import { viggleWindows } from '../shared/viggle-segments';
import { emptyImageEditDraft, imageEditDraftForJob, imageEditFiles, isImageEditJob, type ImageEditDraft } from '../shared/image-edit';
import { emptyImageDraft, isImageJob, type ImageDraft } from '../shared/image-replacement';
import { imagenSettings } from '../shared/imagen';
import { useCharacterDraft, type Character } from '../shared/characters';
import RemotionCharacterRefresh from './RemotionCharacterRefresh';
import './characters.css';
const CharactersWorkspace = lazy(() => import('./CharactersWorkspace'));
const GpuWorkspace = lazy(() => import('./GpuWorkspace'));
const ImageEditWorkspace = lazy(() => import('./ImageEditWorkspace'));
const ImageWorkspace = lazy(() => import('./ImageWorkspace'));
const LibraryWorkspace = lazy(() => import('./LibraryWorkspace'));
const ClarityWorkspace = lazy(() => import('./ClarityWorkspace'));
const ClipEditorWorkspace = lazy(() => import('./ClipEditorWorkspace'));
import JobCard from './JobCard';
import RunDetailsDialog from './RunDetailsDialog';
import WorkspaceWelcome from './WorkspaceWelcome';
import GenerationProgress from './GenerationProgress';
import { FaceRefinementProgress } from './FaceRefinement';
import { useOutputPresentation } from './useGenerationProgress';
import { useActivityAlerts } from './useActivityAlerts';
import type { AlertTarget } from '../shared/alerts';
import type { EditorIntent } from './ClipEditorWorkspace';
import GpuPowerControl from './GpuPowerControl';
import FacialConsistencyControls from './FacialConsistencyControls';
import { facialRuntimeReadyForSettings } from '../shared/facial-consistency';
import AnchorReferenceControls from './AnchorReferenceControls';
import { videoDirectionFrames } from '../shared/anchored-video';

const activeStates = ['queued', 'running', 'reconnecting'];
function Advanced({ settings: s, update, downloads, source, reference }: { settings: Settings; update: (v: Partial<Settings>) => void; downloads: DownloadControls; source?: Asset; reference?: Asset }) {
  const kleinReady = imageModelFiles.every(id => downloads.state.files.find(file => file.id === id)?.status === 'installed');
  return <div className="advanced-body">
    <FacialConsistencyControls value={s.facialConsistency} change={v => update({ facialConsistency: v })} downloads={downloads} sceneMatch={s.facialSceneMatch} changeSceneMatch={v => update({ facialSceneMatch: v })} cleanup={s.facialFeatureCleanup} changeCleanup={v => update({ facialFeatureCleanup: v })} eyeCalibration={s.facialEyeCalibration} changeEyeCalibration={v => update({ facialEyeCalibration: v })} eyeFinish={s.facialEyeFinish} changeEyeFinish={v => update({ facialEyeFinish: v })} boundaryBlend={s.facialBoundaryBlend} changeBoundaryBlend={v => update({ facialBoundaryBlend: v })} occlusionTracking={s.facialOcclusionTracking} changeOcclusionTracking={v => update({ facialOcclusionTracking: v })} />
    <div className="full-label"><FieldLabel label="Reference preparation" help={s.referencePreparation === 'prepared' ? 'Upload a frame from this exact shot with the character already replaced. This skips image editing and its downloads.' : 'The image editor first puts your character into a source frame, preserving pose, camera distance and scene lighting. Changing an option starts no downloads.'} />
      <DownloadSelect label="Reference preparation" value={s.referencePreparation} controls={downloads} onChange={v => update({ referencePreparation: v as Settings['referencePreparation'] })} options={[{ value: 'auto', label: 'Automatic · match character to source frame', files: imageModelFiles, disabled: s.imagenRepaintEnabled, disabledReason: s.imagenRepaintEnabled ? 'Segment refresh uses an already edited starting frame.' : downloads.online ? 'Choose Automatic, then use Download Remotion below to prepare Klein.' : 'Connect your GPU to check whether Klein is installed.' }, { value: 'prepared', label: 'Use an already edited source frame', files: [] }]} />
    </div>
    <AnchorReferenceControls settings={s} source={source} reference={reference} change={update} />
    {!kleinReady && s.referencePreparation === 'auto' && <p className="field-hint">Automatic preparation needs Klein. Prepare a frame in Imagen, or choose Automatic and use Download Remotion below.</p>}
    {!s.imagenRepaintEnabled && <div className="full-label"><FieldLabel label="Segment reference" help={<>{s.viggleReferenceMode === 'previous' ? 'New long clips carry the last generated appearance and the complete overlapping motion range into the next segment. Small identity errors can also carry forward.' : 'Long clips keep the original prepared frame as the appearance reference for every segment, with five-frame motion anchors.'} Saved runs keep their recorded continuation recipe.</>} />
      <SmallSelect label="Segment reference" value={s.viggleReferenceMode} onChange={v => update({ viggleReferenceMode: v as Settings['viggleReferenceMode'] })} options={[{ value: 'previous', label: 'Previous segment’s last frame' }, { value: 'original', label: 'Original prepared frame' }]} />
    </div>}
    <Toggle label="Random seed" checked={s.randomSeed} onChange={v => update({ randomSeed: v })} detail="Use a new seed for each generation. Turn off to keep a fixed seed." />
    {!s.randomSeed && <label className="full-label">Seed<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} value={s.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>}
  </div>;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null), [draft, setDraft] = useState<Draft>({ sourceId: null, referenceId: null, settings: defaults });
  const [imageEditDraft, setImageEditDraft] = useState<ImageEditDraft>(emptyImageEditDraft);
  const [imageDraft, setImageDraft] = useState<ImageDraft>(emptyImageDraft);
  const [preparingFrame, setPreparingFrame] = useState(false);
  const [editorIntent, setEditorIntent] = useState<EditorIntent | null>(null);
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
  const openAlert = useCallback((target: AlertTarget) => {
    setInfo(!!target.repair);
    if (target.view === 'downloads' || target.view === 'alerts') { setSettingsTab(target.view); setView('settings'); }
    else setView(target.view);
    if (target.jobId) { setSelectedId(target.jobId); setCompare(false); }
  }, []);
  useActivityAlerts(data, openAlert);
  const seenNotices = useRef(new Set<string>());
  const renderStates = useRef(new Map<string, string>());
  useEffect(() => { for (const job of data?.jobs || []) if (job.status === 'running') for (const record of job.viggleRepaint?.records || []) { const key = `repaint-skip-${job.id}-${record.segment}`; if (record.warning && !seenNotices.current.has(key)) { seenNotices.current.add(key); toast.warning('Face refresh skipped', { description: record.warning, duration: 10000 }); } } }, [data?.jobs]);
  useEffect(() => {
    for (const job of data?.jobs || []) {
      const state = `${job.status}:${job.error || ''}`, previous = renderStates.current.get(job.id);
      renderStates.current.set(job.id, state);
      if (!previous || previous === state) continue;
      if (job.status === 'reconnecting') toast.warning('Restoring GPU connection', { id: `render-${job.id}`, description: 'Checking the existing job. No new segment has been submitted.' });
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
    setData(old=>old?{...value,cloud:newestCloudState(old.cloud,value.cloud)}:value);
    if (!initialized.current) { initialized.current = true; const settings = { ...defaults, ...value.draft.settings, prompt: migrateVigglePrompt(migrateDemoPrompt(value.draft.settings.prompt, value.draft.settings.mode)) }; const source = value.assets.find(asset => asset.id === value.draft.sourceId); const clip = source ? clampClipEnd(settings, source.duration, settings.fps) : null; setDraft({ ...value.draft, settings: { ...settings, ...clip } }); setImageDraft(value.imageDraft || emptyImageDraft()); setImageEditDraft(value.imageEditDraft || emptyImageEditDraft()); }
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
      else if (e.type === 'character') setData(old => old ? { ...old, characters: [e.data, ...(old.characters || []).filter(c => c.id !== e.data.id)] } : old);
      else if (e.type === 'connection') setData(old => old ? { ...old, connection: e.data } : old);
      else if (e.type === 'cloud') setData(old => old ? { ...old, cloud: newestCloudState(old.cloud,e.data) } : old);
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
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => { void api('/image-edit/draft', imageEditDraft).catch(e => setMessage('Image Edit draft not saved: ' + e.message)); }, 500);
    return () => clearTimeout(timer);
  }, [imageEditDraft, setMessage]);
  const refreshModels = useCallback(() => {
    void api<ModelsState>('/models').then(models => setData(old => old ? { ...old, models } : old)).catch(error => setMessage(error.message));
  }, [setMessage]);
  useEffect(() => { if (data && !data.cloud.busy) refreshModels(); }, [data?.connection.state, data?.connection.checkedAt, data?.cloud.busy, refreshModels]);
  useEffect(() => {
    for (const file of data?.models?.files || []) {
      if (file.message.includes('longer than') && !seenNotices.current.has('slow-' + file.id)) { seenNotices.current.add('slow-' + file.id); toast.warning('Download is taking longer than usual', { description: 'The transfer is still running. You can cancel and resume it.' }); }
    }
  }, [data?.models]);
  const downloadModels = useCallback((files: string[]) => {
    void api<ModelsState>('/models/download', { files }).then(models => { setData(old => old ? { ...old, models } : old); toast.message('Downloads queued', { description: 'Only the files you requested will be installed.' }); }).catch(error => setMessage(error.message));
  }, [setMessage]);
  const prepareModule=useCallback(async(request:ModuleDownloadRequest)=>{
    const models=await api<ModelsState>('/models/module',request);setData(old=>old?{...old,models}:old);
    toast.message('Preparing '+moduleNames[request.module],{description:'Only files and tools for the selected settings. Generation starts separately.'});
  },[]);
  const recoverDownloads=useCallback(()=>{void api<ModelsState>('/models/recover',{}).then(models=>setData(old=>old?{...old,models}:old)).catch(error=>setMessage(error.message));},[setMessage]);
  const cancelDownloads = useCallback(() => { void api<ModelsState>('/models/cancel', {}).then(models => { setData(old => old ? { ...old, models } : old); toast.message(models.busy?'Cancellation requested. Waiting for confirmation.':'Downloads cancelled. Partial files are kept.'); }).catch(error => setMessage(error.message)); }, [setMessage]);
  const removeModel = useCallback((name: string) => {
    const state = data?.models;
    const file = state ? downloadRows(state, state.inventories?.find(item => item.checkedAt === state.checkedAt), true).find(file => file.id === name) : undefined;
    const label = file?.label || name.split('/').at(-1);
    if (!window.confirm(`Delete ${label} from this GPU?\n\n${file ? modelSize(file.onDisk) + ' on disk.\n' : ''}Used by: ${modelUsage(name).map(usage => usage.workflow).join(', ')}.\nThese workflows will need this file downloaded again. Saved photos and videos are kept.`)) return;
    void api<{ freedBytes: number; models: ModelsState }>('/models/delete', { name }).then(result => {
      setData(old => old ? { ...old, models: result.models } : old);
      const lora = name.startsWith('loras/') ? name.slice(6) : name;
      setDraft(old => ({ ...old, settings: { ...old.settings, ...(old.settings.loraA === lora ? { loraA: 'None' } : {}), ...(old.settings.loraB === lora ? { loraB: 'None' } : {}) } }));
      toast.success('File deleted', { description: `${modelSize(result.freedBytes)} removed from your GPU. Available disk space has been refreshed.` });
    }).catch(error => setMessage(error.message));
  }, [data?.models, setMessage]);
  const assets = data?.assets || [], jobs = data?.jobs || [], connection = data?.connection;
  const source = assets.find(a => a.id === draft.sourceId), reference = assets.find(a => a.id === draft.referenceId);
  const selected = jobs.find(j => j.id === selectedId && !j.deleted && !isImageJob(j));
  const activeVideo = jobs.find(job => !job.anchorChild && !job.deleted && !isImageJob(job) && activeStates.includes(job.status));
  const showResult = useOutputPresentation(selected);
  const selectedFramingNotice = selected ? framingNotice(selected) : null;
  const recent = jobs.filter(j => !j.anchorChild && !j.deleted && !isImageJob(j)).slice(0, 6), online = connection?.state === 'online';
  const modelState = data?.models || emptyModels();
  const requiredFiles = modelFilesForSettings(draft.settings);
  const missingCustom = (isViggle(draft.settings) ? [] : [draft.settings.loraA, draft.settings.loraB]).filter(name => name !== 'None' && !connection?.loras.includes(name) && !modelDefinitions.some(file => file.filename === name));
  const modelFilesReady = requiredFiles.every(id => modelState.files.find(file => file.id === id)?.status === 'installed');
  const facialToolsMissing = !facialRuntimeReadyForSettings(draft.settings, modelState);
  const nativeToolsMissing = isViggle(draft.settings) && modelState.viggleToolsReady !== true;
  const modelsReady = modelFilesReady &&
    (isViggle(draft.settings)||[draft.settings.loraA, draft.settings.loraB].every(name => name === 'None' || connection?.loras.includes(name))) && !nativeToolsMissing && facialRuntimeReadyForSettings(draft.settings, modelState);
  const downloads: DownloadControls = { state: modelState, online, blocked: !!data?.cloud.busy || jobs.some(job => activeStates.includes(job.status)), settingUp: !!data?.cloud.busy, download: downloadModels, remove: removeModel, updated: models => setData(old => old ? { ...old, models } : old), prepareModule,cancel:cancelDownloads,refresh:refreshModels,recover:recoverDownloads };
  const [width, height] = geometry(draft.settings, source || { width: 480, height: 832 });
  const repaintProfile = draft.settings.imagenRepaint;
  const startingPhoto = repaintProfile?.sourceImageJobId ? jobs.find(j => j.id === repaintProfile.sourceImageJobId) : null;
  useEffect(()=>{
    const input=assets.find(asset=>asset.id===draft.sourceId);if(!input)return;
    setDraft(old=>{if(old.sourceId!==input.id)return old;const clip=clampClipEnd(old.settings,input.duration,old.settings.fps);return clip&&(clip.start!==old.settings.start||clip.seconds!==old.settings.seconds)?{...old,settings:{...old.settings,...clip}}:old;});
  },[assets,draft.sourceId,draft.settings.fps]);
  const startingFrame = assets.find(a => a.id === startingPhoto?.sourceId)?.sourceFrame;
  const selectedRepaintCharacter = repaintProfile && !repaintProfile.sourceImageJobId ? data?.characters?.find(c => c.id === repaintProfile.characterId) : null;
  const repaintProfileIssue = draft.settings.imagenRepaintEnabled && repaintProfile && !repaintProfile.sourceImageJobId && (!selectedRepaintCharacter || selectedRepaintCharacter.archived || selectedRepaintCharacter.revision !== repaintProfile.revision) ? 'Reload the saved character before generating.' : null;
  const repaintFrameIssue = draft.settings.imagenRepaintEnabled && startingFrame && (startingFrame.videoId !== draft.sourceId || Math.abs(startingFrame.time - (draft.settings.referenceTime ?? draft.settings.start)) > 1 / 48) ? 'Match the reference frame position to the saved Imagen source moment.' : null;
  const engine = isViggle(draft.settings), engineError = engineIssue(draft.settings) || repaintProfileIssue || repaintFrameIssue || (draft.settings.imagenRepaintEnabled && !data?.capabilities?.imagenSegmentRepaint ? 'The local app update must finish before segment refresh can run.' : null);
  const generationSegments = videoDirectionFrames(draft.settings).reduce((sum, frames) => sum + viggleWindows(frames).length, 0);
  const valid = engine && !engineError && settingsSchema.safeParse(draft.settings).success && draft.settings.seconds <= MAX_CLIP_SECONDS && !!source && !!reference && draft.settings.start + draft.settings.seconds <= (source?.duration || 0) + 1 / draft.settings.fps && draft.settings.seconds * draft.settings.fps >= 5;
  const update = (changes: Partial<Settings>) => setDraft(old => {
    const settings = { ...old.settings, ...(changes.mode && changes.prompt === undefined ? { prompt: promptAfterModeChange(old.settings.prompt, changes.mode) } : {}), ...changes };
    const input = assets.find(asset => asset.id === old.sourceId);
    const clip = input && ['fps', 'start', 'seconds', 'engine'].some(key => key in changes) ? normalizeClip(settings, input.duration, settings.fps) : null;
    return { ...old, settings: { ...settings, ...clip } };
  });
  const changeEngine = (value: string) => {
    if (value !== 'viggle') return;
    const target = value as Settings['engine'];
    const previousDefault = draft.settings.prompt === defaultPrompt(draft.settings.mode) || migrateVigglePrompt(draft.settings.prompt) === defaultVigglePrompt || !draft.settings.prompt.trim();
    update({ engine: target, ...(target === 'viggle' ? { mode: 'swap', fps: 24, orientation: 'source', resolution: '480', loraA: 'None', loraB: 'None' } : {}), ...(previousDefault ? { prompt: target === 'viggle' ? defaultVigglePrompt : defaultPrompt(draft.settings.mode) } : {}) });
  };
  const selectAsset = (kind: 'video' | 'image', asset: Asset | null) => {
    if (kind === 'video' && asset && !normalizeClip({ start: 0, seconds: DEFAULT_CLIP_SECONDS }, asset.duration, draft.settings.fps)) { setMessage('This video is too short. Choose a video with at least five frames.'); return; }
    if (asset) setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old);
    setDraft(old => ({ ...old, [kind === 'video' ? 'sourceId' : 'referenceId']: asset?.id || null, settings: { ...old.settings, referenceTime: kind === 'image' && asset?.sourceFrame?.videoId === old.sourceId ? asset.sourceFrame.time : null, ...(kind === 'image' && old.settings.imagenRepaint ? { imagenRepaint: { ...old.settings.imagenRepaint, sourceImageJobId: null } } : {}), prompt: migrateDemoPrompt(old.settings.prompt, old.settings.mode), ...(kind === 'video' && asset ? normalizeClip({ start: 0, seconds: DEFAULT_CLIP_SECONDS }, asset.duration, old.settings.fps) : {}) } }));
  };
  const prepareCharacterFrame = async () => {
    const profile = draft.settings.imagenRepaint, character = data?.characters?.find(c => c.id === profile?.characterId && !c.archived);
    if (preparingFrame || !draft.sourceId || !profile?.bodyView || !profile.faceView || !character) return;
    if (character.revision !== profile.revision) { setMessage('Reload the character before preparing a new starting frame.'); return; }
    setPreparingFrame(true);
    try {
      const frame = await api<Asset>('/images/source-frame', { sourceId: draft.sourceId, time: draft.settings.referenceTime ?? draft.settings.start });
      setData(old => old ? { ...old, assets: [frame, ...old.assets.filter(a => a.id !== frame.id)] } : old);
      const next = useCharacterDraft({ ...emptyImageDraft(), sourceId: frame.id }, character);
      next.settings = imagenSettings({ ...next.settings, bodyReferenceView: profile.bodyView, faceReferenceView: profile.faceView }, 'character-outfit');
      setImageDraft(next); setSelectedId(null); setView('image'); toast.success('Reference frame ready in Imagen', { description: 'Character + outfit uses the reference coverage. Generate the starting frame, then use it in Remotion.' });
    } catch (e) { setMessage((e as Error).message); } finally { setPreparingFrame(false); }
  };
  const patch = async (job: Job, changes: Partial<Job>) => { try { const updated = await api<Job>('/jobs/' + job.id, changes, 'PATCH'); setData(old => old ? { ...old, jobs: old.jobs.map(item => item.id === updated.id ? updated : item) } : old); } catch (e) { setMessage((e as Error).message); } };
  const editVideo = (job: Job) => { setEditorIntent({ id: crypto.randomUUID(), ...(job.edit ? { receipt: job.edit, title: job.title } : { jobId: job.id }) }); setView('editor'); };
  const reuse = (job: Job) => { if (isImageEditJob(job)) { setImageEditDraft(imageEditDraftForJob(job)); setSelectedId(job.id); setView('image-edit'); toast.success('Image Edit inputs and settings loaded.'); return; } if (job.upscale) { try { localStorage.setItem('recast-clarity-draft', JSON.stringify({ source: job.upscale.source, settings: job.upscale.settings })); } catch { /* Preview remains available without storage. */ } setSelectedId(job.id); setView('clarity'); toast.success('Upscale inputs and settings loaded.'); return; } if (job.edit) { editVideo(job); return; } if (isImageJob(job) && job.image) { setImageDraft({ referenceMode: 'images', characterId: null, characterRevision: null, sourceId: job.sourceId, referenceId: job.referenceId, maskId: job.image.maskId, faceId: job.image.faceId, settings: { ...job.image.settings, randomSeed: false } }); setSelectedId(job.id); setView('image'); toast.success('Image inputs and settings loaded.'); return; } const original = assets.find(asset => asset.id === job.sourceId); const clip = original ? clampClipEnd(job.settings, original.duration, job.settings.fps) : null; setDraft({ sourceId: job.sourceId, referenceId: job.referenceId, settings: { ...defaults, ...job.settings, ...clip, facialOcclusionTracking: job.settings.facialOcclusionTracking === true, viggleReferenceMode: referenceModeForRun(job), prompt: migrateDemoPrompt(job.settings.prompt, job.settings.mode), randomSeed: false } }); setView('create'); setSelectedId(job.id); toast.success('Inputs and settings loaded.'); };
  const generate = useCallback(async () => {
    if (creating || !online || !valid || !modelsReady || modelState.busy) return;
    setCreating(true); setMessage(''); requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId.current }, body: JSON.stringify({ sourceId: draft.sourceId, referenceId: draft.referenceId, settings: draft.settings }) });
      const result = await response.json(); if (!response.ok) { requestId.current = null; throw new Error(result.error); }
      requestId.current = null; setData(old => old ? { ...old, jobs: [result, ...old.jobs.filter(j => j.id !== result.id)] } : old); setSelectedId(result.id); setView('create'); setCompare(false);
    } catch (e) { setMessage((e as Error).message); } finally { setCreating(false); }
  }, [creating, online, valid, draft, modelsReady, modelState.busy]);

  const closePreview = () => { setSelectedId(null); setCompare(false); setInfo(false); };
  const handleJobAction = async (action: 'cancel' | 'resume') => { if (!selected) return; try { await api(`/jobs/${selected.id}/${action}`, action === 'resume' ? { retryMissing: !!selected.retryRequired } : {}); } catch (e) { setMessage((e as Error).message); } };
  const setCloud = useCallback((cloud: CloudState) => setData(old => old ? { ...old, cloud:newestCloudState(old.cloud,cloud) } : old), []);
  if (!data) return <div className="app-loading"><Aperture size={40} weight="light" /><h1>Recast</h1><span className="activity-line" /><p>{message || 'Opening your local workspace'}</p>{message && <button className="secondary-button" onClick={() => location.reload()}>Retry</button>}</div>;
  const power=gpuPowerTarget(data.cloud),gpuPreparing=power?.view.preparing||power?.view.ending||power?.starting;
  const gpuLabel=data.cloud.error?'GPU status unavailable':power?.view.ending?power.view.label:power?.starting?'Resuming GPU':power?.view.stopped?'GPU paused':gpuPreparing?'Preparing GPU':online?connection!.gpu||'GPU connected':power?.instance.state==='running'?'GPU running · reconnect':connection!.state==='connecting'?'Connecting':'GPU offline';
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <CloudStatusSync cloud={data.cloud} setCloud={setCloud}/>
    <header className="topbar">
      <button className="brand-mark" onClick={() => setView('create')} aria-label="Recast home"><Aperture weight="bold" size={28} /><span className="wordmark">recast<span>studio</span></span></button>
      <div className="topbar-controls"><button className={`connection-button ${gpuPreparing?'connecting':power?.view.stopped||data.cloud.error?'offline':connection!.state}`} onClick={() => setView('gpu')} title={power?`${gpuLabel} · ${power.instance.gpu} #${power.instance.id}`:gpuLabel}><span className="status-dot" />{gpuLabel}<CaretDown size={12} /></button>
        <GpuPowerControl cloud={data.cloud} setCloud={setCloud} activeWork={modelState.busy || jobs.some(job => activeStates.includes(job.status) && job.faceRefinement?.execution !== 'local CPU')} browse={() => setView('gpu')} />
        <button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>
    <Sidebar view={view} select={setView} collapsed={sidebarCollapsed} toggle={toggleSidebar} libraryCount={jobs.filter(j => !j.deleted && !j.anchorChild).length} />
    {view === 'settings' ? <SettingsWorkspace tab={settingsTab} onTabChange={setSettingsTab} connection={connection!} cloud={data.cloud} setCloud={setCloud} error={setMessage} browse={() => setView('gpu')} downloads={<DownloadsWorkspace controls={downloads} required={[...new Set([...requiredFiles, ...imageFilesForSettings(imageDraft.settings), ...imageEditFiles(imageEditDraft.settings)])]} refresh={refreshModels} cancel={cancelDownloads} setup={() => setView('gpu')} />} models={<ModelsWorkspace controls={downloads} required={requiredFiles} missingCustom={missingCustom} refresh={refreshModels} cancel={cancelDownloads} setup={() => setView('gpu')} />} /> : view === 'gpu' ? <Suspense fallback={<main className="gpu-loading">Opening GPU cloud</main>}><GpuWorkspace cloud={data.cloud} setCloud={setCloud} notify={setMessage} onCreate={() => setView('create')} /></Suspense> : view === 'clarity' ? <Suspense fallback={<main className="gpu-loading">Opening Clarity</main>}><ClarityWorkspace library={() => setView('library')} data={data} downloads={downloads} selectedId={selectedId} select={setSelectedId} added={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} assetAdded={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} openGPU={() => setView('gpu')} openDownloads={() => { setSettingsTab('downloads'); setView('settings'); }} /></Suspense> : view === 'editor' ? <Suspense fallback={<main className="gpu-loading">Opening clip editor</main>}><ClipEditorWorkspace jobs={jobs} assets={assets} assetAdded={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} intent={editorIntent} consumed={id => setEditorIntent(old => old?.id === id ? null : old)} library={() => setView('library')} /></Suspense> : view === 'characters' ? <Suspense fallback={<main className="gpu-loading">Opening characters</main>}><CharactersWorkspace characters={data.characters || []} assets={assets} assetAdded={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} saved={(character: Character) => setData(old => old ? { ...old, characters: [character, ...(old.characters || []).filter(c => c.id !== character.id)] } : old)} use={character => { setImageDraft(old => useCharacterDraft(old, character)); setSelectedId(null); setView('image'); }} error={setMessage} /></Suspense> : view === 'image-edit' ? <Suspense fallback={<main className="gpu-loading">Opening Image Edit</main>}><ImageEditWorkspace data={data} draft={imageEditDraft} setDraft={setImageEditDraft} downloads={downloads} selectedId={selectedId} select={setSelectedId} close={closePreview} asset={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} job={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} error={setMessage} openDownloads={() => { setSettingsTab('downloads'); setView('settings'); }} openGPU={() => setView('gpu')} library={() => setView('library')} /></Suspense> : view === 'image' ? <Suspense fallback={<main className="gpu-loading">Opening Imagen</main>}><ImageWorkspace openCharacters={() => setView('characters')} data={data} motionDraft={draft} draft={imageDraft} setDraft={setImageDraft} downloads={downloads} selectedId={selectedId} select={setSelectedId} close={closePreview} asset={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} job={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} error={setMessage} openModels={openModels} openDownloads={()=>{setSettingsTab('downloads');setView('settings');}} openGPU={() => setView('gpu')} library={() => setView('library')} motion={(asset, nextDraft) => { setDraft(nextDraft); setData(old => old ? { ...old, draft: nextDraft, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old); setSelectedId(null); setView('create'); }} /></Suspense> : view === 'create' ? <main className="create-layout workflow-layout motion-layout"><section className="editor motion-editor"><div className="editor-scroll">
      <div className="editor-heading"><span className="section-icon"><FilmStrip size={19} /></span><h1>Remotion</h1></div>
      <p className="editor-description">New character. Same performance.</p>
      <div className="remotion-model-label"><span>Viggle Animate</span><InfoTip label="Remotion video model">Uses a repainted frame from the source shot to guide character appearance. Tracking through cuts, hidden faces and fast movement can still fail; inspect the finished clip.</InfoTip></div>
      {!engine && <div className="retired-workflow-notice" role="status"><p>This draft uses a retired video workflow. Its settings and saved runs are kept.</p><button className="secondary-button" onClick={() => changeEngine('viggle')}>Use Remotion for a new video</button></div>}
      <EditorSection title="Inputs">
        <div className="input-pair"><AssetDrop kind="video" help="The video supplies motion, timing, screen position, scale and camera framing. Click the preview to choose the clip range." asset={source} onAsset={a => selectAsset('video', a)} onError={setMessage} clip={{ start: draft.settings.start, seconds: draft.settings.seconds }} clipFps={draft.settings.fps} onClip={clip => update(clip)} /><AssetDrop kind="image" help={engine ? "Use a source-aligned edited frame to anchor character appearance, scale and scene lighting." : "The reference supplies the replacement character’s appearance."} asset={reference} onAsset={a => selectAsset('image', a)} onError={setMessage} /></div>
        {engine && <p className="editor-inline-note">Use one continuous shot with one main character.</p>}
      </EditorSection>
      {engine && <RemotionCharacterRefresh data={data} draft={draft} update={update} manage={() => setView('characters')} prepare={() => void prepareCharacterFrame()} preparing={preparingFrame} />}
      {engine && draft.settings.referencePreparation === 'auto' && <PromptEditor id="prompt" inputRef={promptRef} label="Frame edit prompt" value={draft.settings.prompt} onChange={prompt => update({ prompt })} defaultValue={defaultVigglePrompt} help="Used only to prepare the starting frame. The reference character’s coverage replaces the source outfit. It does not prompt the video model." />}
      {engine && <EditorSection title="Output">
        <div className="settings-grid"><div className="download-field"><FieldLabel label="Quality" help="Fast runs three video passes; Balanced runs five. More passes can improve some shots but do not guarantee identity or motion accuracy." /><SmallSelect label="Viggle quality" value={draft.settings.viggleQuality} onChange={v => update({ viggleQuality: v as Settings['viggleQuality'] })} options={[{ value: 'fast', label: 'Fast · 3 video passes' }, { value: 'balanced', label: 'Balanced · 5 video passes' }]} /></div><div className="full-label compact-field"><FieldLabel label="Resolution" help="720p exports render slightly larger, then downsample the full frame. This takes more time and memory than 704p." /><SmallSelect label="Resolution" value={draft.settings.resolution} onChange={v => update({ resolution: v as Settings['resolution'] })} options={[{ value: '480', label: '480p' }, { value: '704', label: '704p' }, { value: '720', label: '720p / HD export' }]} /></div></div>
        <div className="native-frame-rate"><span>Frame rate</span><strong>24 fps <small>Native</small></strong></div>
        {source && <dl className="output-summary"><div><dt>Dimensions</dt><dd>{width} × {height}</dd></div><div><dt>Length</dt><dd>{draft.settings.seconds.toFixed(2)}s</dd></div><div><dt>Frames</dt><dd>{clipFrameCount(draft.settings.seconds, draft.settings.fps)}</dd></div></dl>}
        {engine && draft.settings.seconds <= MAX_CLIP_SECONDS && generationSegments > 1 && <div className="segment-summary"><span><strong>{generationSegments} segments</strong><small>Additional segments use more compute.</small></span><InfoTip label="Video segments">{videoDirectionFrames(draft.settings).length > 1 && 'Later-frame references render earlier and later directions separately. '}{draft.settings.imagenRepaintEnabled ? 'Imagen can refresh facial identity between windows within each direction.' : draft.settings.viggleReferenceMode === 'previous' ? 'Previous-frame appearance handoff.' : 'Original-frame appearance reference.'} Each segment and its anchor are saved before the next starts. Use one continuous shot for the best continuity.</InfoTip></div>}
      </EditorSection>}
      {engineError && <p className="model-page-error" role="alert">{engineError}</p>}

      {engine && <EditorDisclosure title="Advanced settings" className="remotion-advanced" meta="Face, reference & seed"><Advanced settings={draft.settings} update={update} downloads={downloads} source={source} reference={reference} /></EditorDisclosure>}
    </div><ModuleAction request={{module:'remotion',settings:draft.settings}} controls={downloads} runtimeReady={!facialToolsMissing&&!nativeToolsMissing} runtimeNotes={[...(nativeToolsMissing?['Download Remotion also updates its video tools on your connected GPU. No extra video weights are needed.']:[]),...(draft.settings.facialConsistency!=='off'?['Selected facial tools are prepared automatically after their files download.']:[])]} generateDisabled={!valid||!modelsReady} submitting={creating} onGenerate={()=>void generate()} onConnect={()=>setView('gpu')} onManage={()=>{setSettingsTab('downloads');setView('settings');}} unavailable={!engine?'Select Viggle to create new videos.':missingCustom.length?'Upload the selected custom LoRA, or choose None.':null} caption={!valid?'Add both inputs and choose a valid clip range.':'Ready on your GPU'} /></section>
    <section className={`workspace ${selected ? '' : 'workspace-idle'}`}><div className="workspace-header"><div><span className="workspace-overline">YOUR WORKSPACE</span><h2>{selected?.title || 'Preview'}</h2></div><div className="workspace-actions">{showResult && selected && <><button className="icon-button" title="Render details" aria-label="Render details" onClick={() => setInfo(true)}><Info size={18} /></button><button className="icon-button" title="Reuse settings" aria-label="Reuse selected render settings" onClick={() => reuse(selected)}><ArrowCounterClockwise size={18} /></button><a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`}><DownloadSimple size={15} />Download</a></>}{selected && <button type="button" className="icon-button close-preview" aria-label="Close video preview" title="Close preview · keep inputs and settings" onClick={closePreview}><X size={18} /></button>}</div></div>
      {selected && <FramingNotice job={selected} onCompare={() => setCompare(true)} />}
      <div className={`preview-stage ${showResult ? 'has-result' : ''}`}>
        {showResult && selected ? <><div className="preview-toolbar"><div className="preview-tabs"><button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}>Result</button><button className={compare ? 'active' : ''} disabled={!!selected.edit} title={selected.edit ? 'A joined edit has multiple sources. Open its timeline to inspect them.' : undefined} onClick={() => setCompare(true)}>Compare</button></div><span className={`result-indicator ${selectedFramingNotice ? 'needs-review' : ''}`}>{selectedFramingNotice ? <WarningCircle size={12} /> : <Check size={12} />}{selectedFramingNotice?.badge || (selected.faceRefinement ? 'Face refined locally' : selected.origin === 'import' ? 'Previous GPU render' : 'Completed')}</span></div><VideoPlayer job={selected} compare={compare} /></> : selected ? selected.faceRefinement ? <FaceRefinementProgress job={selected}/> : <GenerationProgress key={selected.id} kind="video" job={selected} online={online} onCancel={() => void handleJobAction('cancel')} onResume={() => void handleJobAction('resume')} onReuse={() => reuse(selected)} /> : <WorkspaceWelcome kind="video" library={() => setView('library')} openActive={activeVideo ? () => { setSelectedId(activeVideo.id); if (activeVideo.faceRepair) setInfo(true); } : undefined} />}
      </div>{selected && <div className="workspace-bottom"><div className="recent-heading"><h3>Recent creations <span>{jobs.filter(j => !j.deleted && !j.anchorChild).length}</span></h3><button onClick={() => setView('library')}>View library <CaretRight size={13} /></button></div><div className="recent-grid">{recent.map(job => <JobCard key={job.id} job={job} selected={job.id === selected?.id} onSelect={() => { setSelectedId(job.id); setCompare(false); if (job.faceRepair) setInfo(true); }} onPatch={v => void patch(job, v)} onReuse={() => reuse(job)} />)}{!recent.length && <div className="empty-recent">Your generated videos will appear here.</div>}</div></div>}
    </section></main> : <Suspense fallback={<main className="gpu-loading">Opening your library</main>}><LibraryWorkspace jobs={jobs} assets={assets} patch={patch} reuse={reuse} editVideo={editVideo} create={() => { closePreview(); setView('create'); }} openWorkspace={job => { if (job.edit) { editVideo(job); return; } setSelectedId(job.id); setView(isImageEditJob(job) ? 'image-edit' : job.upscale ? 'clarity' : isImageJob(job) ? 'image' : 'create'); }} /></Suspense>}

    <Toaster theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton visibleToasts={3} toastOptions={{ className: 'recast-toast' }} />
    {selected && <RunDetailsDialog job={selected} selectJob={job=>setSelectedId(job.id)} jobs={jobs} assets={assets} open={info} close={() => setInfo(false)} editVideo={() => { editVideo(selected); setInfo(false); }} patch={changes => patch(selected, changes)} reuse={() => { reuse(selected); setInfo(false); }} openWorkspace={() => setInfo(false)} />}

  </div>;
}
