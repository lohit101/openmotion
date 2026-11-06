import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, Check, Crop } from '@phosphor-icons/react';
import type { Asset } from '../shared/types';
import { referenceViewIssue, type ImageReferenceView } from '../shared/image-replacement';
import { Modal } from './components';
import './reference-views.css';

export function ReferenceViewImage({ asset, view, alt, thumbnail = false }: { asset: Asset; view: ImageReferenceView | null | undefined; alt: string; thumbnail?: boolean }) {
  const crop = view && !referenceViewIssue(view, asset) ? view : { x: 0, y: 0, width: asset.width, height: asset.height };
  return <span className="reference-view-image" style={{ aspectRatio: `${crop.width}/${crop.height}`, ...(thumbnail ? { width: Math.min(56, 52 * crop.width / crop.height), height: Math.min(52, 56 * crop.height / crop.width) } : {}) }}>
    <img src={`/api/assets/${asset.id}/original`} alt={alt} draggable={false} style={{ width: `${asset.width / crop.width * 100}%`, height: `${asset.height / crop.height * 100}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` }} />
  </span>;
}

export function ReferenceViewControl({ asset, view, kind, change }: { asset?: Asset; view: ImageReferenceView | null | undefined; kind: 'body' | 'face'; change: (view: ImageReferenceView | null) => void }) {
  const [open, setOpen] = useState(false);
  if (!asset) return null;
  const valid = view && !referenceViewIssue(view, asset);
  return <><button className="reference-view-control" type="button" onClick={() => setOpen(true)} aria-label={`Choose ${kind} reference view`}>
    {valid ? <ReferenceViewImage asset={asset} view={view} alt={`Selected ${kind} view`} thumbnail /> : <Crop size={17} />}
    <span><strong>{valid ? `${kind === 'body' ? 'Body' : 'Face'} view selected` : `Choose ${kind} view`}</strong><small>{valid ? 'Change selection' : 'Using a sheet? Select one clear view.'}</small></span>
  </button>{open && <ReferenceViewPicker asset={asset} initial={valid ? view : null} kind={kind} close={() => setOpen(false)} save={value => { change(value); setOpen(false); }} />}</>;
}

export function ReferenceViewPicker({ asset, initial, kind, close, save, minimum = 32, title, description }: { asset: Asset; initial: ImageReferenceView | null; kind: 'body' | 'face'; close: () => void; save: (view: ImageReferenceView | null) => void; minimum?: number; title?: string; description?: string }) {
  const whole = (): ImageReferenceView => ({ assetId: asset.id, x: 0, y: 0, width: asset.width, height: asset.height });
  const selection = useRef<ImageReferenceView>(initial || whole()), picked = useRef(!!initial), stage = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null), size = useRef<HTMLSpanElement>(null), coordinates = useRef<HTMLDetailsElement>(null);
  const drag = useRef<{ start: [number, number]; mode: 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; old: ImageReferenceView } | null>(null);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [valid, setValid] = useState(true);
  const paint = () => {
    const v = selection.current;
    if (box.current) Object.assign(box.current.style, { left: `${v.x / asset.width * 100}%`, top: `${v.y / asset.height * 100}%`, width: `${v.width / asset.width * 100}%`, height: `${v.height / asset.height * 100}%` });
    if (size.current) size.current.textContent = `${v.width} × ${v.height} px`;
    coordinates.current?.querySelectorAll<HTMLInputElement>('input[data-field]').forEach(input => { if (input !== document.activeElement) input.value = String(v[input.dataset.field as 'x' | 'y' | 'width' | 'height']); });
  };
  useEffect(() => { const frame = requestAnimationFrame(paint); return () => cancelAnimationFrame(frame); }, [asset.id]);
  const point = (event: React.PointerEvent): [number, number] => {
    const bounds = stage.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(asset.width, Math.round((event.clientX - bounds.left) / bounds.width * asset.width))), Math.max(0, Math.min(asset.height, Math.round((event.clientY - bounds.top) / bounds.height * asset.height)))];
  };
  const begin = (event: React.PointerEvent, mode: NonNullable<typeof drag.current>['mode']) => {
    if (!loaded || failed) return;
    if (mode === 'move' && !picked.current) mode = 'draw';
    event.preventDefault(); event.stopPropagation(); stage.current!.setPointerCapture(event.pointerId);
    drag.current = { start: point(event), mode, old: { ...selection.current } };
  };
  const move = (event: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const [x, y] = point(event), [sx, sy] = d.start, o = d.old;
    let left = o.x, top = o.y, right = o.x + o.width, bottom = o.y + o.height;
    if (d.mode === 'move') {
      left = Math.max(0, Math.min(asset.width - o.width, o.x + x - sx)); top = Math.max(0, Math.min(asset.height - o.height, o.y + y - sy));
      right = left + o.width; bottom = top + o.height;
    } else if (d.mode === 'draw') { left = Math.min(sx, x); right = Math.max(sx, x); top = Math.min(sy, y); bottom = Math.max(sy, y); }
    else {
      if (d.mode.includes('w')) left = Math.min(x, right - 1); else right = Math.max(x, left + 1);
      if (d.mode.includes('n')) top = Math.min(y, bottom - 1); else bottom = Math.max(y, top + 1);
    }
    selection.current = { assetId: asset.id, x: left, y: top, width: right - left, height: bottom - top }; paint();
  };
  const finish = () => { if (!drag.current) return; drag.current = null; picked.current = true; setValid(selection.current.width >= minimum && selection.current.height >= minimum); };
  const numeric = (field: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return;
    const v = { ...selection.current, [field]: Math.round(value) };
    v.x = Math.max(0, Math.min(asset.width - minimum, v.x)); v.y = Math.max(0, Math.min(asset.height - minimum, v.y));
    v.width = Math.max(minimum, Math.min(asset.width - v.x, v.width)); v.height = Math.max(minimum, Math.min(asset.height - v.y, v.height));
    selection.current = v; picked.current = true; paint(); setValid(true);
  };
  const [editing, setEditing] = useState(false);
  return <Modal open onOpenChange={value => { if (!value) close(); }} title={title || `Choose one ${kind} view`} description={description || (kind === 'body' ? 'Draw around one full-body view, including the head and feet. The source photo still supplies clothing and pose.' : 'Draw around one clear head and hairstyle. Choose a viewing angle close to the target, with space around the hair.')} wide>
    <div className="reference-view-stage" ref={stage} style={{ aspectRatio: `${asset.width}/${asset.height}`, maxWidth: `min(100%, ${54 * asset.width / asset.height}dvh)` } as CSSProperties} onPointerDown={event => begin(event, 'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <img src={`/api/assets/${asset.id}/original`} alt={`Original ${kind} reference sheet`} draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      {failed ? <p>Reference preview could not load. Close and try again.</p> : <div ref={box} className="reference-view-box" onPointerDown={event => begin(event, 'move')}>
        {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <span key={corner} className={`reference-view-handle ${corner}`} onPointerDown={event => begin(event, corner)} />)}
      </div>}
    </div>
    <div className="reference-view-footer"><span ref={size} /><button className="secondary-button" onClick={() => { selection.current = whole(); picked.current = false; paint(); setValid(true); }}><ArrowCounterClockwise size={14} />Reset</button><button className="primary-button compact" disabled={!loaded || failed || !valid} onClick={() => save(selection.current)}><Check size={15} />Use this view</button></div>
    {!valid && <p role="alert" className="reference-view-error">Select an area of at least {minimum} × {minimum} pixels.</p>}
    <details ref={coordinates} className="reference-view-coordinates" onToggle={event => setEditing(event.currentTarget.open)}><summary>Exact selection</summary>{editing && <div>{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{field}<input type="number" data-field={field} min={field === 'x' || field === 'y' ? 0 : minimum} max={field === 'x' || field === 'width' ? asset.width : asset.height} defaultValue={selection.current[field]} onChange={event => numeric(field, event.currentTarget.valueAsNumber)} /></label>)}</div>}</details>
    <button className="reference-use-whole" type="button" disabled={!loaded || failed} onClick={() => save(null)}>Use the entire reference image</button>
  </Modal>;
}
