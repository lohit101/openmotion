import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, CaretDown, ClockCounterClockwise, ShieldCheck, Star } from '@phosphor-icons/react';
import type { CloudState, GpuOffer, OfferFilters } from '../shared/cloud';
import { gpuDisplayName,offerFiltersSchema,offerMatchesFilters } from '../shared/cloud';
import { api } from './components';
import {GpuHardwareSummary} from './GpuHardwareDetails';

export type ToggleGpuFavourite = (machineId: number, gpu: string, source: { launchId?: string; quote?: string }) => Promise<void>;
const rate = (value: number | null) => value === null ? 'No previous quote' : `$${value.toFixed(3)} / hr`;
const labels = { unchecked: 'Not checked', checking: 'Checking', available: 'Available now', unavailable: 'Unavailable with these settings', error: 'Could not check', cooldown: 'Startup failed recently' };

export default function GpuFavourites({ cloud, filters, setCloud, notify, select, selectedQuote, toggle, saving }: {
  cloud: CloudState; filters: OfferFilters; setCloud: (cloud: CloudState) => void; notify: (message: string) => void;
  select: (offer: GpuOffer) => void; selectedQuote: string | null; toggle: ToggleGpuFavourite; saving: boolean;
}) {
  const favourites = cloud.favourites || [];
  const ids = favourites.map(item => item.id).join(','), filterKey = JSON.stringify({ ...filters, gpu: 'all' });
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true), serial = useRef(0);
  const callbacks = useRef({ setCloud, notify }); callbacks.current = { setCloud, notify };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  const check = useCallback(async () => {
    if(!offerFiltersSchema.safeParse(JSON.parse(filterKey)).success)return;
    const request = ++serial.current; setChecking(true);
    try {
      const value = await api<CloudState>('/cloud/favourites/check', { filters: JSON.parse(filterKey) });
      if (mounted.current && serial.current === request) callbacks.current.setCloud(value);
    } catch (error) { if (mounted.current && serial.current === request) callbacks.current.notify((error as Error).message); }
    finally { if (mounted.current && serial.current === request) setChecking(false); }
  }, [filterKey]);
  useEffect(() => {
    if (!ids) return;
    const timer = setTimeout(() => void check(), 450);
    return () => { clearTimeout(timer); serial.current++; };
  }, [ids, check]);
  const seen = new Set<string>();
  const history = cloud.launches.filter(launch => {
    const key = `${launch.offer.machineId}:${launch.offer.gpu}`;
    if (!launch.instanceId || !launch.offer.machineId || launch.autoCleanup || seen.has(key) || favourites.some(item => item.machineId === launch.offer.machineId && item.gpu === launch.offer.gpu)) return false;
    seen.add(key); return true;
  });
  return <section className="gpu-favourites" aria-label="Favourite GPU hosts">
    <div className="favourites-heading"><div><h2>Your trusted hosts <span>{favourites.length}</span></h2><p>Save a machine that worked well. Check its current price and availability.</p></div><button className="secondary-button" disabled={checking || !favourites.length} onClick={() => void check()}><ArrowClockwise size={14} className={checking ? 'instance-spin' : ''} />{checking ? 'Checking…' : 'Check availability'}</button></div>
    {!favourites.length && <div className="favourites-empty"><Star size={29} weight="light" /><h3>Keep the good ones close.</h3><p>Star a host below, on an instance, or in an offer’s details. Saved hosts stay here after a rental is destroyed.</p></div>}
    <div className="favourite-list">{favourites.map(item => <article key={item.id} className={`favourite-host${item.offer?.quote === selectedQuote ? ' selected' : ''}`}>
      <div className="favourite-host-heading"><div><h3>{gpuDisplayName(item.gpu)}{item.offer?.verified && <ShieldCheck size={13} />}</h3><p>Machine #{item.machineId}<span>·</span>{item.location || 'Location unavailable'}</p></div><button className="icon-button favourite-control saved" disabled={saving} aria-label={`Remove ${item.gpu} machine ${item.machineId} from favourites`} aria-pressed="true" onClick={() => void toggle(item.machineId, item.gpu, {})}><Star size={17} weight="fill" /></button></div>
      <div className="favourite-host-summary"><span className={`favourite-availability ${item.status}`} role="status"><i />{labels[item.status]}</span><strong>{item.status === 'available' && item.offer ? rate(item.offer.totalHourly) : <small>Last quote · {rate(item.lastHourly)}</small>}</strong></div>
      {item.message && <p className="favourite-host-message">{item.message}</p>}
      {item.status==='available'&&item.offer&&<GpuHardwareSummary hardware={item.offer}/>}
      <footer><small>{item.checkedAt ? `Checked ${new Date(item.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Check for a fresh offer before renting'}</small>{item.status === 'available' && item.offer && <button className="secondary-button" disabled={checking||!offerMatchesFilters(item.offer,filters)} onClick={() => select(item.offer!)}>Review offer <ArrowRight size={13} /></button>}</footer>
    </article>)}</div>
    {!!history.length && <details className="favourite-history" open={!favourites.length}><summary><ClockCounterClockwise size={15} />Previously rented hosts<span>{history.length}</span><CaretDown className="history-chevron" size={13} /></summary><p>Save the machines you liked. Rental history alone does not establish performance.</p>{history.map(launch => <div className="favourite-history-row" key={launch.id}><div><strong>{gpuDisplayName(launch.offer.gpu)}</strong><small>Machine #{launch.offer.machineId} · {launch.offer.location}</small></div><button className="secondary-button" disabled={saving} aria-label={`Favourite ${launch.offer.gpu} machine ${launch.offer.machineId}`} onClick={() => void toggle(launch.offer.machineId, launch.offer.gpu, { launchId: launch.id })}><Star size={14} />Save host</button></div>)}</details>}
    <p className="favourites-footnote">Saved by machine and GPU model. Prices and availability can change; the physical card within a multi-GPU host may vary. Checks use the settings above and never start a rental.</p>
  </section>;
}
