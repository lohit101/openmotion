import { useCallback, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, ArrowsOut, DownloadSimple, FilmStrip, Image as ImageIcon, Sparkle, TShirt, User, X } from '@phosphor-icons/react';
import type { Asset, Bootstrap, Draft, Job } from '../shared/types';
import { outputDimensions } from '../shared/types';
import { imageDefaults, isImageJob, referenceViewIssue, type ImageDraft, type ImageSettings } from '../shared/image-replacement';
import { imagenDraft, imagenGeometry, imagenWorkflow, imagenWorkflows, type ImagenWorkflow } from '../shared/imagen';
import { imageFilesForSettings } from '../shared/models';
import { useCharacterDraft } from '../shared/characters';
import { api, AssetDrop, SmallSelect, Toggle } from './components';
import { FieldLabel } from './InfoTip';
import { EditorDisclosure, EditorSection, PromptEditor } from './EditorControls';
import type { DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import CharacterPicker from './CharacterPicker';
import { ReferenceViewControl } from './ReferenceViewPicker';
import WorkspaceWelcome from './WorkspaceWelcome';
import GenerationProgress from './GenerationProgress';
import { useOutputPresentation } from './useGenerationProgress';
import { toast } from 'sonner';
import './images.css';

const active = ['queued', 'running', 'reconnecting'];
const icons = { 'text-to-image': Sparkle, 'body-only': User, 'character-outfit': ImageIcon, 'clothing-only': TShirt };
export interface ImageWorkspaceProps {
  data: Bootstrap; motionDraft: Draft; draft: ImageDraft; setDraft: (draft: ImageDraft | ((old: ImageDraft) => ImageDraft)) => void;
  downloads: DownloadControls; selectedId: string | null; select: (id: string) => void; close: () => void;
  asset: (asset: Asset) => void; job: (job: Job) => void; error: (message: string) => void;
  openCharacters: () => void; openModels: () => void; openDownloads?: () => void; openGPU: () => void; library: () => void; motion: (asset: Asset, draft: Draft) => void;
}

export default function ImageWorkspace(props: ImageWorkspaceProps) {
  const { data, setDraft, downloads, error } = props;
  const draft = imagenDraft(props.draft), settings = draft.settings, mode = settings.workflow!;
  const textOnly = mode === 'text-to-image', clothingOnly = mode === 'clothing-only', characterEdit = !textOnly && !clothingOnly;
  const source = data.assets.find(a => a.id === draft.sourceId), reference = data.assets.find(a => a.id === draft.referenceId);
  const face = data.assets.find(a => a.id === draft.faceId), clothing = data.assets.find(a => a.id === draft.clothingId);
  const characterMode = characterEdit && draft.referenceMode === 'character', character = data.characters?.find(c => c.id === draft.characterId);
  const characterIssue = characterMode && (!character || character.archived || character.revision !== draft.characterRevision || !settings.bodyReferenceView || !settings.faceReferenceView);
  const viewIssue = characterEdit && (referenceViewIssue(settings.bodyReferenceView, reference) || referenceViewIssue(settings.faceReferenceView, face));
  const jobs = data.jobs.filter(j => isImageJob(j) && !j.deleted), selected = jobs.find(j => j.id === props.selectedId), current = jobs.find(j => active.includes(j.status));
  const online = data.connection.state === 'online', done = useOutputPresentation(selected);
  const [creating, setCreating] = useState(false), [extracting, setExtracting] = useState(false), [using, setUsing] = useState(false);
  const [compare, setCompare] = useState(false), [split, setSplit] = useState(50);
  const request = useRef<string | null>(null), preview = useRef<HTMLDivElement>(null);
  let geometry: ReturnType<typeof imagenGeometry> | undefined, geometryIssue = '';
  try { if (textOnly || source) geometry = imagenGeometry(settings, textOnly ? undefined : source); } catch (e) { geometryIssue = (e as Error).message; }
  const valid = !geometryIssue && !viewIssue && !characterIssue && (textOnly ? !!settings.prompt.trim() : !!source && (clothingOnly ? !!clothing : !!reference));
  const required = imageFilesForSettings(settings), ready = required.every(id => downloads.state.files.find(f => f.id === id)?.status === 'installed');
  const update = (value: Partial<ImageSettings>) => setDraft(old => { const next = imagenDraft(old); return { ...next, settings: { ...next.settings, ...value } }; });
  const chooseMode = (value: ImagenWorkflow) => { setDraft(old => imagenDraft(old, value)); request.current = null; };
  const choose = (slot: 'sourceId' | 'referenceId' | 'faceId' | 'clothingId', asset: Asset | null) => {
    if (asset) props.asset(asset);
    setDraft(old => { const next = imagenDraft(old); return { ...next, [slot]: asset?.id || null,
      ...(slot === 'referenceId' ? { referenceMode: 'images', characterId: null, characterRevision: null } : {}),
      settings: { ...next.settings, ...(slot === 'referenceId' ? { bodyReferenceView: null } : {}), ...(slot === 'faceId' ? { faceReferenceView: null } : {}) } }; });
    request.current = null;
  };
  const generate = useCallback(async () => {
    if (creating || !online || !valid || !ready || downloads.state.busy || data.cloud.busy) return;
    setCreating(true); request.current ||= crypto.randomUUID();
    try {
      const response = await fetch('/api/images/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current }, body: JSON.stringify(draft) });
      const value = await response.json(); if (!response.ok) { request.current = null; throw new Error(value.error); }
      request.current = null; props.job(value); props.select(value.id); setCompare(false);
    } catch (e) { error((e as Error).message); } finally { setCreating(false); }
  }, [creating, online, valid, ready, downloads.state.busy, data.cloud.busy, draft, props.job, props.select, error]);
  const extract = async () => {
    if (!props.motionDraft.sourceId || extracting) return; setExtracting(true);
    try { const asset = await api<Asset>('/images/source-frame', { sourceId: props.motionDraft.sourceId, time: props.motionDraft.settings.start }); choose('sourceId', asset); toast.success('Source frame added'); }
    catch (e) { error((e as Error).message); } finally { setExtracting(false); }
  };
  const reuse = (job: Job) => {
    if (!job.image) return;
    const old = { referenceMode: 'images' as const, characterId: null, characterRevision: null, sourceId: job.sourceId || null, referenceId: job.referenceId || null,
      faceId: job.image.faceId, clothingId: job.image.settings.workflow === 'clothing-only' ? job.referenceId : job.image.clothingId || null, maskId: null, settings: { ...imageDefaults, ...job.image.settings, randomSeed: false } };
    setDraft(imagenDraft(old)); toast.success('Inputs and settings loaded', { description: 'The saved original stays unchanged.' });
  };
  const action = async (name: 'cancel' | 'resume') => { if (!selected) return; try { await api(`/jobs/${selected.id}/${name}`, name === 'resume' ? { retryMissing: !!selected.retryRequired } : {}); } catch (e) { error((e as Error).message); } };
  const useForMotion = async () => {
    if (!selected || using) return; setUsing(true);
    try { const result = await api<{ asset: Asset; draft: Draft }>(`/images/jobs/${selected.id}/use`, {}); props.motion(result.asset, result.draft); toast.success('Image sent to Remotion'); }
    catch (e) { error((e as Error).message); } finally { setUsing(false); }
  };
  const selectedSource = selected ? data.assets.find(a => a.id === selected.sourceId) : undefined;
  const [outWidth, outHeight] = selected ? outputDimensions(selected) : [3, 4];
  const unavailable = geometryIssue || viewIssue || (characterIssue ? 'Choose a current character and its body and face views.' : !valid ? textOnly ? 'Describe the image you want to create.' : clothingOnly ? 'Add a target photo and a clothing reference.' : 'Add a target photo and a character.' : null);
  return <main className="create-layout image-layout workflow-layout">
    <section className="editor image-editor"><div className="editor-scroll">
      <div className="editor-heading"><span className="section-icon"><ImageIcon size={19} /></span><h1>Imagen</h1><span className="imagen-model-label">Qwen 2.1</span></div>
      <p className="editor-description">Create a photograph. Recast a character. Change an outfit.</p>
      <div className="imagen-workflows" role="group" aria-label="Imagen workflow">{imagenWorkflows.map(item => { const Icon = icons[item.id]; return <button type="button" key={item.id} aria-pressed={mode === item.id} onClick={() => chooseMode(item.id)}><Icon size={20} weight={mode === item.id ? 'fill' : 'regular'} /><strong>{item.label}</strong><span>{item.description}</span></button>; })}</div>
      {!textOnly && <EditorSection title="Scene" help="The target defines pose, camera distance, scale, expression, lighting and background. The whole image is editable; there is no brush or mask to manage.">
        <div className="imagen-target"><AssetDrop kind="image" label="Target photo" emptyLabel="Add the target photograph" asset={source} onAsset={a => choose('sourceId', a)} onError={error} help="Use the original video frame for a Remotion repaint. Keep the camera composition you want in the final image." /></div>
        {props.motionDraft.sourceId && <button className="image-extract-button" onClick={extract} disabled={extracting}><FilmStrip size={15} />{extracting ? 'Extracting frame…' : 'Use the selected Remotion frame'}</button>}
      </EditorSection>}
      {characterEdit && <EditorSection title="Character" help="Use one character photo, or separate body and facial references. On a multi-angle sheet, choose the view that best matches the target.">
        <div className="imagen-reference-mode" role="group" aria-label="Character source">{(['images', 'character'] as const).map(value => <button type="button" key={value} aria-pressed={draft.referenceMode === value} onClick={() => setDraft(old => ({ ...imagenDraft(old), referenceMode: value }))}>{value === 'images' ? 'Upload photos' : 'Saved character'}</button>)}</div>
        {characterMode ? <CharacterPicker characters={data.characters || []} assets={data.assets} id={draft.characterId} revision={draft.characterRevision} bodyView={settings.bodyReferenceView} faceView={settings.faceReferenceView}
          choose={c => setDraft(old => { const next = imagenDraft(old), bound = useCharacterDraft(next, c); return { ...bound, settings: { ...next.settings, bodyReferenceView: c.bodyView, faceReferenceView: c.faceView } }; })}
          changeView={(kind, view) => update(kind === 'body' ? { bodyReferenceView: view } : { faceReferenceView: view })} manage={props.openCharacters} />
          : <div className="imagen-character-inputs"><div><AssetDrop kind="image" label="Character / body" emptyLabel="Add your character" asset={reference} onAsset={a => choose('referenceId', a)} onError={error} help="Defines identity, hair, skin tone and physique. Body only keeps target clothes; Character + outfit can use this character's clothes." /><ReferenceViewControl asset={reference} view={settings.bodyReferenceView} kind="body" change={bodyReferenceView => update({ bodyReferenceView })} /></div>
            <div><AssetDrop kind="image" label="Face reference · optional" emptyLabel="Add face photo or sheet" asset={face} onAsset={a => choose('faceId', a)} onError={error} help="A closer reference of the same person. It controls facial geometry and identity, while the target controls expression, gaze and head direction." /><ReferenceViewControl asset={face} view={settings.faceReferenceView} kind="face" change={faceReferenceView => update({ faceReferenceView })} /></div></div>}
      </EditorSection>}
      {(clothingOnly || mode === 'character-outfit') && <EditorSection title={clothingOnly ? 'Clothing' : 'Outfit'} help="Accepts clothes worn by a person, on a mannequin or shown alone. The clothing model's identity and body are excluded from the instructions.">
        <div className="imagen-outfit"><AssetDrop kind="image" label={clothingOnly ? 'Clothing reference' : 'Clothing reference · optional'} emptyLabel="Add the outfit" asset={clothing} onAsset={a => choose('clothingId', a)} onError={error} /></div>
        {!clothingOnly && !clothing && <p className="editor-inline-note">Uses the character reference’s outfit when no clothing image is added.</p>}
      </EditorSection>}
      {textOnly ? <section className="imagen-prompt"><FieldLabel label="Describe your image" htmlFor="imagen-description" help="Describe the subject, composition, camera and lighting. The selected output size controls the actual canvas." /><textarea id="imagen-description" value={settings.prompt} maxLength={8000} onChange={e => update({ prompt: e.target.value })} placeholder="A candid portrait in soft window light, natural skin texture, a quiet room…" /></section>
        : <PromptEditor id="imagen-instructions" label="Additional directions" value={settings.prompt} defaultValue="" onChange={prompt => update({ prompt })} help="The selected mode already assigns each image a role and matches pose, scale and scene lighting. Add exceptions or scene-specific requirements here; they take priority over conflicting defaults." />}
      <EditorSection title="Output" help="Photo quality uses the undistilled base model for 40 steps. Fast uses the matching eight-step adapter. Higher resolution supplies more pixels but does not guarantee identity or realism.">
        <div className="imagen-output-grid"><SmallSelect label="Quality" value={settings.qwenQuality} onChange={value => update({ qwenQuality: value as ImageSettings['qwenQuality'] })} options={[{ value: 'quality', label: 'Photo · 40 native steps' }, { value: 'fast', label: 'Fast · 8 steps' }]} />
          <SmallSelect label="Native size" value={String(settings.megapixels)} onChange={value => update({ megapixels: Number(value) as 1 | 2 })} options={[{ value: '1', label: '1024 px long edge' }, { value: '2', label: '2048 px long edge' }]} /></div>
        {textOnly && <SmallSelect label="Aspect ratio" value={settings.outputAspect || '1:1'} onChange={value => update({ outputAspect: value as ImageSettings['outputAspect'] })} options={['1:1', '9:16', '16:9', '3:4', '4:3'].map(value => ({ value, label: value }))} />}
        {geometry && <p className="imagen-output-size">{geometry.outputWidth} × {geometry.outputHeight}<span>{textOnly ? 'Native generation' : 'Target composition · full-image edit'}</span></p>}
      </EditorSection>
      <EditorDisclosure title="Advanced settings" meta={settings.promptLanguage === 'zh' ? '中文 instructions' : 'English instructions'}>
        <div className="full-label"><FieldLabel label="Instruction language" help="Switches built-in instructions between English and Chinese. Your additional text is preserved as written. Neither language is proven universally better or cheaper in tokens." /><SmallSelect label="Instruction language" value={settings.promptLanguage || 'en'} onChange={value => update({ promptLanguage: value as 'en' | 'zh' })} options={[{ value: 'en', label: 'English' }, { value: 'zh', label: '中文 · Chinese' }]} /></div>
        <Toggle label="Random seed" checked={settings.randomSeed} onChange={randomSeed => update({ randomSeed })} />
        <label className="imagen-seed" htmlFor="imagen-seed">Seed<input id="imagen-seed" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} disabled={settings.randomSeed} value={settings.seed} onChange={e => { const seed = Number(e.target.value); if (Number.isSafeInteger(seed) && seed >= 0) update({ seed }); }} /></label>
      </EditorDisclosure>
      {(viewIssue || geometryIssue || characterIssue) && <p className="model-page-error" role="alert">{viewIssue || geometryIssue || 'Select a current character and valid body and face views.'}</p>}
    </div><ModuleAction request={{ module: 'imagen', settings }} controls={downloads} generateLabel={textOnly ? 'Create image' : 'Generate'} generateDisabled={!valid || creating} submitting={creating} onGenerate={generate}
      onConnect={props.openGPU} onManage={props.openDownloads || props.openModels} unavailable={unavailable} caption={settings.qwenQuality === 'quality' ? 'Photo quality · native sampling' : 'Fast preview · eight steps'} /></section>
    <section className={`workspace image-workspace ${selected ? '' : 'workspace-idle'}`}><div className="workspace-header"><div><span className="workspace-overline">YOUR IMAGE WORKSPACE</span><h2>{selected?.title || 'A new point of view'}</h2></div>{selected && <button className="icon-button" aria-label="Close image preview" onClick={props.close}><X size={18} /></button>}</div>
      {!selected ? <WorkspaceWelcome kind="photo" library={props.library} openActive={current ? () => props.select(current.id) : undefined} /> : !done ? <GenerationProgress job={selected} kind="photo" online={online} onCancel={() => void action('cancel')} onResume={() => void action('resume')} onReuse={() => reuse(selected)} /> : <>
        <div className="image-preview-stage"><div className="preview-toolbar"><div className="preview-tabs"><button aria-pressed={!compare} onClick={() => setCompare(false)}>Result</button>{selectedSource && <button aria-pressed={compare} onClick={() => setCompare(true)}>Compare</button>}</div><button className="icon-button" aria-label="View image fullscreen" onClick={() => void preview.current?.requestFullscreen()}><ArrowsOut size={17} /></button></div>
          <div ref={preview} className="image-result-frame" style={{ aspectRatio: `${outWidth}/${outHeight}` }}><img src={`/api/jobs/${selected.id}/output`} alt={selected.title} />{compare && selectedSource && <img className="image-before" src={`/api/assets/${selectedSource.id}/original`} alt="Original target" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />}</div>
          {compare && <input className="image-compare-slider" aria-label="Compare original and result" type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} />}
          <div className="image-result-caption"><span>{outWidth} × {outHeight} · {selected.elapsedSeconds?.toFixed(1)}s</span><a href={`/api/jobs/${selected.id}/output?download=1`} download><DownloadSimple size={14} />Save image</a></div>
        </div>
        <div className="image-use-row"><button className="secondary-button" onClick={() => reuse(selected)}><ArrowCounterClockwise size={15} />Reuse inputs</button><button className="primary-button compact" disabled={using} onClick={useForMotion}>Use in Remotion<ArrowRight size={16} /></button></div>
        <details className="image-run-details"><summary>Run details</summary><p>{selected.image?.version === 'imagen-v1' ? `${imagenWorkflows.find(item => item.id === imagenWorkflow(selected.image!.settings))?.label} · ${selected.image?.settings.qwenQuality === 'fast' ? '8 steps' : '40 native steps'}` : `Saved recipe · ${selected.image?.version || selected.image?.settings.model}`} · Seed {selected.image?.settings.seed}</p><p>{selected.image?.conditioningPrompt || selected.image?.settings.prompt}</p><a href={`/api/jobs/${selected.id}/workflow`}><DownloadSimple size={13} />Export ComfyUI graph</a></details>
      </>}
      {selected && <div className="workspace-bottom"><div className="recent-heading"><h3>Recent images <span>{jobs.length}</span></h3><button onClick={props.library}>View library<ArrowRight size={13} /></button></div><div className="image-recent-grid">{jobs.slice(0, 6).map(job => <button key={job.id} className={selected.id === job.id ? 'selected' : ''} onClick={() => { props.select(job.id); setCompare(false); }}><div>{job.status === 'completed' ? <img src={`/api/jobs/${job.id}/poster`} alt={job.title} /> : <><ImageIcon size={21} /><span>{job.status}</span></>}</div><strong>{job.title}</strong></button>)}</div></div>}
    </section>
  </main>;
}
