import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DownloadsWorkspace from '../src/DownloadsWorkspace';
import { emptyModels, type ModelInventory } from '../shared/models';

const snapshot: ModelInventory = { key: 'vast:123', instanceId: 123, endpoint: 'http://127.0.0.1:8188', gpu: 'A40', checkedAt: '2026-10-27T00:00:00Z', files: [
  { id: 'diffusion_models/flux-2-klein-4b-fp8.safetensors', size: 2_000_000_000, partialSize: 0, measured: true },
  { id: 'loras/custom.safetensors', size: 100_000_000, partialSize: 20_000_000, measured: true },
] };
describe('Downloads inventory view', () => {
  it('shows a saved disk inventory while offline with its workflow uses and disabled removal', () => {
    const state = emptyModels(); state.inventories = [snapshot];
    const html = renderToStaticMarkup(<DownloadsWorkspace controls={{ state, online: false, blocked: false, download: () => undefined, remove: () => undefined }} required={[]}
      refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('2.12 GB'); // Shared Klein file once, plus complete/partial custom LoRA.
    expect(html).toContain('Saved inventory'); expect(html).toContain('not a live disk check');
    expect(html).toContain('Klein images'); expect(html).toContain('Automatic source-frame preparation only');
    expect(html.match(/<button[^>]*aria-label="Remove custom.safetensors from GPU"[^>]*>/)?.[0]).toContain('disabled');
  });
  it('starts an unrecorded offline inventory empty without claiming all models are downloaded', () => {
    const html = renderToStaticMarkup(<DownloadsWorkspace controls={{ state: emptyModels(), online: false, blocked: false, download: () => undefined, remove: () => undefined }} required={[]}
      refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('No downloaded files recorded'); expect(html).toContain('0 B'); expect(html).toContain('Browse all files');
  });
});
