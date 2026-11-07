import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowCounterClockwise, ArrowDown, ArrowUp, ArrowsOut, DownloadSimple, Image as ImageIcon, PencilSimple, Plus, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Asset, Bootstrap, Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { imageEditDraftForJob, imageEditGeometry, imageEditSampling, imageEditSamplingLabel, imageEditModelLabel, imageEditHeadSwapPrompt, isImageEditJob, type ImageEditDraft, type ImageEditSettings } from '../shared/image-edit';
import { api, AssetDrop, SmallSelect, Toggle } from './components';
import { FieldLabel } from './InfoTip';
import { EditorDisclosure, EditorSection } from './EditorControls';
import type { DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import WorkspaceWelcome from './WorkspaceWelcome';
import GenerationProgress from './GenerationProgress';
import { useOutputPresentation } from './useGenerationProgress';
import { uploadReferences, validateReferenceDrop } from './image-edit-upload';
import './images.css';
import './media-preview.css';
import './image-edit.css';

export interface ImageEditWorkspaceProps {
  data: Bootstrap; draft: ImageEditDraft; setDraft: (value: ImageEditDraft | ((old: ImageEditDraft) => ImageEditDraft)) => void;
  downloads: DownloadControls; selectedId: string | null; select: (id: string) => void; close: () => void;
  asset: (asset: Asset) => void; job: (job: Job) => void; error: (message: string) => void;
  openDownloads: () => void; openGPU: () => void; library: () => void;
}
export default function ImageEditWorkspace(props: ImageEditWorkspaceProps) {
  const { data, draft, setDraft, downloads, error } = props, s = draft.settings;
  const slotCount = Math.max(1, draft.referenceIds.length);
  const [creating, setCreating] = useState(false), [compare, setCompare] = useState(false), [split, setSplit] = useState(50), [expanded, setExpanded] = useState(false);
  const request = useRef<{ key: string; body: string } | null>(null);
  const extraInput = useRef<HTMLInputElement>(null), uploadController = useRef<AbortController | null>(null);
  const [dropActive, setDropActive] = useState(false), [uploadProgress, setUploadProgress] = useState<{ index: number; total: number; percent: number } | null>(null);
  const [slotUploads, setSlotUploads] = useState<Record<number, boolean>>({});
  const uploading = !!uploadProgress || Object.values(slotUploads).some(Boolean);
  useEffect(() => () => uploadController.current?.abort(), []);
  const jobs = data.jobs.filter(j => isImageEditJob(j) && !j.deleted), selected = jobs.find(j => j.id === props.selectedId);
  const current = jobs.find(j => ['queued', 'running', 'reconnecting'].includes(j.status)), done = useOutputPresentation(selected);
  const images = data.assets.filter(a => a.kind === 'image' && !a.maskFor);
  const refs = draft.referenceIds.map(id => images.find(a => a.id === id)), first = refs[0];
  let geometry: ReturnType<typeof imageEditGeometry> | undefined, issue = '';
  try { if (first) geometry = imageEditGeometry(s, first); } catch (e) { issue = (e as Error).message; }
  const valid = !!s.prompt.trim() && !!first && refs.every(Boolean) && !issue;
  const update = (value: Partial<ImageEditSettings>) => setDraft(old => ({ ...old, settings: { ...old.settings, ...value } }));
  const choose = (index: number, asset: Asset | null) => {
    if (uploadController.current) return;
    if (asset && asset.size > 10_000_000) { error('Use a PNG, JPEG or WebP image under 10 MB.'); return; }
    if (asset) props.asset(asset);
    setDraft(old => { const ids = [...old.referenceIds]; if (asset) ids[index] = asset.id; else ids.splice(index, 1); return { ...old, referenceIds: ids.filter(Boolean) }; });
  };
  const move = (index: number, delta: number) => setDraft(old => { if (uploadController.current) return old; const ids = [...old.referenceIds]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return { ...old, referenceIds: ids }; });
  const addFiles = async (files: File[]) => {
    setDropActive(false);
    if (!files.length || uploading || uploadController.current) return;
    try { validateReferenceDrop(files, draft.referenceIds.length); } catch (e) { error((e as Error).message); return; }
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      await uploadReferences(files, controller.signal, asset => {
        props.asset(asset); setDraft(old => ({ ...old, referenceIds: [...old.referenceIds, asset.id] }));
      }, (index, total, percent) => setUploadProgress({ index, total, percent }));
    } catch (e) { if (!controller.signal.aborted) error((e as Error).message); }
    finally { if (!controller.signal.aborted) setUploadProgress(null); uploadController.current = null; }
  };
  const generate = async () => {
    if (creating || uploading || !valid) return;
    const body = JSON.stringify(draft);
    if (request.current?.body !== body) request.current = { key: crypto.randomUUID(), body };
    setCreating(true);
    try {
      const response = await fetch('/api/image-edit/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current!.key }, body });
      const value = await response.json();
      if (!response.ok) { if (response.status < 500) request.current = null; throw new Error(value.error || 'Image Edit could not be queued.'); }
      request.current = null; props.job(value); props.select(value.id); setCompare(false);
      toast.success('Image Edit queued');
    } catch (e) { error((e as Error).message); } finally { setCreating(false); }
  };
  const reuse = (job: Job) => { if (uploading) return; const next = imageEditDraftForJob(job); setDraft(next); request.current = null; toast.success('Inputs and settings loaded'); };
  const action = async (name: 'cancel' | 'resume') => { if (!selected) return; try { await api(`/jobs/${selected.id}/${name}`, name === 'resume' ? { retryMissing: !!selected.retryRequired } : {}); } catch (e) { error((e as Error).message); } };
  const original = selected?.image?.edit?.references[0], [width, height] = selected ? outputDimensions(selected) : [1, 1];
  const frozen = selected?.image?.edit?.settings;
  return <main className="create-layout image-layout workflow-layout image-edit-layout">
    <section className="editor image-editor"><div className="editor-scroll">
      <div className="editor-heading"><span className="section-icon"><PencilSimple size={19} /></span><h1>Image Edit</h1><span className="imagen-model-label">Qwen 2.1 INT8</span></div>
      <p className="editor-description">Your images. Your instructions.</p>
      <EditorSection title="Reference images" help="One to three complete images, in the order used by your prompt. Refer to them as Image 1, Image 2 and Image 3. PNG, JPEG or WebP, up to 10 MB each. For BFS head swaps, put the target first and the reference head second. Image 3 can supply extra identity detail. Your prompt sets their roles; no automatic crop or character template is applied.">
        <fieldset className="image-edit-reference-fields" disabled={uploading}>
        <div className="image-edit-references" style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}>{Array.from({ length: slotCount }, (_, i) => <div className="image-edit-reference" key={i}>
          <AssetDrop kind="image" label={`Image ${i + 1}${i === 0 ? ' · target' : ' · reference'}`} emptyLabel={i === 0 ? 'Add the image to edit' : 'Add another reference'} asset={refs[i]} onAsset={a => choose(i, a)} onError={error} disabled={uploading} onUploadStateChange={value => setSlotUploads(old => old[i] === value || !old[i] && !value ? old : { ...old, [i]: value })} />
          <div className="image-edit-reference-tools"><SmallSelect label={`Choose Image ${i + 1} from library`} value={refs[i]?.id || '__none__'} onChange={id => { const asset = images.find(a => a.id === id); if (asset) choose(i, asset); }} options={[{ value: '__none__', label: 'Choose from library…', disabled: true }, ...images.map(a => ({ value: a.id, label: a.name }))]} />
            {refs[i] && <div className="image-edit-order"><button type="button" aria-label={`Move Image ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14}/></button><button type="button" aria-label={`Move Image ${i + 1} later`} disabled={i >= draft.referenceIds.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14}/></button></div>}
          </div>
        </div>)}</div>
        </fieldset>
        <input ref={extraInput} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Add reference images" hidden disabled={uploading} onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }}/>
        {(draft.referenceIds.length < 3 || !!uploadProgress) && <button type="button" className={`image-edit-add-reference ${dropActive ? 'dragging' : ''}`} disabled={uploading} aria-label="Add reference images" aria-busy={!!uploadProgress} onClick={() => extraInput.current?.click()}
          onDragOver={event => { event.preventDefault(); if (!uploading) { event.dataTransfer.dropEffect = 'copy'; setDropActive(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
          onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}><Plus size={18}/><span><strong>{uploadProgress ? `Uploading ${uploadProgress.index} of ${uploadProgress.total} · ${uploadProgress.percent}%` : draft.referenceIds.length ? 'Drop extra images here, or choose files' : 'Drop images here, or choose files'}</strong><small>{uploadProgress ? 'Completed images stay in their reference slots.' : `Up to ${3 - draft.referenceIds.length} ${draft.referenceIds.length ? 'more ' : ''}image${draft.referenceIds.length === 2 ? '' : 's'} · PNG, JPEG or WebP · 10 MB each`}</small></span></button>}
        {!!draft.referenceIds.length && draft.referenceIds.length < 3 && <div className="image-edit-add-library"><SmallSelect label="Add extra image from library" value="__none__" disabled={uploading} onChange={id => { const asset = images.find(a => a.id === id); if (asset) choose(draft.referenceIds.length, asset); }} options={[{ value: '__none__', label: 'Add extra image from library…', disabled: true }, ...images.map(a => ({ value: a.id, label: a.name }))]}/></div>}
      </EditorSection>
      <EditorSection title="Edit prompt" help="Your text is sent exactly as written. Describe each image’s role and what should stay unchanged. Use the optional head-swap starter for the BFS adapter, or turn BFS off for general edits.">
        <label className="image-edit-prompt-label" htmlFor="image-edit-prompt">What should change?</label>
        <textarea id="image-edit-prompt" className="image-edit-prompt" maxLength={5000} value={s.prompt} onChange={e => update({ prompt: e.target.value })} placeholder="Edit Image 1 using Image 2 as the character reference. Keep Image 1’s pose, framing, clothing and lighting…" rows={7}/>
        <div className="image-edit-prompt-count">{s.prompt.length.toLocaleString()} / 5,000</div>
        {draft.referenceIds.length >= 2 && s.bfs && <button type="button" className="quiet-button" disabled={uploading} onClick={() => update({ prompt: imageEditHeadSwapPrompt(draft.referenceIds.length) })}>Use head-swap starter</button>}
      </EditorSection>
      <EditorSection title="Output">
        <div className="full-label"><FieldLabel label="Aspect ratio" help="Source preserves Image 1’s aspect ratio to the model’s 32-pixel grid. Choosing another ratio changes the generation canvas; the complete target is fitted to that canvas with padding when necessary, never cropped or stretched."/><SmallSelect label="Image Edit aspect ratio" value={s.aspect} onChange={aspect => update({ aspect: aspect as ImageEditSettings['aspect'] })} options={[{ value: 'source', label: 'Match Image 1' }, ...['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'].map(value => ({ value, label: value }))]}/></div>
        <div className="full-label"><FieldLabel label="Canvas" help="1 MP is the usual Qwen editing scale. 2K uses about four million native pixels and needs more memory and time. It is not a post-generation upscale or a guarantee of Kie’s output quality."/><SmallSelect label="Image Edit canvas" value={s.resolution} onChange={resolution => update({ resolution: resolution as ImageEditSettings['resolution'] })} options={[{ value: '1k', label: '1 MP · standard' }, { value: '2k', label: '2K canvas · high memory' }]}/></div>
        <div className="full-label"><FieldLabel label="Sampling" help="Native keeps 40 steps. Turbo uses Qwen 2.1’s matching eight-step adapter. Both use CFG 1, as required by the consistency recipe; output quality still depends on the references and prompt."/><SmallSelect label="Image Edit sampling" value={s.quality} onChange={quality => update({ quality: quality as ImageEditSettings['quality'] })} options={[{ value: 'native', label: 'Native · 40 steps' }, { value: 'turbo', label: 'Turbo · 8 steps' }]}/></div>
        {geometry && <p className="imagen-output-size">{geometry.width} × {geometry.height}<span>Native canvas · {s.format.toUpperCase()}</span></p>}
      </EditorSection>
      <EditorDisclosure title="Advanced settings" meta={s.precision.toUpperCase()}>
        <p className="editor-description">Qwen Image 2.1 INT8 · matching Qwen3 VL encoder and VAE.</p>
        <Toggle label="Consistency · preserve framing" checked={s.consistency} onChange={consistency => update({ consistency })}/>
        <p className="editor-description">Keeps edits aligned with Image 1. Turn off when you want a new pose, head direction or a major removal.</p>
        <Toggle label="BFS · photorealistic head swap" checked={s.bfs} onChange={bfs => update({ bfs })}/>
        <p className="editor-description">V1.1 alternative · stronger expression transfer, strength 1. Use Image 1 for the target and Image 2 for the head. Turn off for clothing, scenery or other general edits.</p>
        <div className="full-label"><FieldLabel label="File format" help="PNG preserves the model’s native output. JPEG exports at quality 95 with full chroma; the original native PNG remains saved for recovery."/><SmallSelect label="Image Edit file format" value={s.format} onChange={format => update({ format: format as ImageEditSettings['format'] })} options={[{ value: 'png', label: 'PNG · lossless' }, { value: 'jpeg', label: 'JPEG · smaller file' }]}/></div>
        <Toggle label="Random seed" checked={s.randomSeed} onChange={randomSeed => update({ randomSeed })}/>
        <label className="imagen-seed" htmlFor="image-edit-seed">Seed<input id="image-edit-seed" type="number" min={0} max={4294967295} step={1} disabled={s.randomSeed} value={s.seed} onChange={e => { const seed = Number(e.target.value); if (Number.isInteger(seed) && seed >= 0 && seed <= 4294967295) update({ seed }); }}/></label>
      </EditorDisclosure>
      {issue && <p role="alert" className="model-page-error">{issue}</p>}
    </div><ModuleAction request={{ module: 'image-edit', settings: s }} controls={downloads} generateLabel="Generate image" generateDisabled={!valid || uploading || creating || data.cloud.busy} submitting={creating} onGenerate={() => void generate()} onConnect={props.openGPU} onManage={props.openDownloads} caption={uploading ? 'Uploading reference images…' : valid ? `${imageEditSampling(s).steps} steps · Qwen Image 2.1` : 'Add a reference image and describe your edit.'}/></section>
    <section className={`workspace image-workspace ${selected ? '' : 'workspace-idle'}`}><div className="workspace-header"><div><span className="workspace-overline">YOUR IMAGE EDIT WORKSPACE</span><h2>{selected?.title || 'Make it your own'}</h2></div>{selected && <button className="icon-button" aria-label="Close image preview" onClick={props.close}><X size={18}/></button>}</div>
      {!selected ? <WorkspaceWelcome kind="photo" library={props.library} openActive={current ? () => props.select(current.id) : undefined}/> : !done ? <GenerationProgress job={selected} kind="photo" online={downloads.online} onCancel={() => void action('cancel')} onResume={() => void action('resume')} onReuse={() => reuse(selected)}/> : <>
        <div className="image-preview-stage"><div className="preview-toolbar"><div className="preview-tabs"><button aria-pressed={!compare} onClick={() => setCompare(false)}>Result</button>{original && <button aria-pressed={compare} onClick={() => setCompare(true)}>Compare</button>}</div><button className="icon-button" aria-label="View image fullscreen" onClick={() => setExpanded(true)}><ArrowsOut size={17}/></button></div>
          <div className="image-result-frame" style={{ aspectRatio: `${width}/${height}` }}><img src={`/api/jobs/${selected.id}/output`} alt={selected.title}/>{compare && original && <img className="image-before" src={`/api/assets/${original.id}/original`} alt="Original Image 1" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}/>}</div>
          {compare && <input className="image-compare-slider" aria-label="Compare original and result" type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))}/>}
          <div className="image-result-caption"><span>{width} × {height} · {frozen?.format.toUpperCase()} · {selected.elapsedSeconds?.toFixed(1)}s</span><a href={`/api/jobs/${selected.id}/output?download=1`} download><DownloadSimple size={14}/>Save image</a></div>
        </div>
        <div className="image-use-row"><button className="secondary-button" disabled={uploading} onClick={() => reuse(selected)}><ArrowCounterClockwise size={15}/>Reuse inputs</button></div>
        <details className="image-run-details"><summary>Run details</summary><p>{imageEditModelLabel(selected.image?.version)} · {frozen?.precision.toUpperCase()} · {frozen && imageEditSampling(frozen, selected.image?.version).steps} steps · {frozen && imageEditSamplingLabel(frozen)} · Seed {frozen?.seed}</p><p className="image-edit-frozen-prompt">{frozen?.prompt}</p><ol>{selected.image?.edit?.references.map((ref, i) => <li key={i}>Image {i + 1}: {ref.name}</li>)}</ol><a href={`/api/jobs/${selected.id}/workflow`}><DownloadSimple size={13}/>Export ComfyUI graph</a><a href={`/api/jobs/${selected.id}/image-native`}><DownloadSimple size={13}/>Save native PNG</a></details>
        <Dialog.Root open={expanded} onOpenChange={setExpanded}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="asset-preview-dialog photo-only image-edit-fullscreen"><header><div><Dialog.Title>{selected.title}</Dialog.Title><Dialog.Description className="visually-hidden">Full image preview, fitted to the available screen.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close fullscreen image"><X size={20}/></Dialog.Close></header><div className="asset-photo-stage"><img src={`/api/jobs/${selected.id}/output`} alt={selected.title}/></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      </>}
      {!!jobs.length && <div className="workspace-bottom"><div className="recent-heading"><h3>Recent edits <span>{jobs.length}</span></h3><button onClick={props.library}>View library</button></div><div className="image-recent-grid">{jobs.slice(0, 6).map(job => <button key={job.id} className={selected?.id === job.id ? 'selected' : ''} onClick={() => { props.select(job.id); setCompare(false); }}><div>{job.status === 'completed' ? <img src={`/api/jobs/${job.id}/poster`} alt={job.title}/> : <><ImageIcon size={21}/><span>{job.status}</span></>}</div><strong>{job.title}</strong></button>)}</div></div>}
    </section>
  </main>;
}
