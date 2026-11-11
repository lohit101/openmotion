import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { Button } from './Button';

// Same accessible Dialog foundation as shadcn's Sheet. Keep a real Trigger for
// focus restoration, and let Radix own Escape, outside clicks and focus trapping.
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export function SheetContent({ title, children }: { title: string; children: ReactNode }) {
  return <Dialog.Portal><Dialog.Overlay className="sheet-overlay" /><Dialog.Content className="ui-sheet" aria-describedby={undefined}>
    <header className="ui-sheet-header"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={`Close ${title.toLowerCase()}`}><X size={18} /></Button></Dialog.Close></header>
    <div className="ui-sheet-body">{children}</div>
  </Dialog.Content></Dialog.Portal>;
}
