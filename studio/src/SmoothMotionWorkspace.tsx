import { useEffect, useRef, useState } from 'react';
import { DownloadSimple, FilmStrip, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, AssetDrop, SmallSelect, VideoPlayer } from './components';
import { emptySmoothMotionDraft, smoothMotionDraftSchema, type SmoothMotionDraft } from '../shared/smooth-motion';
import type { Asset, Bootstrap, Job } from '../shared/types';
import type { DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import GenerationProgress from './GenerationProgress';
import WorkspaceWelcome from './WorkspaceWelcome';

export interface PostWorkspaceProps { data: Bootstrap; downloads: DownloadControls; selectedId: string | null; select: (id: string | null) => void; asset: (asset: Asset) => void; job: (job: Job) => void; openGPU: () => void; openDownloads: () => void; library: () => void; back: () => void; }
export default function SmoothMotionWorkspace({ data, downloads, selectedId, select, asset, job: added, openGPU, openDownloads, library }: PostWorkspaceProps) {
  const [draft, setDraft] = useState(emptySmoothMotionDraft), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [uploading, setUploading] = useState(false), [submitting, setSubmitting] = useState(false), [choosing, setChoosing] = useState(false);
  const writes = useRef(Promise.resolve()), pending = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { let alive = true; void api<SmoothMotionDraft>('/smooth-motion/draft').then(d => { if (alive) { setDraft(smoothMotionDraftSchema.parse(d)); setLoaded(true); } }).catch(e => setError(e.message)); return () => { alive = false; }; }, []);
  useEffect(()=>{const use=(e:Event)=>setDraft(smoothMotionDraftSchema.parse((e as CustomEvent).detail));window.addEventListener('recast-smooth-reuse',use);return()=>window.removeEventListener('recast-smooth-reuse',use);},[]);
  useEffect(() => { if (!loaded) return; const snapshot = structuredClone(draft), timer = setTimeout(() => { writes.current = writes.current.catch(() => {}).then(() => api('/smooth-motion/draft', snapshot)).then(() => {}).catch(e => setError(e.message)); }, 300); return () => clearTimeout(timer); }, [draft, loaded]);
  const source = data.assets.find(a => a.id === draft.sourceId), selected = data.jobs.find(j => j.id === selectedId && !j.deleted), ready = selected?.status === 'completed' && !!selected.output;
  const completed = data.jobs.filter(j => j.status === 'completed' && j.output && !j.image && !j.deleted);
  const choose = async (id: string) => {
    if (id === 'none' || choosing) return; setChoosing(true); setError('');
    try { await writes.current; const result = await api<{ draft: SmoothMotionDraft; asset: Asset }>('/smooth-motion/use', { jobId: id }); asset(result.asset); setDraft(result.draft); }
    catch (e) { setError((e as Error).message); } finally { setChoosing(false); }
  };
  const process = async () => {
    if (submitting || uploading || choosing) return; setSubmitting(true); setError('');
    try {
      await writes.current; const body = JSON.stringify(smoothMotionDraftSchema.parse(draft));
      if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
      const response = await fetch('/api/smooth-motion/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key }, body });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Processing could not start.');
      pending.current = null; added(result); select(result.id); toast.success('Smooth Motion queued');
    } catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  };
  const action = (name: 'resume' | 'cancel') => selected && void api<Job>(`/jobs/${selected.id}/${name}`, name==='resume'&&selected.retryRequired?{retryMissing:true}:{}).then(added).catch(e => setError(e.message));
  return <main className="oj-workspace">
    <section className="editor oj-editor" aria-label="Smooth Motion settings"><div className="oj-editor-scroll">
      <div className="editor-heading"><span className="section-icon"><FilmStrip size={19} /></span><h1>Smooth Motion</h1></div>
      <p className="editor-description">Smoother motion. Original timing and audio.</p>
      <section className="oj-section"><h2>Video</h2><SmallSelect label="Video to smooth from library" value={draft.parentId || 'none'} onChange={id => void choose(id)} options={[{ value: 'none', label: 'Choose a completed video' }, ...completed.map(j => ({ value: j.id, label: j.title }))]} />
        <AssetDrop kind="video" label="Video to smooth" emptyLabel="Drop a video" asset={source} disabled={!loaded || submitting || choosing} onAsset={value => { if (value) asset(value); setDraft(old => ({ ...old, sourceId: value?.id || null, parentId: null })); }} onError={setError} onUploadStateChange={setUploading} help="Process a finished Library result or an uploaded SDR video up to five minutes long. Your original stays saved." />
        {source && <p className="oj-scene-note">{source.fps.toFixed(2)}fps input · {source.width} × {source.height} · {source.duration.toFixed(2)}s</p>}
      </section>
      <section className="oj-section"><h2>Output</h2><SmallSelect label="Smooth Motion frame rate" value={String(draft.fps)} onChange={value => setDraft(old => ({ ...old, fps: Number(value) as SmoothMotionDraft['fps'] }))} options={[{ value: '30', label: '30 fps · balanced' }, { value: '48', label: '48 fps · double native motion' }, { value: '60', label: '60 fps · smoothest' }]} />
        <p className="oj-scene-note">Timing and audio stay unchanged. Cuts remain cuts.</p>
      </section>
      <details className="oj-advanced"><summary>What this changes</summary><div><p className="oj-scene-note">Smoother motion does not repair identity drift or malformed details. Fast hands and mouths can still need review. Higher frame rates use more processing and produce larger exports.</p><p className="oj-scene-note">Frames stream in pairs to limit memory use. The final video is encoded as a high-quality H.264 MP4; existing compatible audio is copied.</p></div></details>
      {error && <p className="model-page-error" role="alert">{error}</p>}
    </div><ModuleAction request={{ module: 'smooth-motion' }} controls={downloads} runtimeReady={!!downloads.state.smoothMotionToolsReady} runtimeNotes={['RIFE 4.25 · 22.7 MB. Uses your connected GPU; generation never starts downloads.']} generateLabel="Smooth video" generateDisabled={!loaded || !source || uploading || choosing} submitting={submitting} onGenerate={() => void process()} onConnect={openGPU} onManage={openDownloads} /></section>
    <section className="workspace oj-preview"><header className="workspace-header"><div><span className="workspace-overline">POST-PROCESSING</span><h2>{selected?.title || 'Smoother motion'}</h2></div><div className="workspace-actions">{ready && selected && <a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`} download><DownloadSimple size={15} />Download</a>}{selected && <button className="icon-button" aria-label="Close smoothing preview" onClick={() => select(null)}><X size={18} /></button>}</div></header>
      <div className={`main-preview ${ready ? 'has-result' : ''}`}>{selected ? ready ? <VideoPlayer job={selected} compare={false} /> : <GenerationProgress job={selected} kind="video" online={data.connection.state === 'online'} onCancel={() => action('cancel')} onResume={() => action('resume')} onReuse={() => selected.smoothMotion && setDraft({ sourceId: selected.sourceId, parentId: selected.smoothMotion.parentId || null, fps: selected.smoothMotion.targetFPS })} /> : <WorkspaceWelcome kind="video" library={library} />}</div>
    </section>
  </main>;
}
