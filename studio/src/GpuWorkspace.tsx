import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Cpu, HardDrives, GearSix, Trash, WarningCircle } from '@phosphor-icons/react';
import type { CloudInstance, CloudLaunch, CloudState, GpuOffer, OfferFilters, MarketRequirements } from '../shared/cloud';
import { marketplaceFilters, offerFiltersSchema, offerMatchesFilters, withinDownloadBudget } from '../shared/cloud';
import GpuMarketplace from './GpuMarketplace';
import GpuOfferDetails from './GpuOfferDetails';
import { api, Modal } from './components';
import InstancesView, { SetupTimeline, type InstanceAction } from './InstancesView';
import { Button } from './ui/Button';
import { toast } from 'sonner';
import './cloud.css';
import './gpu-workspace.css';

const working = ['checking', 'requesting', 'waiting', 'installing', 'connecting'];
function useNarrowGpuLayout() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches);
  useEffect(() => { const query = window.matchMedia('(max-width: 1100px)'), update = () => setNarrow(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return narrow;
}

export default function GpuWorkspace({ cloud, setCloud, notify, onCreate, openSettings }: { cloud: CloudState; setCloud: (value: CloudState) => void; notify: (message: string) => void; onCreate: () => void; openSettings: () => void }) {
  const [tab, setTab] = useState<'market' | 'instances'>('market');
  const [filters, setFilters] = useState<OfferFilters>(() => { try { return marketplaceFilters({ disk: 112, ...JSON.parse(localStorage.getItem('recast-gpu-search-v2') || '{}') }); } catch { return marketplaceFilters({ disk: 112 }); } });
  const [requirements, setRequirements] = useState<MarketRequirements>();
  const [offers, setOffers] = useState<GpuOffer[]>([]), [selected, setSelected] = useState<string | null>(null), [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [searchError, setSearchError] = useState('');
  const [destroy, setDestroy] = useState<CloudInstance | null>(null), [confirmation, setConfirmation] = useState(''), [actionBusy, setActionBusy] = useState(false);
  const [pending, setPending] = useState<InstanceAction>(null), [refreshing, setRefreshing] = useState(false), [reviewOpen, setReviewOpen] = useState(false);
  const rentalKey = useRef<{ quote: string; key: string } | null>(null), searchSerial = useRef(0);
  const narrow = useNarrowGpuLayout();
  useEffect(() => { localStorage.setItem('recast-gpu-search-v2', JSON.stringify(filters)); }, [filters]);
  const refresh = useCallback(async () => { try { setCloud(await api<CloudState>('/cloud/refresh', {})); } catch (e) { notify((e as Error).message); } }, [setCloud, notify]);
  useEffect(() => { if (cloud.configured) void refresh(); }, [cloud.configured, refresh]);
  const search = useCallback(async (value: OfferFilters) => {
    const serial = ++searchSerial.current; setSearching(true); setSearchError(''); setOffers([]); setSelected(null); setReviewOpen(false);
    try {
      const result = await api<{ offers: GpuOffer[]; filters: OfferFilters; requirements: MarketRequirements }>('/cloud/offers', value);
      if (serial === searchSerial.current) {
        const matching = result.offers.filter(offer => offerMatchesFilters(offer, result.filters || value) && withinDownloadBudget(offer.downloadPerGB));
        setOffers(matching); setRequirements(result.requirements);
        if (result.filters && JSON.stringify(result.filters) !== JSON.stringify(value)) setFilters(result.filters);
        const best = (result.filters?.sort || value.sort) === 'recommended' ? matching.find(offer => offer.recommendation?.rank === 1) : matching[0];
        setSelected(best?.quote || matching[0]?.quote || null); setSearched(true);
      }
    } catch (e) { if (serial === searchSerial.current) setSearchError((e as Error).message); }
    finally { if (serial === searchSerial.current) setSearching(false); }
  }, []);
  useEffect(() => {
    searchSerial.current++; setSelected(null); setReviewOpen(false);
    if (tab !== 'market' || !cloud.configured) { setSearching(false); return; }
    setOffers([]);
    if (!offerFiltersSchema.safeParse(filters).success) { setSearching(false); setSearchError('Check your price and hardware limits.'); return; }
    setSearching(true); setSearchError(''); const timer = setTimeout(() => void search(filters), 450); return () => clearTimeout(timer);
  }, [cloud.configured, filters, search, tab]);
  useEffect(() => () => { searchSerial.current++; }, []);
  const rent = async (offer: GpuOffer) => {
    if (Date.parse(offer.expiresAt) <= Date.now()) { notify('This quote expired. Refreshing GPU offers.'); void search(filters); return; }
    if (!offerMatchesFilters(offer, filters)) { notify('This GPU no longer matches your filters. Refresh before renting.'); return; }
    if (actionBusy || cloud.busy) return; setActionBusy(true);
    if (rentalKey.current?.quote !== offer.quote) rentalKey.current = { quote: offer.quote, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/cloud/launch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': rentalKey.current.key }, body: JSON.stringify({ quote: offer.quote, approvedHourly: Math.min(offer.totalHourly!, filters.maxHourly) }) });
      const value = await response.json(); if (!response.ok) { rentalKey.current = null; throw new Error(value.error); }
      setReviewOpen(false); setTab('instances'); await refresh();
    } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); }
  };
  const instanceAction = async (id: number, action: string) => {
    if (actionBusy) return; setActionBusy(true); setPending({ id, action });
    try {
      await api(`/cloud/instances/${id}/${action}`, { ...(action === 'destroy' ? { confirmation } : {}) });
      if (action === 'destroy') { setDestroy(null); setConfirmation(''); }
      await refresh();
      toast.success(action === 'stop' ? 'Compute paused' : action === 'destroy' ? 'Instance destroyed' : 'Connection setup started', { description: action === 'stop' ? 'Your disk is kept and storage remains billed.' : action === 'destroy' ? 'Your local library is kept.' : 'Follow progress on this instance.' });
    } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); setPending(null); }
  };
  const refreshStatus = async () => { if (refreshing) return; setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };
  const retry = async (launch: CloudLaunch) => { setActionBusy(true); try { await api(`/cloud/launches/${launch.id}/continue`, {}); await refresh(); } catch (e) { notify((e as Error).message); } finally { setActionBusy(false); } };
  const chosen = offers.find(offer => offer.quote === selected), latest = cloud.launches.find(launch => launch.phase !== 'destroyed' || launch.autoCleanup), managed = cloud.instances.filter(instance => instance.managed);
  const review = chosen ? <GpuOfferDetails offer={chosen} busy={cloud.busy || actionBusy} rent={() => void rent(chosen)} /> : <aside className="gpu-review-empty"><Cpu size={25}/><p>Select a GPU to review</p><ArrowRight size={16}/></aside>;
  return <main className="gpu-workspace gpu-cloud-v3"><header className="gpu-cloud-heading"><h1>GPU cloud</h1><nav className="gpu-cloud-tabs" aria-label="GPU cloud sections"><button aria-current={tab === 'market' ? 'page' : undefined} onClick={() => setTab('market')}>Marketplace</button><button aria-current={tab === 'instances' ? 'page' : undefined} onClick={() => setTab('instances')}>My GPUs<span>{managed.length}</span></button></nav></header>
    {!cloud.configured ? <section className="gpu-connect-empty"><Cpu size={30}/><h2>Connect Vast to find a GPU</h2><Button variant="primary" onClick={openSettings}><GearSix size={16}/>Open Settings<ArrowRight size={15}/></Button></section> : <>
      {cloud.error && <div className="cloud-error" role="alert"><WarningCircle size={16}/><span>{cloud.error}</span><button onClick={() => void refresh()}>Retry</button></div>}
      {latest && (tab === 'market' || !managed.some(instance => instance.id === latest.instanceId)) && (working.includes(latest.phase) || ['stopping', 'destroying', 'unknown', 'failed'].includes(latest.phase) || tab === 'instances' || latest.autoCleanup) && <SetupTimeline launch={latest} busy={cloud.busy || actionBusy} retry={() => void retry(latest)} manage={() => setTab('instances')} browse={() => { setTab('market'); void search(filters); }} cancel={() => void api(`/cloud/launches/${latest.id}/cancel`, {}).then(() => refresh()).catch(e => notify(e.message))} />}
      {tab === 'market' ? <GpuMarketplace filters={filters} onChange={setFilters} requirements={requirements} offers={offers} selected={selected} select={quote => { setSelected(quote); if (narrow) setReviewOpen(true); }} searching={searching} searched={searched} searchError={searchError} refresh={() => void search(filters)} details={narrow ? null : review} /> : <InstancesView cloud={cloud} busy={cloud.busy || actionBusy} pending={pending} refreshing={refreshing} refresh={() => void refreshStatus()} action={(id, action) => void instanceAction(id, action)} retry={launch => void retry(launch)} confirmDestroy={instance => { setDestroy(instance); setConfirmation(''); }} browse={() => setTab('market')} onCreate={onCreate} />}
    </>}
    <Dialog.Root open={narrow && reviewOpen && !!chosen && tab === 'market'} onOpenChange={setReviewOpen}><Dialog.Portal><Dialog.Overlay className="sheet-overlay gpu-review-overlay"/><Dialog.Content className="gpu-review-sheet" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); const trigger = chosen && document.querySelector<HTMLButtonElement>(`[data-review-gpu="${chosen.id}"]`); (trigger || document.getElementById('gpu-results'))?.focus(); }}><Dialog.Title className="sr-only">Review GPU rental</Dialog.Title>{chosen && <GpuOfferDetails offer={chosen} busy={cloud.busy || actionBusy} rent={() => void rent(chosen)} close={() => setReviewOpen(false)} />}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Modal open={!!destroy} onOpenChange={value => { if (!value) setDestroy(null); }} title="Destroy this instance?" description="The remote container, models and its disk will be permanently deleted. Your local library is kept."><div className="destroy-summary"><HardDrives size={22}/><div><strong>{destroy?.gpu} · #{destroy?.id}</strong><p>{destroy?.disk} GB remote disk will be deleted.</p></div></div><label className="full-label">Enter instance ID {destroy?.id} to confirm<input inputMode="numeric" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off"/></label><div className="modal-actions"><Button variant="destructive" disabled={actionBusy || confirmation !== String(destroy?.id)} onClick={() => { if (destroy) void instanceAction(destroy.id, 'destroy'); }}><Trash size={15}/>{actionBusy ? 'Destroying…' : 'Destroy instance'}</Button><Button onClick={() => setDestroy(null)}>Keep instance</Button></div></Modal>
  </main>;
}
