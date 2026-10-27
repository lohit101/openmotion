import { CaretDoubleLeft, CaretDoubleRight, GearSix, Image, Lightning, Scissors, SlidersHorizontal, SquaresFour } from '@phosphor-icons/react';

export type WorkspaceView = 'create' | 'image' | 'editor' | 'library' | 'gpu' | 'settings';

export function initialSidebarCollapsed() {
  try {
    const saved = localStorage.getItem('recast-sidebar-collapsed');
    if (saved !== null) return saved === 'true';
  } catch { /* The sidebar also works when browser storage is unavailable. */ }
  return window.matchMedia('(max-width: 1120px)').matches;
}

export default function Sidebar({ view, select, collapsed, toggle, libraryCount }: {
  view: WorkspaceView; select: (view: WorkspaceView) => void; collapsed: boolean; toggle: () => void; libraryCount: number;
}) {
  const link = (id: WorkspaceView, label: string, Icon: typeof GearSix, count?: number) => <button
    className={`rail-link ${view === id ? 'active' : ''}`} aria-label={label} aria-current={view === id ? 'page' : undefined}
    onClick={() => select(id)} title={label}>
    <Icon size={21} /><span>{label}</span>{count !== undefined && <small className="rail-count">{count}</small>}
  </button>;
  return <aside className="nav-rail" aria-label="Main navigation">
    <div className="rail-header"><span>Workspace</span><button className="rail-toggle" onClick={toggle}
      aria-expanded={!collapsed} aria-controls="workspace-navigation" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <CaretDoubleRight size={16} /> : <CaretDoubleLeft size={16} />}</button></div>
    <nav className="rail-main" id="workspace-navigation" aria-label="Workspace">
      {link('create', 'Motion control', SlidersHorizontal)}{link('image', 'Image replacement', Image)}{link('editor', 'Clip editor', Scissors)}
    </nav>
    <div className="rail-bottom"><nav className="rail-utilities" aria-label="Library and GPU">
      {link('library', 'My library', SquaresFour, libraryCount)}{link('gpu', 'GPU cloud', Lightning)}
    </nav><div className="rail-settings">{link('settings', 'Settings', GearSix)}</div></div>
  </aside>;
}
