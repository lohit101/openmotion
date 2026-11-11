import { Eye, SlidersHorizontal } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { isImageEditJob } from '../shared/image-edit';
import type { WorkspaceView } from './Sidebar';
import { Button } from './ui/Button';

export type WorkspacePane = 'setup' | 'preview';
export const splitWorkspace = (view: WorkspaceView) => ['create', 'image', 'clarity', 'post'].includes(view);
export function jobWorkspace(job: Job): WorkspaceView | null {
  if (job.openjutsu?.face || job.smoothMotion && !job.smoothMotion.automatic) return 'post';
  if (isImageEditJob(job)) return 'image';
  if (job.upscale) return 'clarity';
  if (job.edit) return 'editor';
  return job.mediaType === 'image' ? null : 'create';
}
export function WorkspacePanels({ pane, change, busy }: { pane: WorkspacePane; change: (pane: WorkspacePane) => void; busy: boolean }) {
  return <div className="workspace-panel-switch" role="group" aria-label="Workspace view">
    <Button variant="ghost" aria-pressed={pane === 'setup'} onClick={() => change('setup')}><SlidersHorizontal size={15} />Setup</Button>
    <Button variant="ghost" aria-pressed={pane === 'preview'} onClick={() => change('preview')}><Eye size={15} />Preview{busy && <span className="pane-processing" aria-label="Processing" />}</Button>
  </div>;
}
