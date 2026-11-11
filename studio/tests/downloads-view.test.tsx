import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DownloadsWorkspace from '../src/DownloadsWorkspace';
import { downloadableModelDefinitions, emptyModels, NATURAL_SPEED, type ModelInventory } from '../shared/models';
import { DownloadButton } from '../src/ModelDownloads';

const snapshot: ModelInventory = { key: 'vast:123', instanceId: 123, endpoint: 'http://127.0.0.1:8188', gpu: 'A40', checkedAt: '2026-10-27T00:00:00Z', files: [
  { id: 'diffusion_models/flux-2-klein-4b-fp8.safetensors', size: 2_000_000_000, partialSize: 0, measured: true },
  { id: 'loras/custom.safetensors', size: 100_000_000, partialSize: 20_000_000, measured: true },
] };
describe('Downloads inventory view', () => {
  it('keeps stored retired models removable and excludes them from download controls and bulk provisioning', () => {
    const state = emptyModels(), id = 'loras/' + NATURAL_SPEED;
    state.inventories = [{ ...snapshot, files: [{ id, size: 100, partialSize: 0, measured: true }] }]; state.checkedAt = snapshot.checkedAt;
    const controls = { state, online: true, blocked: false, download: () => undefined, remove: () => undefined };
    const html = renderToStaticMarkup(<DownloadsWorkspace controls={controls} required={[]} refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('Retired · stored files only'); expect(html).toContain('Delete Natural / swap acceleration from GPU');
    expect(html).not.toContain('Download Natural / swap acceleration');
    expect(html).toContain(`All ${new Set(downloadableModelDefinitions.map(file => file.id)).size} available model files`);
    expect(renderToStaticMarkup(<DownloadButton files={[id]} controls={controls} label="Retired file" />)).toBe('');
  });
  it('shows a saved disk inventory while offline with its workflow uses and disabled removal', () => {
    const state = emptyModels(); state.inventories = [snapshot];
    const html = renderToStaticMarkup(<DownloadsWorkspace controls={{ state, online: false, blocked: false, download: () => undefined, remove: () => undefined }} required={[]}
      refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('2.12 GB'); // Shared Klein file once, plus complete/partial custom LoRA.
    expect(html).toContain('Saved inventory'); expect(html).toContain('not a live disk check');
    expect(html).toContain('Retired files'); expect(html).toContain('New downloads are disabled');
    expect(html.match(/<button[^>]*aria-label="Delete custom.safetensors from GPU"[^>]*>/)?.[0]).toContain('disabled');
  });
  it('starts an unrecorded offline inventory empty without claiming all models are downloaded', () => {
    const html = renderToStaticMarkup(<DownloadsWorkspace controls={{ state: emptyModels(), online: false, blocked: false, download: () => undefined, remove: () => undefined }} required={[]}
      refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('No downloaded files recorded'); expect(html).toContain('0 B'); expect(html).toContain('Browse all files');
  });
  it('offers deletion for core weights and partial files on the connected GPU, but blocks writes during work', () => {
    const state = emptyModels(); state.inventories = [snapshot]; state.checkedAt = snapshot.checkedAt;
    const render = (blocked: boolean) => renderToStaticMarkup(<DownloadsWorkspace controls={{ state, online: true, blocked, download: () => undefined, remove: () => undefined }} required={[]}
      refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    for (const label of ['FLUX.2 Klein 4B', 'custom.safetensors']) {
      const button = (html: string) => html.match(new RegExp(`<button[^>]*aria-label="Delete ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} from GPU"[^>]*>`))?.[0];
      expect(button(render(false))).toBeTruthy(); expect(button(render(false))).not.toContain('disabled'); expect(button(render(true))).toContain('disabled');
    }
    expect(render(false)).toContain('Your saved photos and videos are kept');
  });
});
