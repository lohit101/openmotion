import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelsWorkspace from '../src/ModelDownloads';
import { emptyModels } from '../shared/models';
import { VIGGLE_DMD } from '../server/viggle-workflow';

describe('model-specific adapter storage controls', () => {
  it('hides the retired Viggle accelerator from Extras; its on-disk deletion stays in Downloads', () => {
    const state = emptyModels();
    state.installedLoras = [{ name: VIGGLE_DMD, size: 3767420888, included: false }];
    state.files.find(file => file.id === 'loras/' + VIGGLE_DMD)!.status = 'installed';
    const html = renderToStaticMarkup(<ModelsWorkspace required={['loras/' + VIGGLE_DMD]} controls={{ state, online: true, blocked: false, settingUp: false, download: () => undefined, remove: () => undefined }} refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).not.toContain(VIGGLE_DMD);
    expect(html).not.toContain('Use in LoRA A');
  });
});
