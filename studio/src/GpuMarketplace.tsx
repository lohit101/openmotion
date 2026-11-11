import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, ArrowRight, Check, Cpu, CurrencyDollar, DownloadSimple, GraphicsCard, HardDrives, Info, Memory, ShieldCheck, SlidersHorizontal, Sparkle } from '@phosphor-icons/react';
import type { GpuOffer, MarketRequirements, OfferFilters } from '../shared/cloud';
import { DOWNLOAD_PRICE_CEILING, GPU_COMPUTE_CEILING, gpuDisplayName, gpuMarketplaceMinimums, marketplaceFilters } from '../shared/cloud';
import { SmallSelect, Toggle } from './components';
import { GpuHardwareSummary, GpuScoreDetails, gpuMoney, transferRate } from './GpuHardwareDetails';
import GpuFilterField from './GpuFilterField';
import { Button } from './ui/Button';

export function RentalConfiguration({ filters, onChange, requirements }: { filters: OfferFilters; onChange: (value: OfferFilters) => void; requirements?: MarketRequirements }) {
  const minimumDisk = requirements?.minDisk || gpuMarketplaceMinimums.disk;
  const extraCount = Number(!filters.verified) + Number(filters.minReliability !== .95) + Number(filters.maxDownloadPrice !== DOWNLOAD_PRICE_CEILING);
  const update = (changes: Partial<OfferFilters>) => onChange({ ...filters, ...changes });
  return <section className="gpu-filters-v3" aria-label="GPU search filters">
    <div className="gpu-filter-grid">
      <GpuFilterField label="Max / hour" ariaLabel="Maximum total hourly price" icon={<CurrencyDollar size={15} />} unit="/ hr" value={filters.maxHourly} min={.01} max={10} step={.01} integer={false} change={maxHourly => update({ maxHourly })} help={`GPU and selected storage combined. Bandwidth is separate. GPU compute also stays below $${GPU_COMPUTE_CEILING.toFixed(2)}/hr.`} />
      <GpuFilterField label="Min VRAM" ariaLabel="Minimum GPU VRAM" icon={<GraphicsCard size={15} />} unit="GB" value={filters.minVram} min={gpuMarketplaceMinimums.minVram} max={1024} change={minVram => update({ minVram })} help="24 GB-class GPU minimum. More VRAM adds capacity; it does not earn extra value points." />
      <GpuFilterField label="Min RAM" ariaLabel="Minimum system RAM" icon={<Memory size={15} />} unit="GB" value={filters.ram} min={gpuMarketplaceMinimums.ram} max={2048} change={ram => update({ ram })} help="CPU memory allocated to your instance. Studio requires at least 64 GB." />
      <GpuFilterField label="Storage" ariaLabel="Instance disk GB" icon={<HardDrives size={15} />} unit="GB" value={filters.disk} min={minimumDisk} max={2048} step={8} change={disk => update({ disk })} help={`${minimumDisk} GB minimum for the retained Studio models, runtime and working space. Storage is fixed when renting.`} />
      <GpuFilterField label="Min download" ariaLabel="Minimum download speed" icon={<DownloadSimple size={15} />} unit="Mbps" value={filters.minDownload} min={250} max={100000} step={250} change={minDownload => update({ minDownload })} help="Advertised host speed. 250 Mbps is about 31 MB/s before overhead; actual downloads can be slower." />
    </div>
    <details className="gpu-extra-filters"><summary><SlidersHorizontal size={15} />Filters{extraCount > 0 && <span className="gpu-filter-count">{extraCount}</span>}</summary><div className="gpu-extra-filter-content">
      <GpuFilterField label="Max download fee" ariaLabel="Maximum download price per GB" icon={<CurrencyDollar size={15} />} unit="/ GB" value={filters.maxDownloadPrice} min={0} max={DOWNLOAD_PRICE_CEILING} step={.001} integer={false} change={maxDownloadPrice => update({ maxDownloadPrice })} help="Charged for model transfers, separately from hourly rental. Zero means free ingress only." />
      <GpuFilterField label="Min reliability" ariaLabel="Minimum host reliability" icon={<ShieldCheck size={15} />} unit="%" value={Math.round(filters.minReliability * 100)} min={90} max={100} change={value => update({ minReliability: value / 100 })} help="Vast's host history. This is not a guarantee of availability." />
      <div className="gpu-verification-control"><Toggle label="Verified hosts only" checked={filters.verified} onChange={verified => update({ verified })} detail="Requires Vast host verification in addition to the performance and reliability filters." /></div>
      <Button variant="ghost" size="sm" onClick={() => onChange(marketplaceFilters({ disk: requirements?.recommendedDisk || 112 }))}><ArrowCounterClockwise size={14} />Reset filters</Button>
    </div></details>
  </section>;
}

export function GpuOfferCard({ offer, selected, select, recommended = false }: { offer: GpuOffer; selected: boolean; select: () => void; recommended?: boolean }) {
  return <article className={`gpu-offer-card${selected ? ' is-selected' : ''}${recommended ? ' is-recommended' : ''}`}>
    <header><div>{recommended && <span className="gpu-card-eyebrow"><Sparkle size={12} />{offer.recommendation?.rank === 1 ? 'Best value' : `Value pick ${offer.recommendation?.rank}`}</span>}<h3>{gpuDisplayName(offer.gpu)}{offer.verified && <ShieldCheck size={14} aria-label="Verified host" />}</h3><p>{offer.location || 'Location unavailable'} · {(offer.reliability * 100).toFixed(1)}%</p></div><GpuScoreDetails offer={offer} compact /></header>
    <GpuHardwareSummary hardware={offer} />
    <div className="gpu-card-transfer"><span>Download <strong>{transferRate(offer.downloadPerGB)}</strong></span></div>
    <footer><div className="gpu-card-rate"><strong>{gpuMoney(offer.totalHourly)}<small> / hr</small></strong><span>{offer.disk} GB disk included</span></div><Button variant={selected ? 'secondary' : 'ghost'} size="sm" data-review-gpu={offer.id} aria-pressed={selected} aria-label={`Review ${offer.gpu} machine ${offer.machineId}`} onClick={select}>{selected ? <Check size={14} /> : null}Review<ArrowRight size={14} /></Button></footer>
  </article>;
}

export default function GpuMarketplace({ filters, onChange, requirements, offers, selected, select, searching, searched, searchError, refresh, details }: {
  filters: OfferFilters; onChange: (value: OfferFilters) => void; requirements?: MarketRequirements; offers: GpuOffer[]; selected: string | null; select: (quote: string) => void;
  searching: boolean; searched: boolean; searchError: string; searchedAt?: string | null; refresh: () => void; details: ReactNode;
}) {
  const recommendations = filters.sort === 'recommended' ? offers.filter(offer => offer.recommendation?.rank).sort((a, b) => a.recommendation!.rank! - b.recommendation!.rank!) : [];
  const others = offers.filter(offer => !recommendations.includes(offer));
  const [visible, setVisible] = useState(24); useEffect(() => setVisible(24), [offers]);
  return <div className="gpu-marketplace-v3"><RentalConfiguration filters={filters} onChange={onChange} requirements={requirements} />
    <div className="gpu-market-columns"><section className="market-results" id="gpu-results" tabIndex={-1}>
      <div className="gpu-results-toolbar"><h2>{searching ? 'Finding GPUs…' : searched ? `${offers.length} GPUs` : 'GPUs'}</h2><div className="gpu-result-actions"><SmallSelect label="Sort GPU offers" value={filters.sort} onChange={value => onChange({ ...filters, sort: value as OfferFilters['sort'] })} options={[{ value: 'recommended', label: 'Best value' }, { value: 'price', label: 'Lowest price' }, { value: 'speed', label: 'Fastest compute' }, { value: 'setup', label: 'Lowest setup + work cost' }]} /><Button variant="ghost" size="icon" aria-label="Refresh GPU offers" title="Refresh offers" disabled={searching} onClick={refresh}><ArrowClockwise size={16} className={searching ? 'instance-spin' : ''} /></Button></div></div>
      {searching ? <div className="gpu-offer-skeletons" aria-label="Loading GPU offers">{[0, 1, 2, 3].map(item => <div key={item}><span /><i /><i /></div>)}</div>
        : searchError ? <div className="cloud-no-offers" role="alert"><Info size={25} /><h3>Couldn’t load GPUs</h3><p>{searchError}</p><Button onClick={refresh}>Try again</Button></div>
          : offers.length ? <>
            {recommendations.length > 0 && <section className="gpu-recommendations" aria-label="Top GPU recommendations"><h3 className="gpu-results-section-label">Recommended</h3><div className="gpu-recommendation-grid">{recommendations.map(offer => <GpuOfferCard key={offer.quote} offer={offer} recommended selected={selected === offer.quote} select={() => select(offer.quote)} />)}</div></section>}
            {others.length > 0 && <><h3 className="gpu-results-section-label">{recommendations.length ? 'More GPUs' : 'All GPUs'}</h3><div className="gpu-offer-grid">{others.slice(0, visible).map(offer => <GpuOfferCard key={offer.quote} offer={offer} selected={selected === offer.quote} select={() => select(offer.quote)} />)}</div>{visible < others.length && <Button className="gpu-more-results" onClick={() => setVisible(value => value + 24)}>Show {Math.min(24, others.length - visible)} more</Button>}</>}
          </> : <div className="cloud-no-offers"><Cpu size={28} /><h3>No matching GPUs</h3><p>Raise your price limit or lower a hardware minimum.</p></div>}
    </section>{details}</div>
  </div>;
}
