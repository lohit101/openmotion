import { describe, expect, it } from 'vitest';
import type { Job } from '../shared/types';
import { imageEditVersion } from '../shared/image-edit';
import { jobWorkspace, splitWorkspace } from '../src/WorkspacePanels';

// These fields control navigation only. Generation, media and receipts stay with
// the existing module; especially automatic FPS finishing must not open Post.
describe('mobile result navigation', () => {
  it.each([
    [{}, 'create'],
    [{ smoothMotion: { automatic: true } }, 'create'],
    [{ smoothMotion: { automatic: false } }, 'post'],
    [{ openjutsu: { face: {} }, smoothMotion: { automatic: true } }, 'post'],
    [{ upscale: {}, smoothMotion: { automatic: true } }, 'clarity'],
    [{ edit: {} }, 'editor'],
    [{ mediaType: 'image', image: { version: imageEditVersion } }, 'image'],
    [{ mediaType: 'image', image: { version: 'retired-image' } }, null],
  ])('routes the saved result to its owning module', (job, workspace) => {
    expect(jobWorkspace(job as Job)).toBe(workspace);
  });

  it('offers Setup and Preview only for split workspaces', () => {
    expect((['create', 'image', 'clarity', 'post'] as const).every(splitWorkspace)).toBe(true);
    expect((['editor', 'library', 'gpu', 'settings'] as const).some(splitWorkspace)).toBe(false);
  });
});
