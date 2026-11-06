import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, CaretDown, X, UploadSimple, FilmStrip, Image as ImageIcon, Scissors, Eye } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {formatTime} from './VideoPlayer';
export {VideoPlayer,VideoPlayback,formatTime} from './VideoPlayer';
import type { Asset } from '../shared/types';
import { clipTime, type ClipSelection } from '../shared/clip';
import MediaPreviewDialog from './MediaPreviewDialog';
import { FieldLabel } from './InfoTip';

export async function api<T>(route: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch('/api' + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || 'The request could not be completed.'); return value;
}
export function SmallSelect({ value, onChange, options, label, disabled = false }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; disabled?: boolean; disabledReason?: string }[]; label: string; disabled?: boolean }) {
  return <Select.Root value={value} onValueChange={onChange} disabled={disabled}><Select.Trigger className="select-trigger" aria-label={label}><Select.Value /><Select.Icon><CaretDown size={13} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper" sideOffset={5}><Select.Viewport>{options.map(item => <Select.Item key={item.value} value={item.value} disabled={item.disabled} title={item.disabledReason} className="select-item"><Select.ItemText>{item.label}</Select.ItemText><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root>;
}
export function Toggle({ label, checked, onChange, disabled = false, detail, detailVisible = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; detail?: string; detailVisible?: boolean }) {
  const id = useId();
  return <div className="toggle-row"><span><FieldLabel label={label} htmlFor={id} help={detailVisible ? undefined : detail} />{detail && detailVisible && <small>{detail}</small>}</span><Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}><Switch.Thumb className="switch-thumb" /></Switch.Root></div>;
}
export function Modal({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function AssetDrop({ kind, asset, onAsset, onError, label, emptyLabel, help, clip, clipFps = 24, onClip, onUploadStateChange, disabled = false }: {
  kind: 'video' | 'image'; asset?: Asset; onAsset: (a: Asset | null) => void; onError: (s: string) => void;
  label?: string; emptyLabel?: string; help?: ReactNode; clip?: ClipSelection; clipFps?: number; onClip?: (selection: ClipSelection) => void; onUploadStateChange?: (uploading: boolean) => void; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null), request = useRef<XMLHttpRequest | null>(null);
  const [dragging, setDragging] = useState(false), [uploading, setUploading] = useState(false), [percent, setPercent] = useState(0), [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ asset: Asset; pending: boolean } | null>(null);
  const uploadObserver = useRef(onUploadStateChange); uploadObserver.current = onUploadStateChange;
  useEffect(() => { uploadObserver.current?.(uploading); }, [uploading]);
  useEffect(() => () => uploadObserver.current?.(false), []);
  const name = label || (kind === 'video' ? 'Motion video' : 'Character reference');
  useEffect(() => () => request.current?.abort(), []);
  const upload = (file?: File) => {
    if (!file || uploading || disabled) return;
    if (file.size > (kind === 'image' ? 25 : 512) * 1024 ** 2) { onError(kind === 'image' ? 'Images can be up to 25 MB.' : 'Videos can be up to 512 MB.'); return; }
    setUploading(true); setPercent(0); setChecking(false);
    const xhr = new XMLHttpRequest(); request.current = xhr; xhr.open('POST', '/api/assets/' + kind);
    xhr.upload.onprogress = event => { if (event.lengthComputable) setPercent(Math.round(event.loaded / event.total * 100)); };
    xhr.upload.onload = () => setChecking(true);
    xhr.onload = () => {
      setUploading(false); setChecking(false);
      try {
        const value: Asset & { error?: string } = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(value.error);
        if (kind === 'video' && onClip) setPreview({ asset: value, pending: true }); else onAsset(value);
      } catch (error) { onError(error instanceof Error ? error.message : 'Upload failed.'); }
    };
    xhr.onerror = () => { setUploading(false); onError('Upload interrupted. Check that the local app is running.'); };
    xhr.onabort = () => setUploading(false);
    const form = new FormData(); form.append('file', file); xhr.send(form);
  };
  return <div className="asset-field"><div className="field-heading"><FieldLabel label={name} help={help} /></div>
    <input ref={input} type="file" accept={kind === 'video' ? 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v' : 'image/png,image/jpeg,image/webp'} hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    <button className={`asset-drop ${asset ? 'has-asset' : ''} ${dragging ? 'dragging' : ''}`} onClick={() => asset ? setPreview({ asset, pending: false }) : input.current?.click()} disabled={uploading} aria-label={asset ? `Preview ${name.toLowerCase()}${kind === 'video' && onClip ? ' and trim clip' : ''}` : `Upload ${name.toLowerCase()}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { onError('Drop one file at a time.'); return; } upload(e.dataTransfer.files[0]); }}>
      {asset ? <><img src={`/api/assets/${asset.id}/poster`} alt={name} /><span className="asset-replace">{kind === 'video' && onClip ? <Scissors size={13} /> : <Eye size={13} />}{kind === 'video' && onClip ? 'Preview & trim' : 'Preview'}</span></> : <div className="drop-empty">{kind === 'video' ? <FilmStrip size={28} weight="light" /> : <ImageIcon size={28} weight="light" />}<strong>{emptyLabel || (kind === 'video' ? 'Add a video' : 'Add a character')}</strong><span>or drop it here</span></div>}
      {uploading && <div className="upload-overlay"><span className="activity-line" /><strong>{checking ? 'Checking media' : `Uploading ${percent}%`}</strong></div>}
    </button><div className="asset-caption">{asset ? <><span title={asset.name}>{asset.name}</span><small>{kind === 'video' ? formatTime(asset.duration) : `${asset.width} × ${asset.height}`}</small></> : <small>{kind === 'video' ? 'MP4, MOV or WebM' : 'JPG, PNG or WebP'}</small>}</div>
    {asset && <div className="asset-footer-actions"><button type="button" className="asset-change-button" onClick={() => input.current?.click()} disabled={uploading} aria-label={`Replace ${name.toLowerCase()}`}><UploadSimple size={13} />Replace</button><button type="button" className="asset-remove-button" disabled={uploading} onClick={() => onAsset(null)} title={`Remove ${name.toLowerCase()}`} aria-label={`Remove ${name.toLowerCase()}`}><X size={14} /></button></div>}
    {asset && kind === 'video' && clip && onClip && <button type="button" className="asset-trim-caption" onClick={() => setPreview({ asset, pending: false })} aria-label={`Trim motion video: ${clip.seconds.toFixed(2)} seconds selected from ${clipTime(clip.start)} to ${clipTime(clip.start + clip.seconds)}`}><Scissors size={13} /><span><strong>{clip.seconds.toFixed(2)}s selected</strong><small>{clipTime(clip.start)} – {clipTime(clip.start + clip.seconds)}</small></span></button>}
    {preview && <MediaPreviewDialog asset={preview.asset} clip={preview.pending ? undefined : clip} fps={clipFps} close={() => setPreview(null)} apply={kind === 'video' && onClip ? selection => { if (preview.pending) onAsset(preview.asset); onClip(selection); setPreview(null); } : undefined} />}
  </div>;
}
