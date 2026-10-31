import { useEffect, useRef, useState } from 'react';
import { ArrowsOut, ArrowCounterClockwise, DownloadSimple, Info, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { outputDimensions, type Asset, type Bootstrap, type Job } from '../shared/types';
import { upscaleGeometry, upscaleProcessingGeometry, upscaleSettingsSchema, upscaleSourceSchema, type UpscaleSettings, type UpscaleSource, type UpscaleTools } from '../shared/upscale';
import { upscaleModelFiles } from '../shared/models';
import { api, AssetDrop, SmallSelect, Toggle, VideoPlayer, VideoPlayback } from './components';
import { EditorDisclosure, EditorSection } from './EditorControls';
import { FieldLabel } from './InfoTip';
import type { DownloadControls } from './ModelDownloads';
import ModuleAction from './ModuleAction';
import GenerationProgress from './GenerationProgress';
import WorkspaceWelcome from './WorkspaceWelcome';
import './clarity.css';

function initial(){try{const v=JSON.parse(localStorage.getItem('recast-clarity-draft')||'{}');return {source:v.source?upscaleSourceSchema.parse(v.source):null,settings:upscaleSettingsSchema.parse(v.settings||{})};}catch{return {source:null as UpscaleSource|null,settings:upscaleSettingsSchema.parse({})};}}
function UpscaleDetails({job}:{job:Job}){
  const run=job.upscale!,phase=run.phaseSeconds||{};
  const seconds=(v:number)=>v.toFixed(1)+' s';
  const rows:Record<string,string|number>={Model:run.model,Input:run.sourceWidth+' × '+run.sourceHeight,Output:job.width+' × '+job.height,Processing:run.settings.processing==='fast1080'?'Fast 1080p · AI at 720p':'Native output resolution',Frames:run.frames,'Original FPS':run.fps,Attention:run.attention||'Not recorded'};
  if(job.elapsedSeconds!=null)rows['Total including transfers']=seconds(job.elapsedSeconds);
  if(run.workerTotalSeconds!==undefined)rows['Total worker time']=seconds(run.workerTotalSeconds);
  else if(run.workerSeconds!==undefined)rows['Upscaler processing']=seconds(run.workerSeconds);
  for(const [key,label]of Object.entries({preflight:'Model and source checks',modelLoading:'Model loading',inferenceAndBridge:'Upscaling and lossless verification',inputStreaming:'↳ Input streaming',colorMatching:'↳ Color matching',bridgeWriting:'↳ Lossless writing',bridgeVerification:'↳ Lossless verification',finalEncoding:'Final MP4 encoding'})){
    if(phase[key]!==undefined)rows[label]=seconds(phase[key]);
  }
  if(run.execution){
    rows['Color processing']=(run.execution.colorCUDAFrames||0)+' GPU / '+(run.execution.colorCPUFrames||0)+' CPU frames';
    rows['CPU helper threads']=run.execution.cpuThreads;
  }
  return <dl className="clarity-details">{Object.entries(rows).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
export default function ClarityWorkspace({data,downloads,selectedId,select,added,assetAdded,openGPU,openDownloads,library}:{
  data:Bootstrap;downloads:DownloadControls;selectedId:string|null;select:(id:string|null)=>void;added:(job:Job)=>void;assetAdded:(asset:Asset)=>void;openGPU:()=>void;openDownloads:()=>void;library:()=>void;
}){
  const [draft,setDraft]=useState(initial),[tools,setTools]=useState<UpscaleTools|null>(null),[checking,setChecking]=useState(false),[submitting,setSubmitting]=useState(false),[details,setDetails]=useState(false),[compare,setCompare]=useState(false);
  const requestKey=useRef(crypto.randomUUID());const online=data.connection.state==='online';
  const videos=data.jobs.filter(j=>!j.deleted&&j.status==='completed'&&!!j.output&&j.mediaType!=='image'&&!j.anchorChild);
  const selected=data.jobs.find(j=>j.id===selectedId&&j.upscale&&!j.deleted);
  const sourceJob=videos.find(j=>j.id===draft.source?.jobId),sourceAsset=data.assets.find(a=>a.id===draft.source?.assetId&&a.kind==='video');
  const [width,height]=sourceJob?outputDimensions(sourceJob):[sourceAsset?.width||0,sourceAsset?.height||0];
  let geometry:ReturnType<typeof upscaleGeometry>|null=null,geometryError='';if(width&&height)try{upscaleProcessingGeometry(width,height,draft.settings);geometry=upscaleGeometry(width,height,draft.settings.height);}catch(e){geometryError=(e as Error).message;}
  const active=data.jobs.some(j=>['running','queued','reconnecting'].includes(j.status)),filesReady=upscaleModelFiles.every(id=>downloads.state.files.find(f=>f.id===id)?.status==='installed');
  useEffect(()=>{try{localStorage.setItem('recast-clarity-draft',JSON.stringify(draft));}catch{/* A storage-disabled browser can still upscale. */}requestKey.current=crypto.randomUUID();},[draft]);
  const refresh=async()=>{setChecking(true);try{setTools(await api<UpscaleTools>('/upscale/status'));}catch(e){toast.error('Could not check Clarity',{description:(e as Error).message});}finally{setChecking(false);}};
  useEffect(()=>{setTools(null);if(online)void refresh();},[online,data.connection.endpoint,data.cloud.refreshedAt]);
  useEffect(()=>{setDetails(false);setCompare(false);},[selectedId]);
  useEffect(()=>{if(online&&downloads.state.moduleSetup?.module==='clarity'&&['complete','failed'].includes(downloads.state.moduleSetup.status))void refresh();},[downloads.state.moduleSetup?.updatedAt,online]);
  const settings=(next:Partial<UpscaleSettings>)=>setDraft(old=>({...old,settings:{...old.settings,...next,...(next.height===720?{processing:'native' as const}:{})}}));

  const create=async()=>{if(!draft.source)return;setSubmitting(true);try{const job=await api<Job>('/upscale/jobs',{source:draft.source,settings:draft.settings,requestKey:requestKey.current});added(job);select(job.id);requestKey.current=crypto.randomUUID();}catch(e){toast.error('Upscale not started',{description:(e as Error).message});}finally{setSubmitting(false);}};
  const action=async(job:Job,verb:'cancel'|'recover')=>{try{added(await api<Job>(`/upscale/jobs/${job.id}/${verb}`,{}));}catch(e){toast.error('Clarity needs attention',{description:(e as Error).message});}};
  const reuse=(job:Job)=>{setDraft({source:job.upscale!.source,settings:job.upscale!.settings});select(null);toast.info('Upscale settings loaded. Start a new attempt when ready.');};
  return <main className="create-layout workflow-layout clarity-layout"><section className="editor clarity-editor"><div className="editor-scroll">
    <div className="editor-heading"><span className="section-icon"><ArrowsOut size={19}/></span><h1>Clarity</h1></div><p className="editor-description">Video upscaling. More detail, same scene.</p>
    <EditorSection title="Source video">
      <div className="full-label"><FieldLabel label="From your library" help="Upscales the completed saved result, including its facial finishing. Originals stay unchanged."/><SmallSelect label="Library video to upscale" value={sourceJob?.id||'none'} onChange={id=>setDraft(old=>({...old,source:id!=='none'?{jobId:id}:null}))} options={[{value:'none',label:sourceAsset?'Uploaded video':'Choose a video or upload below'},...videos.map(j=>({value:j.id,label:j.title}))]}/></div>
      {sourceJob?<div className="clarity-source"><VideoPlayback src={`/api/jobs/${sourceJob.id}/video`} poster={`/api/jobs/${sourceJob.id}/poster`} width={width} height={height} label="Source video preview"/><div className="clarity-source-caption"><span>{sourceJob.title}</span><button className="icon-button" aria-label="Clear source video" onClick={()=>setDraft(old=>({...old,source:null}))}><X size={15}/></button></div></div>:<AssetDrop kind="video" asset={sourceAsset} label="Upload video" emptyLabel="Drop a video or browse" help="Uses the whole uploaded clip. Original timing, audio and framing are preserved. Constant-rate SDR video, up to five minutes." onError={message=>toast.error(message)} onAsset={asset=>{if(asset)assetAdded(asset);setDraft(old=>({...old,source:asset?{assetId:asset.id}:null}));}}/>}
    </EditorSection>
    <EditorSection title="Output"><div className="full-label"><FieldLabel label="Resolution" help="Sets the shorter edge. Preserves the complete image and original aspect ratio; no crop or frame interpolation."/><SmallSelect label="Upscale resolution" value={String(draft.settings.height)} onChange={v=>settings({height:Number(v)as 720|1080})} options={[{value:'720',label:'720p · HD'},{value:'1080',label:'1080p · Full HD'}]}/></div>
      {draft.settings.height===1080&&<div className="full-label"><FieldLabel label="Processing" help="Native restores detail at the complete output resolution. Fast 1080p uses the same AI model at 720p and resizes once during export. It uses less GPU work, with less fine detail. GPU speed comparison pending."/><SmallSelect label="1080p processing" value={draft.settings.processing||'native'} onChange={v=>settings({processing:v as UpscaleSettings['processing']})} options={[{value:'native',label:'Native 1080p · most detail'},{value:'fast1080',label:'Fast 1080p · AI at 720p',disabled:!!width&&Math.min(width,height)>=720,disabledReason:'Use native processing for inputs already at 720p or above.'}]}/>{draft.settings.processing==='fast1080'&&<p className="editor-description">AI detail at 720p, resized to 1080p. Faster, with less fine detail than native 1080p.</p>}</div>}
      {geometry&&<dl className="output-summary"><div><dt>Input</dt><dd>{width} × {height}</dd></div><div><dt>Output</dt><dd>{geometry.outputWidth} × {geometry.outputHeight}</dd></div></dl>}{geometryError&&<p className="model-page-error" role="alert">{geometryError}</p>}
      <div className="clarity-model"><strong>FlashVSR+ Turbo <small>Experimental</small></strong><span>Original video retained · High-quality MP4</span></div>
    </EditorSection>
    <EditorDisclosure title="Advanced settings" meta="Motion & color"><Toggle label="Match source colors" checked={draft.settings.matchColors} onChange={v=>settings({matchColors:v})} detail="Matches low-frequency output colors to the source scene. Does not repair identity, anatomy or expressions."/><div className="full-label"><FieldLabel label="Motion detail" help="More motion detail reduces temporal compression and takes longer. Neither option changes the frame rate."/><SmallSelect label="Upscale motion detail" value={draft.settings.motion} onChange={v=>settings({motion:v as UpscaleSettings['motion']})} options={[{value:'fast',label:'Fast · standard motion detail'},{value:'detail',label:'More motion detail · slower'}]}/></div></EditorDisclosure>
  </div><ModuleAction request={{module:'clarity'}} controls={downloads} runtimeReady={tools?.ready===true} runtimeNotes={['Linux NVIDIA · x86_64 · 20 GiB free VRAM','Initial runtime setup downloads several GB of packages. Updates reuse compatible packages and existing weights.',...(tools?.error?[tools.error]:[])]} generateLabel="Upscale video" generateDisabled={!geometry||!draft.source||active||!!tools?.processing||checking} submitting={submitting} onGenerate={()=>void create()} onConnect={openGPU} onManage={openDownloads} caption={!draft.source?'Choose a library video or upload a clip.':'Ready on your GPU'} /></section>
    <section className="clarity-workspace"><header className="clarity-workspace-header"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>{selected?.title||'Clarity'}</h2></div>{selected&&<button className="icon-button" aria-label="Close upscale preview" onClick={()=>select(null)}><X size={19}/></button>}</header>
      <div className="clarity-canvas">{selected?.error?.includes('SDPA block-mask fallback')&&<p className="model-page-error" role="status">Use Download Clarity below to update the runtime, then choose Reuse settings for a new attempt. Check &amp; resume only checks this original failed attempt.</p>}{!selected?<WorkspaceWelcome kind="video" library={library} openActive={data.jobs.find(j=>j.upscale&&['running','queued','reconnecting'].includes(j.status))?()=>select(data.jobs.find(j=>j.upscale&&['running','queued','reconnecting'].includes(j.status))!.id):undefined}/>:selected.status==='completed'&&selected.output?<><div className="clarity-result-bar"><button className="secondary-button" onClick={()=>setCompare(v=>!v)}>{compare?'Show result':'Compare source'}</button><button className="icon-button" aria-label="View upscale details" onClick={()=>setDetails(v=>!v)}><Info size={17}/></button><a className="secondary-button" href={`/api/jobs/${selected.id}/video?download=1`}><DownloadSimple size={16}/>Download</a></div>{details?<UpscaleDetails job={selected}/>:<VideoPlayer job={selected} compare={compare}/>}</>:<GenerationProgress job={selected} kind="video" online={online} onCancel={()=>void action(selected,'cancel')} onResume={()=>void action(selected,'recover')} onReuse={()=>reuse(selected)}/>}</div>
      <section className="clarity-recent"><h3>Recent upscales</h3><div>{data.jobs.filter(j=>j.upscale&&!j.deleted).slice(0,10).map(j=><button key={j.id} className={selectedId===j.id?'active':''} onClick={()=>select(j.id)}>{j.poster?<img src={`/api/jobs/${j.id}/poster`} alt=""/>:<ArrowsOut size={24}/>}<span>{j.title}<small>{j.status==='completed'?`${j.width} × ${j.height}`:j.progress.stage}</small></span></button>)}</div></section>
    </section></main>;
}
