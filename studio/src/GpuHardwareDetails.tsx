import type {GpuHardware,GpuOffer} from '../shared/cloud';
import {isDgxSpark} from '../shared/cloud';
import {recommendationWeights} from '../shared/cloud-recommendations';

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
export function GpuScoreDetails({offer}:{offer:GpuOffer}){
  const score=offer.recommendation;if(!score)return null;
  const labels={compute:'Compute rating',value:'Hourly price',setup:'Network & disk',memory:'VRAM headroom',transfer:'Transfer price',reliability:'Host reliability'};
  return <details className="gpu-score-details"><summary>Value score <strong>{score.score.toFixed(1)} / 100</strong></summary><p>Relative to these search results. Provider ratings estimate suitability; they are not Remotion, Imagen or Clarity render benchmarks.</p><dl>{(Object.keys(labels)as (keyof typeof labels)[]).map(key=><div key={key}><dt>{labels[key]}</dt><dd>{score.components[key].toFixed(1)} <small>/ {recommendationWeights[key]}</small></dd></div>)}</dl><p>Compute uses DLPerf, memory bandwidth and TFLOPS. VRAM gains stop at twice your minimum. Missing ratings score zero; top picks require DLPerf and memory bandwidth. Setup uses the slower of advertised downloads and disk writes.</p></details>;
}
