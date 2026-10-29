import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import type { Asset, Settings } from '../shared/types';
import { anchorIssue, referenceFrameIndex } from '../shared/anchored-video';
import { clipFrameCount, clipTime, frameFloor } from '../shared/clip';
import { FieldLabel } from './InfoTip';
import { SmallSelect } from './components';
import './anchored-video.css';

export default function AnchorReferenceControls({ settings: s, source, reference, change }: {
  settings: Settings; source?: Asset; reference?: Asset; change: (v: Partial<Settings>) => void;
}) {
  const video = useRef<HTMLVideoElement>(null), frames = clipFrameCount(s.seconds, s.fps), index = referenceFrameIndex(s);
  const later = s.referenceTime != null && index !== 0;
  const seek = () => { if (video.current && s.referenceTime != null) video.current.currentTime = s.referenceTime; };
  useEffect(seek, [s.referenceTime, source?.id]);
  if (s.referencePreparation !== 'prepared') return null;
  const selectFrame = (frame: number) => { if (Number.isFinite(frame)) change({ referenceTime: (frameFloor(s.start, 24) + Math.round(frame)) / 24 }); };
  const issue = anchorIssue(s);
  return <section className="anchor-reference-controls" aria-label="Reference frame position">
    <div className="full-label"><FieldLabel label="Reference frame position" help="For a hand-covered opening or a later clear face, choose the source moment your edited reference matches. Earlier motion is generated backward from that moment, later motion forward, then joined in the original order with the source audio. This adds a second directional request and may add a sampling window. Use one continuous shot. Selection never starts inference or downloads." />
      <SmallSelect label="Reference frame position" value={later ? 'later' : 'start'} disabled={!source} options={[{ value: 'start', label: 'At the beginning of the clip' }, { value: 'later', label: 'Later in clip · backward + forward', disabled: frames < 9, disabledReason: 'Select at least nine video frames first.' }]} onChange={value => change({ referenceTime: value === 'start' ? null : (frameFloor(s.start, 24) + Math.max(4, Math.min(frames-5, Math.round(frames/2)))) / 24 })} />
    </div>
    {later && source && <div className="anchor-frame-picker">
      <div className="anchor-frame-pair"><figure><video ref={video} src={`/api/assets/${source.id}/original`} muted playsInline preload="metadata" onLoadedMetadata={seek} aria-label="Source moment matching the edited frame" /><figcaption>Source moment</figcaption></figure><figure>{reference ? <img src={`/api/assets/${reference.id}/original`} alt="Edited character frame to match to the source moment" /> : <div className="anchor-frame-empty">Add edited frame</div>}<figcaption>Edited reference</figcaption></figure></div>
      <p className="anchor-match-instruction">Match this moment to your edited frame.</p>
      <label className="anchor-frame-range"><span>Frame <strong>{index}</strong><small>{clipTime(index/24)} into clip</small></span><input aria-label="Reference frame within selected clip" type="range" min="4" max={Math.max(4,frames-5)} step="1" value={Math.max(4,Math.min(frames-5,index))} onChange={e => selectFrame(Number(e.target.value))} /></label>
      <div className="anchor-frame-precise"><button type="button" className="icon-button" aria-label="Previous reference frame" disabled={index <= 4} onClick={() => selectFrame(index-1)}><ArrowLeft size={15} /></button><label>Source time<input type="number" aria-label="Reference source time in seconds" min={(frameFloor(s.start,24)+4)/24} max={(frameFloor(s.start,24)+frames-5)/24} step={1/24} value={Number((s.referenceTime ?? s.start).toFixed(4))} onChange={e => { const time = e.target.valueAsNumber; if (Number.isFinite(time)) change({ referenceTime: Math.round(time*24)/24 }); }} /><span>sec</span></label><button type="button" className="icon-button" aria-label="Next reference frame" disabled={index >= frames-5} onClick={() => selectFrame(index+1)}><ArrowRight size={15} /></button></div>
      {issue && <p className="model-page-error" role="alert">{issue}</p>}
    </div>}
  </section>;
}
