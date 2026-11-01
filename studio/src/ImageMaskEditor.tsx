import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, Check, Eraser, PaintBrush, Trash } from '@phosphor-icons/react';
import type { Asset } from '../shared/types';
import { Modal } from './components';

export default function ImageMaskEditor({ source, mask, open, close, save, error, clothingOnly = false }: { clothingOnly?: boolean; source: Asset; mask?: Asset; open: boolean; close: () => void; save: (mask: Asset) => void; error: (message: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), last = useRef<{ x: number; y: number } | null>(null), undo = useRef<ImageData[]>([]);
  const [brush, setBrush] = useState(36), [erase, setErase] = useState(false), [saving, setSaving] = useState(false), [changes, setChanges] = useState(0);
  const scale = Math.min(1, 2048 / Math.max(source.width, source.height)), width = Math.round(source.width * scale), height = Math.round(source.height * scale);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    // The Radix portal mounts with the dialog. Defer initialization one frame.
    const frame = requestAnimationFrame(() => {
      const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, width, height); undo.current = []; setChanges(0);
      if (!mask) return;
      const image = new window.Image();
      image.onload = () => {
        if (disposed || !canvas.current) return;
        ctx.drawImage(image, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < pixels.data.length; i += 4) { const alpha = pixels.data[i]; pixels.data[i] = 220; pixels.data[i + 1] = 245; pixels.data[i + 2] = 141; pixels.data[i + 3] = alpha; }
        ctx.putImageData(pixels, 0, 0);
      };
      image.onerror = () => error('The saved area could not be loaded. Paint the person again.');
      image.src = `/api/assets/${mask.id}/original`;
    });
    return () => { disposed = true; cancelAnimationFrame(frame); };
  }, [open, source.id, mask?.id, width, height, error]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height }; };
  const draw = (event: React.PointerEvent<HTMLCanvasElement>, start = false) => {
    if (saving || (!start && !last.current)) return;
    const ctx = canvas.current!.getContext('2d')!, p = point(event), bounds = event.currentTarget.getBoundingClientRect();
    if (start) { undo.current.push(ctx.getImageData(0, 0, width, height)); if (undo.current.length > 6) undo.current.shift(); event.currentTarget.setPointerCapture(event.pointerId); }
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; ctx.strokeStyle = '#dcf58d'; ctx.fillStyle = '#dcf58d';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brush * width / bounds.width;
    ctx.beginPath(); ctx.moveTo(last.current?.x ?? p.x, last.current?.y ?? p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    if (start) { ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    last.current = p;
  };
  const saveArea = async () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx || saving) return;
    const input = ctx.getImageData(0, 0, width, height);
    if (!input.data.some((value, index) => index % 4 === 3 && value > 8)) { error(clothingOnly ? 'Paint the garments you want to change first.' : 'Paint over the person you want to replace first.'); return; }
    setSaving(true);
    try {
      const output = document.createElement('canvas'); output.width = width; output.height = height;
      const out = output.getContext('2d')!, pixels = out.createImageData(width, height);
      for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = input.data[i + 3]; pixels.data[i + 3] = 255; }
      out.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('The painted area could not be saved.')), 'image/png'));
      const form = new FormData(); form.append('file', blob, 'replacement-area.png');
      const response = await fetch(`/api/images/mask/${source.id}`, { method: 'POST', body: form }), value = await response.json();
      if (!response.ok) throw new Error(value.error || 'The painted area could not be uploaded.');
      save(value); close();
    } catch (e) { error((e as Error).message); } finally { setSaving(false); }
  };
  return <Modal open={open} onOpenChange={value => { if (!value && !saving) close(); }} title={clothingOnly ? "Choose the clothing area" : "Choose the replacement area"} description={clothingOnly ? "Paint the current garments and space needed for the new outfit. Leave the face, hair, hands, jewelry and foreground objects unpainted to preserve them." : "Paint over the original person, including hair, clothes and contact shadows. Keep foreground objects you want to preserve unpainted."} wide>
    <div className="mask-tools"><div className="preview-tabs"><button className={!erase ? 'active' : ''} onClick={() => setErase(false)}><PaintBrush size={15} />Paint</button><button className={erase ? 'active' : ''} onClick={() => setErase(true)}><Eraser size={15} />Erase</button></div><label>Brush<input aria-label="Replacement brush size" type="range" min={4} max={140} value={brush} onChange={e => setBrush(Number(e.target.value))} /></label><button className="icon-button" disabled={!undo.current.length || saving} onClick={() => { const previous = undo.current.pop(); if (previous) canvas.current?.getContext('2d')?.putImageData(previous, 0, 0); setChanges(changes + 1); }} aria-label="Undo brush stroke"><ArrowCounterClockwise size={17} /></button><button className="icon-button" onClick={() => { const ctx = canvas.current?.getContext('2d'); if (ctx) { undo.current.push(ctx.getImageData(0, 0, width, height)); ctx.clearRect(0, 0, width, height); setChanges(changes + 1); } }} aria-label="Clear replacement area"><Trash size={17} /></button></div>
    <div className="mask-stage"><div style={{ aspectRatio: `${source.width}/${source.height}`, width: `min(100%, ${56 * source.width / source.height}dvh)` }}><img src={`/api/assets/${source.id}/original`} alt="Target photograph for selecting the replacement area" draggable={false} /><canvas ref={canvas} width={width} height={height} aria-label={clothingOnly ? "Paint the clothes to change" : "Paint the person to replace"} onPointerDown={event => draw(event, true)} onPointerMove={event => draw(event)} onPointerUp={() => { last.current = null; setChanges(changes + 1); }} onPointerCancel={() => { last.current = null; }} /></div></div>
    <div className="mask-footer"><p>Green areas can change. Everything outside stays from the original photo.</p><button className="primary-button compact" disabled={saving} onClick={() => void saveArea()}><Check size={15} />{saving ? 'Saving area…' : 'Use this area'}</button></div>
  </Modal>;
}
