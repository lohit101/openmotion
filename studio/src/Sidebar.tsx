import type { ReactElement } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowsOut, FilmSlate, GearSix, GraphicsCard, ImageSquare, Images, Scissors, SidebarSimple, MagicWand } from '@phosphor-icons/react';

export type WorkspaceView = 'create' | 'image' | 'clarity' | 'editor' | 'library' | 'gpu' | 'settings' | 'post';

export function initialSidebarCollapsed() {
  try {
    const saved = localStorage.getItem('recast-sidebar-collapsed');
    if (saved !== null) return saved === 'true';
  } catch { /* The sidebar also works when browser storage is unavailable. */ }
  return window.matchMedia('(max-width: 1120px)').matches;
}

function NavHint({ label, detail, children }: { label: string; detail?: string; children: ReactElement }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal>
    <Tooltip.Content className="rail-tooltip" side="right" sideOffset={10} collisionPadding={12}>
      <strong>{label}</strong>{detail && <span>{detail}</span>}<Tooltip.Arrow className="rail-tooltip-arrow" />
    </Tooltip.Content>
  </Tooltip.Portal></Tooltip.Root>;
}

export default function Sidebar({ view, select, collapsed, toggle, libraryCount }: {
  view: WorkspaceView; select: (view: WorkspaceView) => void; collapsed: boolean; toggle: () => void; libraryCount: number;
}) {
  const link = (id: WorkspaceView, label: string, Icon: typeof GearSix) => <NavHint key={id} label={label}><button type="button"
    className={`rail-link ${view === id ? 'active' : ''}`} aria-label={label} aria-current={view === id ? 'page' : undefined}
    onClick={() => select(id)} title={label}>
    <Icon size={18} weight="regular" aria-hidden="true" /><span>{label}</span>
  </button></NavHint>;
  const shortcut = (id: 'library' | 'gpu', label: string, detail: string, Icon: typeof GearSix) => <NavHint label={label} detail={detail}><button type="button"
    className={`rail-shortcut ${view === id ? 'active' : ''}`} onClick={() => select(id)} aria-label={label}
    aria-current={view === id ? 'page' : undefined} title={label}>
    <Icon size={20} weight="regular" aria-hidden="true" />
  </button></NavHint>;
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return <Tooltip.Provider delayDuration={180} skipDelayDuration={100} disableHoverableContent><aside className="nav-rail" aria-label="Main navigation">
    <div className="rail-header"><span className="rail-section-label" id="rail-create-label">Create</span>
      <NavHint label={toggleLabel}><button type="button" className="rail-toggle" onClick={toggle}
        aria-expanded={!collapsed} aria-controls="workspace-navigation" aria-label={toggleLabel} title={toggleLabel}>
        <SidebarSimple size={18} weight={collapsed ? 'regular' : 'duotone'} aria-hidden="true" />
      </button></NavHint>
    </div>
    <div className="rail-navigation" id="workspace-navigation">
      <nav className="rail-main" aria-labelledby="rail-create-label">
        {link('create', 'Remotion', FilmSlate)}{link('image', 'Imagen', ImageSquare)}
      </nav>
      <nav className="rail-edit" aria-label="Edit"><span className="rail-section-label" aria-hidden="true">Edit</span>
        {link('post', 'Post-processing', MagicWand)}{link('clarity', 'Clarity', ArrowsOut)}{link('editor', 'Clip editor', Scissors)}
      </nav>
      <div className="rail-bottom"><span className="rail-section-label" aria-hidden="true">Workspace</span>
        <nav className="rail-shortcuts" aria-label="Library and compute">
          {shortcut('library', 'My library', `${libraryCount} ${libraryCount === 1 ? 'item' : 'items'} in your library`, Images)}
          {shortcut('gpu', 'GPU cloud', 'Browse GPUs and manage your instances', GraphicsCard)}
        </nav>
        <nav className="rail-settings" aria-label="App settings">{link('settings', 'Settings', GearSix)}</nav>
      </div>
    </div>
  </aside></Tooltip.Provider>;
}
