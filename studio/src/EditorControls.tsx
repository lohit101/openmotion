import { useId, useState, type ReactNode, type Ref } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { InfoTip } from './InfoTip';
import './editor.css';

export function EditorSection({ title, children, help }: { title: string; children: ReactNode; help?: ReactNode }) {
  const id = useId();
  return <section className="editor-section" aria-labelledby={id}><header className="editor-section-heading"><h2 id={id}>{title}</h2>{help && <InfoTip label={title}>{help}</InfoTip>}</header>{children}</section>;
}

export function EditorDisclosure({ title, meta, help, children, defaultOpen = false, className = '' }: { title: string; meta?: string; help?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={`editor-disclosure ${className}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span className="disclosure-title">{title}{help && <InfoTip label={title}>{help}</InfoTip>}</span>{meta && <span className="disclosure-meta" title={meta}>{meta}</span>}<CaretDown className="disclosure-caret" size={14} /></summary><div className="editor-disclosure-body">{children}</div></details>;
}

export function PromptEditor({ id, label = 'Prompt', value, onChange, defaultValue, disabled = false, inputRef, help }: { id: string; label?: string; value: string; onChange: (value: string) => void; defaultValue: string; disabled?: boolean; inputRef?: Ref<HTMLTextAreaElement>; help: ReactNode }) {
  const customized = !!value.trim() && value.trim() !== defaultValue.trim();
  return <EditorDisclosure key={disabled ? 'inactive' : 'active'} title={label} meta={disabled ? 'Skipped · edited frame' : customized ? 'Custom' : 'Default'} help={help} className={`editor-prompt${disabled ? ' inactive' : ''}`}>
    {disabled && <p className="editor-inline-note">Your edited frame controls appearance. This prompt is skipped.</p>}
    <div className="prompt-field"><label className="visually-hidden" htmlFor={id}>{label}</label><textarea id={id} ref={inputRef} value={value} onChange={event => onChange(event.target.value)} maxLength={8000} spellCheck={false} disabled={disabled} placeholder="The default handles character replacement. Add any details you want to refine." /><div className="prompt-bottom"><span>{disabled ? 'Saved prompt' : value.trim() ? `${value.length.toLocaleString()} / 8,000` : 'Using the default prompt'}</span>{!disabled && <div><button type="button" onClick={() => onChange(defaultValue)}>Use default</button><button type="button" onClick={() => onChange('')}>Clear</button></div>}</div></div>
  </EditorDisclosure>;
}
