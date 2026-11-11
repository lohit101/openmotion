import { useState } from 'react';
import { ArrowsOut, CaretRight, FilmSlate, GearSix, GraphicsCard, ImageSquare, Images, MagicWand, Scissors, SquaresFour } from '@phosphor-icons/react';
import type { WorkspaceView } from './Sidebar';
import { Button } from './ui/Button';
import { Sheet, SheetContent, SheetTrigger } from './ui/Sheet';

export const toolViews: WorkspaceView[] = ['post', 'clarity', 'editor', 'settings'];
export default function MobileNavigation({ view, select }: { view: WorkspaceView; select: (view: WorkspaceView) => void }) {
  const [open, setOpen] = useState(false);
  const link = (id: WorkspaceView, label: string, Icon: typeof FilmSlate) => <Button key={id} variant="ghost" className={`mobile-nav-item ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => select(id)}><Icon size={20} aria-hidden="true" /><span>{label}</span></Button>;
  return <nav className="mobile-navigation" aria-label="Mobile navigation">
    {link('create', 'Remotion', FilmSlate)}{link('image', 'Imagen', ImageSquare)}{link('library', 'Library', Images)}
    <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" className={`mobile-nav-item ${toolViews.includes(view) ? 'active' : ''}`} aria-current={toolViews.includes(view) ? 'page' : undefined}><SquaresFour size={20} aria-hidden="true" /><span>Tools</span></Button></SheetTrigger>
      <SheetContent title="Tools"><div className="mobile-tool-list">{([
        ['post', 'Post-processing', 'Fix Faces and Smooth Motion', MagicWand],
        ['clarity', 'Clarity', 'Upscale your video', ArrowsOut],
        ['editor', 'Clip editor', 'Trim and join clips', Scissors],
        ['settings', 'Settings', 'Connection, downloads and alerts', GearSix],
      ] as const).map(([id, label, detail, Icon]) => <Button key={id} variant="ghost" className="mobile-tool" aria-current={view === id ? 'page' : undefined} onClick={() => { select(id); setOpen(false); }}><Icon size={20} /><span><strong>{label}</strong><small>{detail}</small></span><CaretRight size={15} /></Button>)}</div></SheetContent>
    </Sheet>
    {link('gpu', 'GPU', GraphicsCard)}
  </nav>;
}
