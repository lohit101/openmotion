import type {GpuHardware,GpuOffer} from '../shared/cloud';
import {isDgxSpark} from '../shared/cloud';
import {recommendationWeights} from '../shared/cloud-recommendations';
import { useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChartBar } from '@phosphor-icons/react';

export const gpuMoney=(value:number|null|undefined,digits=3)=>value===null||value===undefined||!Number.isFinite(value)?'Not reported':`$${value.toFixed(digits)}`;
export const transferRate=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?'Not reported':`$${value.toLocaleString('en-US',{maximumSignificantDigits:4})}/GB`;
const metric=(value:number|null|undefined,unit='')=>value!==null&&value!==undefined&&Number.isFinite(value)&&value>0?`${value.toLocaleString('en-US',{maximumFractionDigits:1})}${unit}`:'Not reported';

export function GpuHardwareSummary({hardware}:{hardware:GpuHardware}){
  return <dl className="gpu-card-specs">
    <div><dt>{isDgxSpark(hardware.gpu)?'Shared memory':'VRAM'}</dt><dd>{metric(hardware.vram,' GB')}</dd></div>
    <div><dt>Download speed</dt><dd>{metric(hardware.downloadMbps,' Mbps')}</dd></div>
    <div><dt>DLPerf rating</dt><dd>{metric(hardware.dlperf)}</dd></div>
    <div><dt>Memory bandwidth</dt><dd>{metric(hardware.memoryBandwidth,' GB/s')}</dd></div>
  </dl>;
}
export default function GpuHardwareDetails({hardware}:{hardware:GpuHardware}){
  const rows=[['System RAM',metric(hardware.ram,' GB')],['CPU / allocated cores',`${hardware.cpu||'Not reported'} · ${metric(hardware.cpus)}`],['CPU architecture',hardware.cpuArch||'Not reported'],
    ['DLPerf rating',metric(hardware.dlperf)],['Theoretical compute',metric(hardware.tflops,' TFLOPS')],['GPU memory bandwidth',metric(hardware.memoryBandwidth,' GB/s')],
    ['PCIe bandwidth',metric(hardware.pcie,' GB/s')],['Disk speed',metric(hardware.diskBandwidth,' MB/s')],['Download / upload',`${metric(hardware.downloadMbps)} / ${metric(hardware.uploadMbps)} Mbps`],
    ['Download charge',transferRate(hardware.downloadPerGB)],['Upload charge',transferRate(hardware.uploadPerGB)],['Driver / CUDA',`${hardware.driver||'Not reported'} / ${metric(hardware.cuda)}`],
    ['Compute capability',hardware.computeCapability?`${(hardware.computeCapability/100).toFixed(1)}`:'Not reported'],['Host reliability',metric(hardware.reliability*100,'%')],['Host verification',hardware.verified?'Verified':'Unverified']];
  return <dl className="gpu-hardware-details">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function GpuScoreDetails({offer,compact=false}:{offer:GpuOffer;compact?:boolean}){
  const [open,setOpen]=useState(false), beforePress=useRef(false);
  const score=offer.recommendation;if(!score)return null;
  const current=score.version==='value-v2',rated=score.confidence==='rated';
  const weights=current?recommendationWeights:{compute:35,value:25,setup:20,memory:10,transfer:5,reliability:5};
  const labels=current?{compute:'Compute',value:'Compute per dollar',setup:'Setup + work cost',memory:'VRAM',transfer:'Transfer',reliability:'Reliability'}:{compute:'Compute',value:'Hourly price',setup:'Network & disk',memory:'VRAM',transfer:'Transfer fee',reliability:'Reliability'};
  return <Tooltip.Provider delayDuration={180}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild><button type="button" className={`gpu-value-score${compact?' is-compact':''}`} aria-label={rated?`Value score ${score.score.toFixed(1)} out of 100`:'Unrated GPU: performance ratings are missing'}
      onPointerDownCapture={()=>{beforePress.current=open;}} onClick={event=>{event.preventDefault();event.stopPropagation();setOpen(event.detail===0?!open:!beforePress.current);}}>
      {!compact&&<><ChartBar size={14}/><span>Value score</span></>}<strong>{rated?score.score.toFixed(1):'Unrated'}</strong>{rated&&<small>/ 100</small>}
    </button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="gpu-score-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} hideWhenDetached>
      <div className="gpu-score-popover-title">{rated?'Value breakdown':'Performance not rated'}<b>{rated?`${score.score.toFixed(1)} / 100`:null}</b></div>
      {rated?<dl>{(Object.keys(labels)as (keyof typeof labels)[]).filter(key=>weights[key]>0).map(key=><div key={key}><dt>{labels[key]}</dt><dd>{score.components[key].toFixed(1)}<small> / {weights[key]}</small></dd><span className="gpu-score-meter"><i style={{width:`${Math.min(100,score.components[key]/weights[key]*100)}%`}}/></span></div>)}</dl>:<p>DLPerf and memory bandwidth are required for a recommendation. Missing ratings do not mean this GPU is slow.</p>}
      <p>{current?'Compute per dollar uses DLPerf and memory bandwidth divided by GPU + storage cost. Setup adds one model download and its running cost to one reference-hour of work. Capacity earns no bonus points.':'Saved score from the previous ranking system.'}</p>
      <p className="gpu-score-disclaimer">Relative to this search. Provider estimates, not measured render times.</p>
      <Tooltip.Arrow className="info-tip-arrow"/>
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
