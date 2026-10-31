import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, CloudArrowUp, Cpu, HardDrives, Info, Lightning, Plug, ShieldCheck, Trash, WarningCircle, Star } from '@phosphor-icons/react';
import type { CloudInstance, CloudLaunch, CloudState, GpuOffer, OfferFilters,MarketRequirements } from '../shared/cloud';
import { DOWNLOAD_PRICE_CEILING, GPU_COMPUTE_CEILING, withinDownloadBudget, gpuDisplayName, isDgxSpark, isDgxGpu, isCmp170Hx } from '../shared/cloud';
import GpuMarketplace,{RentalConfiguration} from './GpuMarketplace';
import GpuHardwareDetails,{GpuScoreDetails} from './GpuHardwareDetails';
import {offerFiltersSchema,offerMatchesFilters} from '../shared/cloud';
import { api, Modal } from './components';
import './cloud.css';
import VastAccountSetup from './VastAccountSetup';
import InstancesView, { SetupTimeline, type InstanceAction } from './InstancesView';
import { toast } from 'sonner';
import GpuFavourites, { type ToggleGpuFavourite } from './GpuFavourites';

const money = (value: number | null, precision = 3) => value === null ? 'Unavailable' : '$' + value.toFixed(precision);
const transferMoney = (value: number | null) => value === null ? 'Unavailable' : '$' + value.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const working = ['checking', 'requesting', 'waiting', 'installing', 'connecting'];
function OfferDetails({ offer, busy, rent, saved, saving, onFavourite }: { offer: GpuOffer; busy: boolean; rent: () => void; saved: boolean; saving: boolean; onFavourite: () => void }) {
  const [checking, setChecking] = useState(false), [receipt, setReceipt] = useState<{ ready: boolean; checks: { name: string; ok: boolean; message: string }[] } | null>(null), [checkError, setCheckError] = useState('');
  const checkSerial = useRef(0);
  useEffect(() => { checkSerial.current++; setChecking(false); setReceipt(null); setCheckError(''); }, [offer.quote]);
  const preflight = async () => { const serial = ++checkSerial.current; setChecking(true); setCheckError(''); try { const result = await api<{ ready: boolean; checks: { name: string; ok: boolean; message: string }[] }>('/cloud/preflight', { quote: offer.quote }); if (serial === checkSerial.current) setReceipt(result); } catch (error) { if (serial === checkSerial.current) setCheckError((error as Error).message); } finally { if (serial === checkSerial.current) setChecking(false); } };
  return <aside className="offer-details" id="selected-gpu-offer"><a className="gpu-back-results" href="#gpu-results">Back to offers</a><div className="offer-detail-title"><button className={`icon-button favourite-control${saved ? ' saved' : ''}`} disabled={saving} aria-pressed={saved} aria-label={saved ? 'Remove this host from favourites' : 'Save this host to favourites'} onClick={onFavourite}><Star size={18} weight={saved ? 'fill' : 'regular'} /></button><Cpu size={28} weight="light" /><span>{isDgxGpu(offer.gpu) || isCmp170Hx(offer.gpu) ? 'EXPERIMENTAL PLATFORM' : offer.gpu.includes('3090') ? 'TESTED MODEL FAMILY' : 'COMPATIBLE HARDWARE'}</span><h2>{gpuDisplayName(offer.gpu)}</h2><p>{offer.location} <span>Host #{offer.machineId}</span></p></div>
    <div className="offer-spec-grid">{[...(isDgxSpark(offer.gpu) ? [['Shared memory', `${offer.vram.toFixed(0)} GB`], ['Architecture', 'ARM64']] : [['VRAM', `${offer.vram.toFixed(0)} GB`], ['System RAM', `${offer.ram.toFixed(0)} GB`]]), ['vCPUs', offer.cpus.toFixed(1)], ['Reliability', `${(offer.reliability * 100).toFixed(2)}%`]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <div className="compatibility"><ShieldCheck size={15} /><span>{isCmp170Hx(offer.gpu) ? 'Experimental GPU setup' : isDgxGpu(offer.gpu) ? 'Experimental datacenter setup' : 'Fits the pinned INT8 setup'}{offer.verified ? ' · Verified host' : ''}</span></div>
    <GpuScoreDetails offer={offer}/><GpuHardwareDetails hardware={offer}/>
    <div className="rental-price"><div><span>GPU compute</span><b>{money(offer.computeHourly)} / hr</b></div><div><span>Storage · {offer.disk} GB</span><b>{money(offer.storageHourly, 4)} / hr</b></div><div className="price-total"><span>Running total</span><strong>{money(offer.totalHourly)}<small> / hr</small></strong></div><p>Retaining this disk: {money(offer.storageMonthly, 2)} / month at the listed storage rate. Stopped billing may differ; the host sets the rate.</p></div>
    <div className="download-cost-summary"><div><span>Downloads · per GB</span><b>{transferMoney(offer.downloadPerGB)}</b></div><div><span>Selected model files · {(offer.modelDownloadGB ?? 29.74).toFixed(1)} GB</span><b>≈ {money(offer.modelDownloadCost, 2)}</b></div><small>Charged when downloaded. Runtime and package traffic is additional.</small></div>
    <div className="first-launch-cost"><CloudArrowUp size={16} /><div><strong>Blank engine first. Model weights stay on demand.</strong><p>Your selected recipe uses about {(offer.modelDownloadGB ?? 29.74).toFixed(1)} GB when requested. Estimated model transfer fee: {money(offer.modelDownloadCost, 2)}. At this host’s {Math.round(offer.downloadMbps)} Mbps rating, those weights alone need at least {Math.ceil((offer.modelDownloadGB ?? 29.74) * 8000 / Math.max(1, offer.downloadMbps) / 60)} minutes. Real transfers and installation can take longer.</p></div></div>
    {offer.gpu.includes('5090') && <p className="field-hint">32 GB gives more VRAM headroom. Generation speed still needs a benchmark on this workflow.</p>}
    <div className="setup-safety"><p><Info size={14} />Unresponsive hosts are cancelled and removed before installation. Slow image pulls and downloads keep running; installed files are preserved on setup failure.</p></div>
    <button className="secondary-button preflight-button" disabled={checking || busy} onClick={() => void preflight()}><CheckCircle size={14} />{checking ? 'Checking configuration...' : 'Check configuration · no rental'}</button>
    {(receipt || checkError) && <div className={`preflight-receipt ${receipt?.ready ? 'passed' : ''}`} role="status">{checkError || receipt?.checks.map(check => <div key={check.name}>{check.ok ? <CheckCircle size={13} /> : <WarningCircle size={13} />}<span>{check.name}{!check.ok && <small>{check.message}</small>}</span></div>)}</div>}
    <button className="primary-button rent-button" disabled={busy || checking || !offer.compatible || !withinDownloadBudget(offer.downloadPerGB)} onClick={rent}><Lightning size={16} weight="fill" />Rent & launch <span>{money(offer.totalHourly)} / hr</span></button><small className="rental-footnote">Starts a paid rental. Prices are rechecked. Empty hosts with five minutes of confirmed silence are removed automatically and hidden for 24 hours. Keep Recast open for monitoring. Storage remains billed until deletion is confirmed.</small>
  </aside>;
}
export default function GpuWorkspace({ cloud, setCloud, notify, onCreate }: { cloud: CloudState; setCloud: (value: CloudState) => void; notify: (message: string) => void; onCreate: () => void }) {
  const [tab, setTab] = useState<'market' | 'favourites' | 'instances'>('market'), [filters, setFilters] = useState<OfferFilters>(()=>{try{return offerFiltersSchema.parse({...JSON.parse(localStorage.getItem('recast-gpu-search-v2')||'{}'),gpu:'all'});}catch{return offerFiltersSchema.parse({});}});
  const [requirements,setRequirements]=useState<MarketRequirements>();
  useEffect(()=>{localStorage.setItem('recast-gpu-search-v2',JSON.stringify(filters));},[filters]);
  const [offers, setOffers] = useState<GpuOffer[]>([]), [selected, setSelected] = useState<string | null>(null), [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [searchError, setSearchError] = useState('');
  const [destroy, setDestroy] = useState<CloudInstance | null>(null), [confirmation, setConfirmation] = useState(''), [actionBusy, setActionBusy] = useState(false), [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [favouriteBusy, setFavouriteBusy] = useState(false);
  const [pending, setPending] = useState<InstanceAction>(null), [refreshing, setRefreshing] = useState(false);
  const rentalKey = useRef<{ quote: string; key: string } | null>(null), searchSerial = useRef(0), cloudRef = useRef(cloud); cloudRef.current = cloud;
  const refresh = useCallback(async () => { try { const value = await api<CloudState>('/cloud/refresh', {}); setCloud(value); } catch (e) { notify((e as Error).message); } }, [setCloud, notify]);
  useEffect(() => { if (cloud.configured) void refresh(); }, [cloud.configured, refresh]);
  const search = useCallback(async (value: OfferFilters) => {
    const serial = ++searchSerial.current; setSearching(true); setSearchError(''); setOffers([]); setSelected(null);
    try { const result = await api<{ offers: GpuOffer[]; searchedAt: string;filters:OfferFilters;requirements:MarketRequirements }>('/cloud/offers', value); if (serial === searchSerial.current) { const matching = result.offers.filter(offer => offer.downloadMbps >= value.minDownload && withinDownloadBudget(offer.downloadPerGB)); setOffers(matching);setRequirements(result.requirements);if(result.filters&&JSON.stringify(result.filters)!==JSON.stringify(value))setFilters(result.filters); setSelected(matching.find(offer=>offer.recommendation?.rank===1)?.quote||matching[0]?.quote || null); setSearchedAt(result.searchedAt); setSearched(true); } }
    catch (e) { if (serial === searchSerial.current) setSearchError((e as Error).message); } finally { if (serial === searchSerial.current) setSearching(false); }
  }, []);
  useEffect(() => {
    searchSerial.current++;setSelected(null); if (tab !== 'market') { setSearching(false); return; } setOffers([]);
    if (!cloud.configured) { setSearching(false); return; }
    if (!offerFiltersSchema.safeParse(filters).success) { setSearching(false); setSearchError('Choose a valid hourly cap, at least 24 GB VRAM, 48 GB RAM, 64 GB disk and 250 Mbps downloads.'); return; }
    setSearching(true); setSearchError(''); const timer = setTimeout(() => void search(filters), 450); return () => clearTimeout(timer);
  }, [cloud.configured, filters, search, tab]);
  const rent = async (offer: GpuOffer) => {
    if(Date.parse(offer.expiresAt)<=Date.now()){if(tab==='market')void search(filters);else notify('Refresh favourite availability to get a fresh quote.');return;}
    if(!offerMatchesFilters(offer,filters)){notify('This offer does not match your current filters. Refresh availability before renting.');return;}
    if (actionBusy || cloud.busy) return; setActionBusy(true);
    if (rentalKey.current?.quote !== offer.quote) rentalKey.current = { quote: offer.quote, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/cloud/launch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': rentalKey.current!.key }, body: JSON.stringify({ quote: offer.quote, approvedHourly: Math.min(offer.totalHourly!,filters.maxHourly) }) });
      const value = await response.json(); if (!response.ok) { rentalKey.current = null; throw new Error(value.error); } setTab('instances'); await refresh();
    } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); }
  };
  const instanceAction = async (id: number, action: string) => {
    if (actionBusy) return;
    setActionBusy(true); setPending({ id, action });
    try {
      await api(`/cloud/instances/${id}/${action}`, { ...(action === 'destroy' ? { confirmation } : {}) });
      if (action === 'destroy') { setDestroy(null); setConfirmation(''); }
      await refresh();
      toast.success(action === 'stop' ? 'Compute paused' : action === 'destroy' ? 'Instance destroyed' : 'Connection setup started', { description: action === 'stop' ? 'Your disk is kept and storage remains billed.' : action === 'destroy' ? 'Your local library is kept.' : 'Follow progress on this instance.' });
    } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); setPending(null); }
  };
  const refreshStatus = async () => { if (refreshing) return; setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };
  const retry = async (launch: CloudLaunch) => { setActionBusy(true); try { await api(`/cloud/launches/${launch.id}/continue`, {}); await refresh(); } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); } };
  const toggleFavourite: ToggleGpuFavourite = async (machineId, gpu, source) => {
    if (favouriteBusy) return; setFavouriteBusy(true);
    const saved = cloudRef.current.favourites?.find(item => item.machineId === machineId && item.gpu === gpu);
    try {
      const value = saved ? await api<CloudState>(`/cloud/favourites/${saved.id}`, undefined, 'DELETE') : await api<CloudState>('/cloud/favourites', source);
      setCloud(value); toast.success(saved ? 'Host removed from favourites' : 'Host saved to favourites');
    } catch (error) { notify((error as Error).message); } finally { setFavouriteBusy(false); }
  };
  const chosen = (tab === 'favourites' ? (cloud.favourites || []).flatMap(item => item.status === 'available' && item.offer ? [item.offer] : []) : offers).find(o => o.quote === selected), latest = cloud.launches.find(l => l.phase !== 'destroyed' || l.autoCleanup), managed = cloud.instances.filter(i => i.managed);
  const details = chosen ? <OfferDetails offer={chosen} busy={cloud.busy || actionBusy} rent={() => void rent(chosen)} saved={!!cloud.favourites?.some(item => item.machineId === chosen.machineId && item.gpu === chosen.gpu)} saving={favouriteBusy} onFavourite={() => void toggleFavourite(chosen.machineId, chosen.gpu, { quote: chosen.quote })} /> : <aside className="offer-detail-empty"><Cpu size={34} weight="light" /><p>Select an offer to review its hardware and full cost.</p></aside>;
  return <main className="gpu-workspace"><div className="cloud-heading"><div><span className="workspace-overline">YOUR COMPUTE, IN ONE PLACE</span><h1>GPU cloud</h1><p>Up to ${GPU_COMPUTE_CEILING.toFixed(2)}/hr GPU compute · Downloads ≤ ${DOWNLOAD_PRICE_CEILING.toFixed(3)}/GB. Storage and uploads are separate.</p></div><div className="cloud-account"><span className={`status-dot ${cloud.configured ? 'account-connected' : ''}`} /><span>{cloud.configured ? 'Vast account connected' : 'Connect your Vast account'}</span><VastAccountSetup cloud={cloud} setCloud={setCloud} label="Account" onSaved={() => { void refresh(); if (tab === 'market') void search(filters); }} /></div></div>
    <div className="cloud-tabs"><button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>Marketplace</button><button className={tab === 'favourites' ? 'active' : ''} onClick={() => { setSelected(null); setTab('favourites'); }}>Favourites <span>{cloud.favourites?.length || 0}</span></button><button className={tab === 'instances' ? 'active' : ''} onClick={() => setTab('instances')}>My instances <span>{managed.length}</span></button>{tab === 'market' && cloud.refreshedAt && <small>Account refreshed {new Date(cloud.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}</div>
    {!cloud.configured ? <section className="cloud-onboarding"><div className="cloud-onboarding-icon"><Cpu size={38} weight="light" /></div><h2>Connect your Vast account</h2><p>Add your API key and choose an SSH key for this computer. Recast handles the connection when you launch a GPU.</p><VastAccountSetup cloud={cloud} setCloud={setCloud} label="Set up Vast account" primary onSaved={() => { void refresh(); void search(filters); }} /><div className="onboarding-facts"><span><ShieldCheck size={16} />Compatible hosts only</span><span><HardDrives size={16} />Choose disk before launch</span><span><Plug size={16} />Automatic setup & connection</span></div></section> : <>
      {cloud.error && <div className="cloud-error" role="alert"><WarningCircle size={16} /><span>{cloud.error}</span><button onClick={() => void refresh()}>Retry</button></div>}
      {latest && (tab === 'market' || !managed.some(instance => instance.id === latest.instanceId)) && (working.includes(latest.phase) || ['stopping', 'destroying', 'unknown', 'failed'].includes(latest.phase) || tab === 'instances' || latest.autoCleanup) && <SetupTimeline launch={latest} busy={cloud.busy || actionBusy} retry={() => void retry(latest)} manage={() => setTab('instances')} browse={() => { setTab('market'); void search(filters); }} cancel={() => { if (latest) void api(`/cloud/launches/${latest.id}/cancel`, {}).then(() => refresh()).catch(e => notify(e.message)); }} />}
      {tab === 'market' ? <GpuMarketplace filters={filters} onChange={setFilters} requirements={requirements?.workflow===filters.workflow?requirements:undefined} offers={offers} selected={selected} select={quote=>{setSelected(quote);if(window.innerWidth<=1100)requestAnimationFrame(()=>document.getElementById('selected-gpu-offer')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));}} searching={searching} searched={searched} searchError={searchError} searchedAt={searchedAt} refresh={()=>void search(filters)} details={details}/> : tab === 'favourites' ? <><RentalConfiguration filters={filters} onChange={setFilters} requirements={requirements?.workflow===filters.workflow?requirements:undefined}/><div className="market-layout"><GpuFavourites cloud={cloud} filters={filters} setCloud={setCloud} notify={notify} select={offer=>setSelected(offer.quote)} selectedQuote={selected} toggle={toggleFavourite} saving={favouriteBusy}/>{details}</div></> : <InstancesView onFavourite={launch => void toggleFavourite(launch.offer.machineId, launch.offer.gpu, { launchId: launch.id })} cloud={cloud} busy={cloud.busy || actionBusy} pending={pending} refreshing={refreshing} refresh={() => void refreshStatus()} action={(id, action) => void instanceAction(id, action)} retry={launch => void retry(launch)} confirmDestroy={instance => { setDestroy(instance); setConfirmation(''); }} browse={() => setTab('market')} onCreate={onCreate} />}
    </>}
    <Modal open={!!destroy} onOpenChange={value => { if (!value) setDestroy(null); }} title="Destroy this instance?" description="The remote container, models and its disk will be permanently deleted. Your local library is kept."><div className="destroy-summary"><HardDrives size={22} /><div><strong>{destroy?.gpu} · #{destroy?.id}</strong><p>{destroy?.disk} GB remote disk will be deleted.</p></div></div><label className="full-label">Enter instance ID {destroy?.id} to confirm<input inputMode="numeric" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></label><div className="modal-actions"><button className="danger-button" disabled={actionBusy || confirmation !== String(destroy?.id)} onClick={() => { if (destroy) void instanceAction(destroy.id, 'destroy'); }}><Trash size={15} />{actionBusy ? 'Destroying...' : 'Destroy instance'}</button><button className="secondary-button" onClick={() => setDestroy(null)}>Keep instance</button></div></Modal>
  </main>;
}
