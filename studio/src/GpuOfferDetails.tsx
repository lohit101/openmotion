import { CaretDown, Cpu, Lightning, ShieldCheck, X } from '@phosphor-icons/react';
import type { GpuOffer } from '../shared/cloud';
import { gpuDisplayName, withinDownloadBudget } from '../shared/cloud';
import GpuHardwareDetails, { GpuScoreDetails, gpuMoney, transferRate } from './GpuHardwareDetails';
import { Button } from './ui/Button';

export default function GpuOfferDetails({ offer, busy, rent, close }: { offer: GpuOffer; busy: boolean; rent: () => void; close?: () => void }) {
  return <aside className="gpu-offer-details-v3" id="selected-gpu-offer" aria-label={`${gpuDisplayName(offer.gpu)} rental details`}>
    <header className="gpu-review-heading"><div className="gpu-review-gpu-icon"><Cpu size={20}/></div><div><h2>{gpuDisplayName(offer.gpu)}</h2><p>{offer.location || 'Location unavailable'} · #{offer.machineId}</p></div>{close&&<Button variant="ghost" size="icon" aria-label="Close GPU review" onClick={close}><X size={18}/></Button>}</header>
    <div className="gpu-review-scroll">
      <dl className="gpu-review-summary">{[['VRAM',`${Math.round(offer.vram)} GB`],['RAM',`${Math.round(offer.ram)} GB`],['Download',`${Math.round(offer.downloadMbps).toLocaleString()} Mbps`],['Reliability',`${(offer.reliability*100).toFixed(1)}%`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="gpu-review-assurance"><GpuScoreDetails offer={offer}/>{offer.verified&&<span><ShieldCheck size={13}/>Verified</span>}</div>
      <dl className="gpu-review-price"><div><dt>GPU compute</dt><dd>{gpuMoney(offer.computeHourly)}<small> / hr</small></dd></div><div><dt>Storage · {offer.disk} GB</dt><dd>{gpuMoney(offer.storageHourly,4)}<small> / hr</small></dd></div><div className="gpu-review-total"><dt>Total</dt><dd>{gpuMoney(offer.totalHourly)}<small> / hr</small></dd></div></dl>
      <dl className="gpu-review-transfer"><div><dt>Download fee</dt><dd>{transferRate(offer.downloadPerGB)}</dd></div><div><dt>All model files · {offer.modelDownloadGB?.toFixed(1)??'—'} GB</dt><dd>≈ {gpuMoney(offer.modelDownloadCost,2)}</dd></div></dl>
      <details className="gpu-review-hardware"><summary><Cpu size={14}/>Hardware & network<CaretDown size={14}/></summary><GpuHardwareDetails hardware={offer}/></details>
    </div>
    <footer className="gpu-review-footer"><Button variant="primary" className="gpu-rent-button" disabled={busy||!offer.compatible||offer.totalHourly===null||!withinDownloadBudget(offer.downloadPerGB)} onClick={rent}><Lightning size={16} weight="fill"/><span>{busy?'Please wait…':'Rent GPU'}</span><strong>{gpuMoney(offer.totalHourly)} / hr</strong></Button><small>Starts paid compute. Transfers are extra; storage stays billed when paused.</small></footer>
  </aside>;
}
