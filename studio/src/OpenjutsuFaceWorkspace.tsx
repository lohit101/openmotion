import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, DownloadSimple, Sparkle, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, AssetDrop, SmallSelect, VideoPlayer } from './components';
import { emptyOpenjutsuFaceDraft, openjutsuFaceDraftSchema, openjutsuFaceDraftForJob, type OpenjutsuFaceDraft, type OpenjutsuSettings } from '../shared/openjutsu';
import type { Asset, Bootstrap, Catalog, Job } from '../shared/types';
import type { DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import GenerationProgress from './GenerationProgress';
import WorkspaceWelcome from './WorkspaceWelcome';

interface Props { data: Bootstrap; downloads: DownloadControls; selectedId: string | null; select: (id: string | null) => void; asset: (asset: Asset) => void; job: (job: Job) => void; back: () => void; openGPU: () => void; openDownloads: () => void; library: () => void; }
export default function OpenjutsuFaceWorkspace({ data, downloads, selectedId, select, asset, job: added, back, openGPU, openDownloads, library }: Props) {
  const [draft, setDraft] = useState(emptyOpenjutsuFaceDraft), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [submitting, setSubmitting] = useState(false), [choosing, setChoosing] = useState(false), [uploading, setUploading] = useState({ video: false, image: false });
  const [catalog, setCatalog] = useState<Catalog>({}), writes = useRef(Promise.resolve()), pending = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { let alive = true; void api<OpenjutsuFaceDraft>('/openjutsu/face/draft').then(d => { if (alive) { setDraft(openjutsuFaceDraftSchema.parse(d)); setLoaded(true); } }).catch(e => setError(e.message)); return () => { alive = false; }; }, []);
  useEffect(() => { const listener = (e: Event) => { setDraft(openjutsuFaceDraftSchema.parse((e as CustomEvent).detail)); setLoaded(true); }; window.addEventListener('recast-openjutsu-face-reuse', listener); return () => window.removeEventListener('recast-openjutsu-face-reuse', listener); }, []);
  useEffect(() => { if (!loaded || !openjutsuFaceDraftSchema.safeParse(draft).success) return; const snapshot = structuredClone(draft); const timer = setTimeout(() => { writes.current = writes.current.catch(() => {}).then(() => api('/openjutsu/face/draft', snapshot)).then(() => {}).catch(e => setError(e.message)); }, 300); return () => clearTimeout(timer); }, [draft, loaded]);
  useEffect(() => { if (data.connection.state === 'online') void api<Catalog>('/openjutsu/catalog').then(setCatalog).catch(() => {}); else setCatalog({}); }, [data.connection.state, data.models.checkedAt]);
  const s = draft.settings, source = data.assets.find(a => a.id === draft.sourceId), reference = data.assets.find(a => a.id === draft.referenceId), selected = data.jobs.find(j => j.id === selectedId && !j.deleted), ready = selected?.status === 'completed' && !!selected.output;
  const completed = data.jobs.filter(j => j.status === 'completed' && j.output && !j.image && !j.deleted);
  const update = (value: Partial<OpenjutsuSettings>) => setDraft(old => ({ ...old, settings: { ...old.settings, ...value } }));
  const input = (kind: 'video' | 'image', value: Asset | null) => { if (value) asset(value); setDraft(old => ({ ...old, [kind === 'video' ? 'sourceId' : 'referenceId']: value?.id || null, ...(kind === 'video' ? { parentId: null, start: 0, length: 0 } : {}) })); };
  const chooseResult = async (id: string) => {
    if (id === 'none') return; setChoosing(true); setError('');
    try { await writes.current; const result = await api<{ draft: OpenjutsuFaceDraft; asset: Asset }>('/openjutsu/face/use', { jobId: id }); asset(result.asset); setDraft(result.draft); select(id); }
    catch (e) { setError((e as Error).message); } finally { setChoosing(false); }
  };
  const process = async () => {
    if (!loaded || submitting) return; setSubmitting(true); setError('');
    try { await writes.current; const body = JSON.stringify(openjutsuFaceDraftSchema.parse(draft)); if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() }; const r = await fetch('/api/openjutsu/face/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key }, body }); const value = await r.json(); if (!r.ok) throw new Error(value.error || 'Fix Faces could not start.'); pending.current = null; added(value); select(value.id); toast.success('Fix Faces queued', { description: 'Your original video is preserved.' }); }
    catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  };
  const options = (node: string, key: string, current: string) => { const choices = catalog[node]?.input.required?.[key]?.[0]; return [...new Set([current, ...(Array.isArray(choices) ? choices.filter((v): v is string => typeof v === 'string') : [])])].map(value => ({ value, label: value })); };
  const components = [['Video model', 'model', 'UNETLoader', 'unet_name'], ['Visual describer', 'describer', 'CLIPLoader', 'clip_name'], ['H3 text encoder', 'textEncoder', 'CLIPLoader', 'clip_name'], ['Video VAE', 'videoVae', 'VAELoader', 'vae_name'], ['Audio VAE', 'audioVae', 'VAELoader', 'vae_name']] as const;
  return <main className="oj-workspace">
    <section className="editor oj-editor" aria-label="Fix Faces settings"><div className="oj-editor-scroll">
      <button className="secondary-button" onClick={back}><ArrowLeft size={15} />Motion transfer</button>
      <div className="editor-heading"><span className="section-icon"><Sparkle size={19} /></span><h1>Fix Faces</h1></div>
      <p className="editor-description">OpenJutsu post-processing · original H3 face workflow</p>
      <section className="oj-section"><h2>1 · Finished video</h2><SmallSelect label="Finished video from library" value={draft.parentId || 'none'} onChange={id => void chooseResult(id)} options={[{ value: 'none', label: 'Choose a completed video' }, ...completed.map(j => ({ value: j.id, label: j.title }))]} />
        <AssetDrop kind="video" label="Video to fix" emptyLabel="Drop a finished video" asset={source} disabled={!loaded || submitting || choosing} onAsset={a => input('video', a)} onError={setError} onUploadStateChange={value => setUploading(old => ({ ...old, video: value }))} clip={source ? { start: draft.start, seconds: draft.length || source.duration - draft.start } : undefined} onClip={clip => setDraft(old => ({ ...old, start: clip.start, length: clip.seconds }))} help="The original video stays saved. Fix Faces creates a separate result." />
        {source && <button className="secondary-button" onClick={() => setDraft(old => ({ ...old, start: 0, length: 0 }))}>Use whole video</button>}
      </section>
      <section className="oj-section"><h2>2 · Character photo</h2><AssetDrop kind="image" label="Face reference" emptyLabel="Drop the character photo" asset={reference} disabled={!loaded || submitting} onAsset={a => input('image', a)} onError={setError} onUploadStateChange={value => setUploading(old => ({ ...old, image: value }))} help="Use the same character photo that the video was made with." />
        <SmallSelect label="Face reference from library" value={draft.referenceId || 'none'} onChange={id => input('image', data.assets.find(a => a.id === id) || null)} options={[{ value: 'none', label: 'Choose a character image' }, ...data.assets.filter(a => a.kind === 'image' && !a.maskFor).map(a => ({ value: a.id, label: a.name }))]} />
      </section>
      <section className="oj-section"><h2>3 · Face settings</h2><div className="oj-face-styles" role="group" aria-label="Face correction style">{([{ value: 'photo', label: 'Match the photo' }, { value: 'mouth', label: 'Follow the mouth' }] as const).map(option => <button type="button" className="secondary-button" key={option.value} aria-pressed={draft.face.style === option.value} onClick={() => setDraft(old => ({ ...old, face: { ...old.face, style: option.value } }))}>{option.label}</button>)}</div>
        <p className="oj-scene-note">{draft.face.style === 'photo' ? 'Closest likeness to the photo. H3 redraws the expressions and mouth movements.' : 'Follows the video’s expressions and mouth movements, with potentially less likeness to the photo.'}</p>
        <p className="oj-scene-note">OpenJutsu repairs small faces. Faces taller than one-fifth of the frame are left alone.</p>
      </section>
      <details className="oj-advanced"><summary>Advanced</summary><div>
        <div className="oj-fields"><label>Seed<input aria-label="Fix Faces seed" type="number" min={0} max={0xffffffff} value={s.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label><label>Chunk length<input aria-label="Face chunk seconds" type="number" min={2.5} max={15} step={.5} value={draft.face.chunkSeconds} onChange={e => setDraft(old => ({ ...old, face: { ...old.face, chunkSeconds: Number(e.target.value) } }))} /></label></div>
        <p className="oj-scene-note">Chunks overlap by one second and are crossfaded, as in OpenJutsu.</p>
        <label>Steps<input aria-label="Fix Faces steps" type="number" min={1} max={100} value={s.steps} onChange={e => update({ steps: Number(e.target.value) })} /></label>
        <div className="oj-models">{components.map(([label, field, node, key]) => <label className="oj-model-field" key={field}><span>{label}</span><SmallSelect label={'Fix Faces ' + label} value={s[field]} onChange={value => update({ [field]: value })} options={options(node, key, s[field])} /></label>)}</div>
        <div className="oj-loras"><h3>LoRAs</h3>{s.loras.map((lora, i) => <div className="oj-lora" key={i}><SmallSelect label={'Face LoRA ' + (i + 1)} value={lora.name} onChange={name => update({ loras: s.loras.map((l, j) => j === i ? { ...l, name } : l) })} options={options('LoraLoaderModelOnly', 'lora_name', lora.name)} /><label><input type="checkbox" checked={lora.enabled !== false} onChange={e => update({ loras: s.loras.map((l, j) => j === i ? { ...l, enabled: e.target.checked } : l) })} />Use this LoRA</label><input aria-label={'Face LoRA strength ' + (i + 1)} type="number" min={-4} max={4} step={.05} value={lora.strength} onChange={e => update({ loras: s.loras.map((l, j) => j === i ? { ...l, strength: Number(e.target.value) } : l) })} /><button className="secondary-button" onClick={() => update({ loras: s.loras.filter((_, j) => j !== i) })}>Remove</button></div>)}{s.loras.length < 4 && <button className="secondary-button" onClick={() => update({ loras: [...s.loras, { ...emptyOpenjutsuFaceDraft().settings.loras[0] }] })}>Add LoRA</button>}</div>
        <SmallSelect label="Face acceleration" value={s.acceleration} onChange={value => update({ acceleration: value as OpenjutsuSettings['acceleration'] })} options={[{ value: 'none', label: 'Off' }, { value: 'spectrum', label: 'Spectrum · requires compatible node and no speed LoRA' }]} />
      </div></details>
      {selected?.openjutsu?.face && <button className="secondary-button" onClick={() => setDraft(openjutsuFaceDraftForJob(selected))}>Reuse this face correction</button>}
      {error && <p className="model-page-error" role="alert">{error}</p>}
    </div><ModuleAction request={{ module: 'openjutsu-face', settings: s }} controls={downloads} runtimeReady={!!downloads.state.openjutsuFaceToolsReady} runtimeNotes={['OpenJutsu face tracking, SAM masks and overlapping H3 face regeneration. Additional files download only on request.']} generateLabel="Fix Faces" generateDisabled={!loaded || !source || !reference || uploading.video || uploading.image || choosing} submitting={submitting} onGenerate={() => void process()} onConnect={openGPU} onManage={openDownloads} /></section>
    <section className="workspace oj-preview"><header className="workspace-header"><div><span className="workspace-overline">POST-PROCESSING</span><h2>{selected?.title || 'Face correction'}</h2></div><div className="workspace-actions">{ready && selected && <a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`} download><DownloadSimple size={15} />Download</a>}{selected && <button className="icon-button" aria-label="Close face correction preview" onClick={() => select(null)}><X size={18} /></button>}</div></header>
      <div className={`main-preview ${ready ? 'has-result' : ''}`}>{selected ? ready ? <VideoPlayer job={selected} compare={false} /> : <GenerationProgress job={selected} kind="video" online={data.connection.state === 'online'} onCancel={() => void api<Job>(`/jobs/${selected.id}/cancel`, {}).then(added).catch(e => setError(e.message))} onResume={() => void api<Job>(`/jobs/${selected.id}/resume`, selected.retryRequired?{retryMissing:true}:{}).then(added).catch(e => setError(e.message))} onReuse={() => { if (selected.openjutsu?.face) setDraft(openjutsuFaceDraftForJob(selected)); }} /> : <WorkspaceWelcome kind="video" library={library} />}</div>
    </section>
  </main>;
}
