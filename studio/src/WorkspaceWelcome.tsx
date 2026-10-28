import { Aperture, ArrowRight, SquaresFour } from '@phosphor-icons/react';
import './welcome.css';

export default function WorkspaceWelcome({ kind, library, openActive }: { kind: 'photo' | 'video'; library: () => void; openActive?: () => void }) {
  return <div className="workspace-welcome" aria-label={`Empty ${kind} workspace`}>
    <div className="welcome-identity"><Aperture size={88} weight="light" aria-hidden="true" /><span>remotion<span>studio</span></span></div>
    <p>Open a {kind} to preview, or create something new.</p>
    <div className="welcome-actions"><button type="button" onClick={library}><SquaresFour size={15} />Open library</button>{openActive && <button type="button" onClick={openActive}>View current render<ArrowRight size={14} /></button>}</div>
  </div>;
}
