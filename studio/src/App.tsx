import MobileNavigation from './MobileNavigation';
import { WorkspacePanels, splitWorkspace, jobWorkspace, type WorkspacePane } from './WorkspacePanels';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Aperture, CaretDown, Moon, Sun } from '@phosphor-icons/react';
import type { Bootstrap, Job } from '../shared/types';
import { api } from './components';
import type { CloudState } from '../shared/cloud';
import {newestCloudState} from '../shared/cloud';
import {gpuPowerTarget} from '../shared/gpu-power';
import CloudStatusSync from './CloudStatusSync';
import { setupNotice } from '../shared/cloud-status';
import { modelSize, type DownloadControls } from './ModelDownloads';
import { moduleNames, type ModuleDownloadRequest } from '../shared/module-downloads';
import DownloadsWorkspace from './DownloadsWorkspace';
import { downloadRows, modelUsage } from '../shared/downloads';
import Sidebar, { initialSidebarCollapsed, type WorkspaceView } from './Sidebar';
import SettingsWorkspace, { type SettingsTab } from './SettingsWorkspace';
import { Toaster, toast } from 'sonner';
import { emptyImageEditDraft, imageEditDraftForJob, imageEditFiles, isImageEditJob, type ImageEditDraft } from '../shared/image-edit';
const PostProcessingWorkspace = lazy(() => import('./PostProcessingWorkspace'));
const OpenjutsuWorkspace = lazy(() => import('./OpenjutsuWorkspace'));
const GpuWorkspace = lazy(() => import('./GpuWorkspace'));
const ImageEditWorkspace = lazy(() => import('./ImageEditWorkspace'));
const LibraryWorkspace = lazy(() => import('./LibraryWorkspace'));
const ClarityWorkspace = lazy(() => import('./ClarityWorkspace'));
const ClipEditorWorkspace = lazy(() => import('./ClipEditorWorkspace'));
import { smoothMotionFiles } from '../shared/smooth-motion';
import { openjutsuFaceDraftForJob, emptyOpenjutsuDraft, openjutsuDefaults, openjutsuFiles } from '../shared/openjutsu';
import RunDetailsDialog from './RunDetailsDialog';
import { useActivityAlerts } from './useActivityAlerts';
import type { AlertTarget } from '../shared/alerts';
import type { EditorIntent } from './ClipEditorWorkspace';
import GpuPowerControl from './GpuPowerControl';

import { emptyModels, type ModelsState } from '../shared/models';
import { isImageJob } from '../shared/image-replacement';
import { FramingWarningTracker } from '../shared/framing-status';

const activeStates = ['queued', 'running', 'reconnecting'];
export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [remotionOutputFPS,setRemotionOutputFPS]=useState(24);
  const [remotionSettings, setRemotionSettings] = useState(() => structuredClone(openjutsuDefaults));
  const [imageEditDraft, setImageEditDraft] = useState<ImageEditDraft>(emptyImageEditDraft);
  const [editorIntent, setEditorIntent] = useState<EditorIntent | null>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const [mobilePane, setMobilePane] = useState<WorkspacePane>('setup');
  const [postMode, setPostMode] = useState<'face'|'motion'>('face');
  const [view, setView] = useState<WorkspaceView>('create'), [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const toggleSidebar = () => setSidebarCollapsed(previous => {
    try { localStorage.setItem('recast-sidebar-collapsed', String(!previous)); } catch { /* Keep the preference for this session. */ }
    return !previous;
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connection');
  const [info, setInfo] = useState(false), [message, setMessageValue] = useState('');
  const setMessage = useCallback((text: string) => { setMessageValue(text); if (text) toast.error(text, { duration: 10000 }); }, []);
  const openAlert = useCallback((target: AlertTarget) => {
    setInfo(!!target.repair);
    if (target.view === 'downloads' || target.view === 'alerts') { setSettingsTab(target.view); setView('settings'); }
    else { if(target.view==='post')setPostMode(target.postTool||'face'); setView(target.view === 'image-edit' ? 'image' : target.view); }
    if (target.jobId) { setSelectedId(target.jobId); }
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
  const initialized = useRef(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000'); localStorage.setItem('recast-theme', theme); }, [theme]);
  const receiveBootstrap = useCallback((value: Bootstrap) => {
    setData(old=>old?{...value,cloud:newestCloudState(old.cloud,value.cloud)}:value);
    if (!initialized.current) { initialized.current = true; setImageEditDraft(value.imageEditDraft || emptyImageEditDraft()); }
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
      else if (e.type === 'cloud') setData(old => old ? { ...old, cloud: newestCloudState(old.cloud,e.data) } : old);
      else if (e.type === 'models') setData(old => old ? { ...old, models: e.data } : old);
    };
    return () => { disposed = true; stream.close(); };
  }, [receiveBootstrap]);
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => { void api('/image-edit/draft', imageEditDraft).catch(e => setMessage('Imagen draft not saved: ' + e.message)); }, 500);
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
      toast.success('File deleted', { description: `${modelSize(result.freedBytes)} removed from your GPU. Available disk space has been refreshed.` });
    }).catch(error => setMessage(error.message));
  }, [data?.models, setMessage]);
  const assets = data?.assets || [], jobs = data?.jobs || [], connection = data?.connection;
  const selected = jobs.find(j => j.id === selectedId && !j.deleted);
  const online = connection?.state === 'online';
  const modelState = data?.models || emptyModels();
  const requiredFiles = [...openjutsuFiles(remotionSettings), ...(remotionOutputFPS === 24 ? [] : smoothMotionFiles)];
  const downloads: DownloadControls = { state: modelState, online, blocked: !!data?.cloud.busy || jobs.some(job => activeStates.includes(job.status)), settingUp: !!data?.cloud.busy, download: downloadModels, remove: removeModel, updated: models => setData(old => old ? { ...old, models } : old), prepareModule,cancel:cancelDownloads,refresh:refreshModels,recover:recoverDownloads };
  const patch = async (job: Job, changes: Partial<Job>) => { try { const updated = await api<Job>('/jobs/' + job.id, changes, 'PATCH'); setData(old => old ? { ...old, jobs: old.jobs.map(item => item.id === updated.id ? updated : item) } : old); } catch (e) { setMessage((e as Error).message); } };
  const editVideo = (job: Job) => { setEditorIntent({ id: crypto.randomUUID(), ...(job.edit ? { receipt: job.edit, title: job.title } : { jobId: job.id }) }); setView('editor'); };
  const reuse = (job: Job) => {
    if(job.smoothMotion&&!job.smoothMotion.automatic){const value={sourceId:job.sourceId,parentId:job.smoothMotion.parentId||null,fps:job.smoothMotion.targetFPS};void api('/smooth-motion/draft',value).then(()=>{setPostMode('motion');setSelectedId(null);setView('post');window.dispatchEvent(new CustomEvent('recast-smooth-reuse',{detail:value}));}).catch(e=>setMessage(e.message));return;} if (job.openjutsu?.face) { const value = openjutsuFaceDraftForJob(job); void api('/openjutsu/face/draft', value).then(() => { window.dispatchEvent(new CustomEvent('recast-openjutsu-face-reuse', { detail: value })); setSelectedId(job.id); setPostMode('face'); setView('post'); }).catch(error => setMessage(error.message)); return; } if (!job.openjutsu && !isImageJob(job) && !job.upscale && !job.edit) { const value = { ...emptyOpenjutsuDraft(), sourceId: job.sourceId, referenceId: job.referenceId, start: job.settings.start, length: job.settings.seconds }; void api('/openjutsu/draft', value).then(() => { window.dispatchEvent(new CustomEvent('recast-openjutsu-reuse', { detail: value })); setSelectedId(null); setView('create'); toast.message('Inputs copied to OpenJutsu', { description: 'The previous workflow settings remain with the original video in Library.' }); }).catch(error => setMessage(error.message)); return; } if (job.openjutsu) { const value = { sourceId: job.sourceId, referenceId: job.referenceId, start: job.openjutsu.section.start, length: job.openjutsu.section.length, settings: job.openjutsu.settings, outputFPS: job.openjutsu.outputFPS || 24 }; void api('/openjutsu/draft', value).then(() => { window.dispatchEvent(new CustomEvent('recast-openjutsu-reuse', { detail: value })); setSelectedId(null); setView('create'); toast.success('OpenJutsu settings loaded.'); }).catch(error => setMessage(error.message)); return; } if (isImageEditJob(job)) { setImageEditDraft(imageEditDraftForJob(job)); setSelectedId(job.id); setView('image'); toast.success('Imagen inputs and settings loaded.'); return; } if (job.upscale) { try { localStorage.setItem('recast-clarity-draft', JSON.stringify({ source: job.upscale.source, settings: job.upscale.settings })); } catch { /* Preview remains available without storage. */ } setSelectedId(job.id); setView('clarity'); toast.success('Upscale inputs and settings loaded.'); return; } if (job.edit) { editVideo(job); return; } if (isImageJob(job) && job.image) {
      const referenceIds = [job.sourceId, job.referenceId, job.image.faceId].filter((id): id is string => !!id && assets.some(asset => asset.id === id));
      setImageEditDraft({ ...emptyImageEditDraft(), referenceIds: [...new Set(referenceIds)].slice(0, 3) });
      setSelectedId(null); setView('image'); toast.message('Inputs copied to Imagen', { description: 'The retired workflow’s settings remain saved with the original image in Library. Enter a prompt for the current editor.' });
    }
  };
  const paneJob = jobs.find(job => !job.deleted && job.id === selectedId && jobWorkspace(job) === view);
  useEffect(() => { setMobilePane('setup'); }, [view]);
  useEffect(() => { if (paneJob) setMobilePane('preview'); else if (!selectedId) setMobilePane('setup'); }, [view, paneJob?.id, selectedId]);
  useLayoutEffect(() => { if (window.matchMedia('(max-width: 768px)').matches) workspaceElement.current?.querySelector('main')?.scrollTo({ top: 0 }); }, [mobilePane, view]);
  const closePreview = () => { setSelectedId(null); setInfo(false); };
  const setCloud = useCallback((cloud: CloudState) => setData(old => old ? { ...old, cloud:newestCloudState(old.cloud,cloud) } : old), []);
  if (!data) return <div className="app-loading"><Aperture size={40} weight="light" /><h1>Recast</h1><span className="activity-line" /><p>{message || 'Opening your local workspace'}</p>{message && <button className="secondary-button" onClick={() => location.reload()}>Retry</button>}</div>;
  const power=gpuPowerTarget(data.cloud),gpuPreparing=power?.view.preparing||power?.view.ending||power?.starting;
  const gpuLabel=data.cloud.error?'GPU status unavailable':power?.view.ending?power.view.label:power?.starting?'Resuming GPU':power?.view.stopped?'GPU paused':gpuPreparing?'Preparing GPU':online?connection!.gpu||'GPU connected':power?.instance.state==='running'?'GPU running · reconnect':connection!.state==='connecting'?'Connecting':'GPU offline';
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <CloudStatusSync cloud={data.cloud} setCloud={setCloud}/>
    <header className="topbar">
      <button className="brand-mark" onClick={() => setView('create')} aria-label="Recast home"><Aperture weight="bold" size={28} /><span className="wordmark">recast<span>studio</span></span></button>
      <div className="topbar-controls"><button className={`connection-button ${gpuPreparing?'connecting':power?.view.stopped||data.cloud.error?'offline':connection!.state}`} onClick={() => setView('gpu')} title={power?`${gpuLabel} · ${power.instance.gpu} #${power.instance.id}`:gpuLabel}><span className="status-dot" /><span className="gpu-status-label">{gpuLabel}</span><CaretDown size={12} /></button>
        <GpuPowerControl cloud={data.cloud} setCloud={setCloud} activeWork={modelState.busy || jobs.some(job => activeStates.includes(job.status) && job.faceRefinement?.execution !== 'local CPU')} browse={() => setView('gpu')} />
        <button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>
    <Sidebar view={view} select={setView} collapsed={sidebarCollapsed} toggle={toggleSidebar} libraryCount={jobs.filter(j => !j.deleted && !j.anchorChild).length} />
    <div className="workspace-host" data-view={view} data-split={splitWorkspace(view)} data-mobile-pane={mobilePane}>
    {splitWorkspace(view) && <WorkspacePanels pane={mobilePane} change={setMobilePane} busy={!!paneJob && activeStates.includes(paneJob.status)} />}
    <div className="workspace-content" id="workspace-content" tabIndex={-1} ref={workspaceElement}>
    {view === 'settings' ? <SettingsWorkspace tab={settingsTab} onTabChange={setSettingsTab} connection={connection!} cloud={data.cloud} setCloud={setCloud} error={setMessage} browse={() => setView('gpu')} downloads={<DownloadsWorkspace controls={downloads} required={[...new Set([...requiredFiles, ...imageEditFiles(imageEditDraft.settings)])]} refresh={refreshModels} cancel={cancelDownloads} setup={() => setView('gpu')} />} /> : view === 'gpu' ? <Suspense fallback={<main className="gpu-loading">Opening GPU cloud</main>}><GpuWorkspace cloud={data.cloud} setCloud={setCloud} notify={setMessage} onCreate={() => setView('create')} openSettings={() => { setSettingsTab('connection'); setView('settings'); }} /></Suspense> : view === 'clarity' ? <Suspense fallback={<main className="gpu-loading">Opening Clarity</main>}><ClarityWorkspace library={() => setView('library')} data={data} downloads={downloads} selectedId={selectedId} select={setSelectedId} added={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} assetAdded={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} openGPU={() => setView('gpu')} openDownloads={() => { setSettingsTab('downloads'); setView('settings'); }} /></Suspense> : view === 'editor' ? <Suspense fallback={<main className="gpu-loading">Opening clip editor</main>}><ClipEditorWorkspace jobs={jobs} assets={assets} assetAdded={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} intent={editorIntent} consumed={id => setEditorIntent(old => old?.id === id ? null : old)} library={() => setView('library')} /></Suspense> : view === 'image' ? <Suspense fallback={<main className="gpu-loading">Opening Imagen</main>}><ImageEditWorkspace data={data} draft={imageEditDraft} setDraft={setImageEditDraft} downloads={downloads} selectedId={selectedId} select={setSelectedId} close={closePreview} asset={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} job={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} error={setMessage} openDownloads={() => { setSettingsTab('downloads'); setView('settings'); }} openGPU={() => setView('gpu')} library={() => setView('library')} /></Suspense> : view === 'post' ? <Suspense fallback={<main className="gpu-loading">Opening post-processing</main>}><PostProcessingWorkspace mode={postMode} changeMode={mode => {setPostMode(mode);setSelectedId(null);}} data={data} downloads={downloads} selectedId={selectedId} select={setSelectedId} asset={asset => setData(old => old ? {...old,assets:[asset,...old.assets.filter(a=>a.id!==asset.id)]}:old)} job={job => setData(old => old ? {...old,jobs:[job,...old.jobs.filter(j=>j.id!==job.id)]}:old)} openGPU={()=>setView('gpu')} openDownloads={()=>{setSettingsTab('downloads');setView('settings');}} library={()=>setView('library')} back={()=>setView('create')} /></Suspense> : view === 'create' ? <Suspense fallback={<main className="gpu-loading">Opening Remotion</main>}><OpenjutsuWorkspace outputChanged={setRemotionOutputFPS} postProcess={mode=>{setPostMode(mode);setView('post');}} settingsChanged={setRemotionSettings} data={data} downloads={downloads} selectedId={selectedId} select={setSelectedId} asset={asset => setData(old => old ? { ...old, assets: [asset, ...old.assets.filter(a => a.id !== asset.id)] } : old)} job={job => setData(old => old ? { ...old, jobs: [job, ...old.jobs.filter(j => j.id !== job.id)] } : old)} openGPU={() => setView('gpu')} openDownloads={() => { setSettingsTab('downloads'); setView('settings'); }} library={() => setView('library')} /></Suspense> : <Suspense fallback={<main className="gpu-loading">Opening your library</main>}><LibraryWorkspace jobs={jobs} assets={assets} patch={patch} reuse={reuse} editVideo={editVideo} create={() => { closePreview(); setView('create'); }} openWorkspace={job => { if (isImageJob(job) && !isImageEditJob(job)) { reuse(job); return; } if (job.edit) { editVideo(job); return; } setSelectedId(job.id); if(job.openjutsu?.face || job.smoothMotion&&!job.smoothMotion.automatic)setPostMode(job.openjutsu?.face?'face':'motion'); setView(job.openjutsu?.face || job.smoothMotion&&!job.smoothMotion.automatic ? 'post' : isImageEditJob(job) ? 'image' : job.upscale ? 'clarity' : isImageJob(job) ? 'image' : 'create'); }} /></Suspense>}

    </div></div>
    <MobileNavigation view={view} select={setView} />
    <Toaster theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton visibleToasts={3} toastOptions={{ className: 'recast-toast' }} />
    {selected && <RunDetailsDialog job={selected} selectJob={job=>setSelectedId(job.id)} jobs={jobs} assets={assets} open={info} close={() => setInfo(false)} editVideo={() => { editVideo(selected); setInfo(false); }} patch={changes => patch(selected, changes)} reuse={() => { reuse(selected); setInfo(false); }} openWorkspace={() => setInfo(false)} />}

  </div>;
}
