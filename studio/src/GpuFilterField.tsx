import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FieldLabel } from './InfoTip';
import { InputAddon, InputGroup } from './ui/InputGroup';

export function commitGpuNumber(raw: string, previous: number, min: number, max: number, integer = true) {
  if (!raw.trim() || !Number.isFinite(Number(raw))) return { value: previous, issue: 'Enter a number.' };
  const parsed = Number(raw), value = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed));
  const issue = parsed < min ? `Minimum ${min}.` : parsed > max ? `Maximum ${max}.` : integer && parsed !== value ? 'Whole numbers only.' : '';
  return { value, issue };
}

export default function GpuFilterField({ label, ariaLabel = label, value, change, unit, icon, min, max, step = 1, integer = true, help }: {
  label: string; ariaLabel?: string; value: number; change: (value: number) => void; unit: string; icon: ReactNode;
  min: number; max: number; step?: number; integer?: boolean; help?: ReactNode;
}) {
  const id = useId(), focused = useRef(false), [draft, setDraft] = useState(String(value)), [issue, setIssue] = useState('');
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    focused.current = false;
    const result = commitGpuNumber(draft, value, min, max, integer);
    setDraft(String(result.value)); setIssue(result.issue);
    if (result.value !== value) change(result.value);
  };
  return <div className="gpu-filter-field"><FieldLabel label={label} htmlFor={id} help={help} />
    <InputGroup><InputAddon>{icon}</InputAddon><input id={id} aria-label={ariaLabel} type="number" inputMode={integer ? 'numeric' : 'decimal'}
      min={min} max={max} step={step} value={draft} aria-describedby={issue ? `${id}-hint` : undefined}
      onFocus={() => { focused.current = true; }} onChange={event => { setDraft(event.target.value); setIssue(''); }} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /><InputAddon>{unit}</InputAddon></InputGroup>
    {issue && <small id={`${id}-hint`} className="gpu-filter-issue" role="status">{issue}</small>}
  </div>;
}
