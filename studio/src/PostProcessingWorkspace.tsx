import { FilmStrip, Sparkle } from '@phosphor-icons/react';
import OpenjutsuFaceWorkspace from './OpenjutsuFaceWorkspace';
import SmoothMotionWorkspace, { type PostWorkspaceProps } from './SmoothMotionWorkspace';
import './openjutsu.css';
import './post-processing.css';

export default function PostProcessingWorkspace({ mode, changeMode, ...props }: PostWorkspaceProps & { mode: 'face' | 'motion'; changeMode: (mode: 'face' | 'motion') => void }) {
  return <div className="post-layout"><nav className="post-navigation" aria-label="Post-processing tools"><div><span className="workspace-overline">FINISH YOUR VIDEO</span><h1>Post-processing</h1></div><div className="post-tool-tabs">{([{ value: 'face', label: 'Fix Faces', Icon: Sparkle }, { value: 'motion', label: 'Smooth Motion', Icon: FilmStrip }] as const).map(({ value, label, Icon }) => <button type="button" key={value} aria-current={mode === value ? 'page' : undefined} className={`secondary-button ${mode === value ? 'selected' : ''}`} onClick={() => changeMode(value)}><Icon size={17} />{label}</button>)}</div></nav>
    {mode === 'face' ? <OpenjutsuFaceWorkspace {...props} /> : <SmoothMotionWorkspace {...props} />}
  </div>;
}
