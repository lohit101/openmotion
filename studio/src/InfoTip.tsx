import { useRef, useState, type ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info } from '@phosphor-icons/react';

/** Portaled help stays readable inside the editor's scrolling panels. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openBeforePress = useRef(false);
  return <Tooltip.Provider delayDuration={220}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild><button type="button" className="info-tip-trigger" aria-label={`About ${label}`} onPointerDownCapture={() => { openBeforePress.current = open; }} onClick={event => {
      // Also usable on touchscreens; do not activate a neighbouring control.
      event.preventDefault(); event.stopPropagation(); setOpen(event.detail === 0 ? !open : !openBeforePress.current);
    }}><Info size={14} aria-hidden="true" /></button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="info-tip-content" side="right" align="center" sideOffset={8} collisionPadding={12} hideWhenDetached>
      {children}<Tooltip.Arrow className="info-tip-arrow" width={9} height={5} />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

export function FieldLabel({ label, help, htmlFor }: { label: string; help?: ReactNode; htmlFor?: string }) {
  return <span className="field-label-row">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}{help && <InfoTip label={label}>{help}</InfoTip>}</span>;
}
