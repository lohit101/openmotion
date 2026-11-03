import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelsWorkspace from '../src/ModelDownloads';
import { emptyModels } from '../shared/models';
import { VIGGLE_DMD } from '../server/viggle-workflow';

describe('model-specific adapter storage controls', () => {
  it('lets the user remove a downloaded Viggle accelerator without offering it as a SCAIL style adapter', () => {
    const state = emptyModels();
    state.installedLoras = [{ name: VIGGLE_DMD, size: 3767420888, included: false }];
    state.files.find(file => file.id === 'loras/' + VIGGLE_DMD)!.status = 'installed';
    const html = renderToStaticMarkup(<ModelsWorkspace required={['loras/' + VIGGLE_DMD]} controls={{ state, online: true, blocked: false, settingUp: false, download: () => undefined, remove: () => undefined }} refresh={() => undefined} cancel={() => undefined} setup={() => undefined} />);
    expect(html).toContain('Remove Viggle distillation adapter from GPU');
    expect(html).toContain(VIGGLE_DMD);
    const start = html.indexOf('<h3>Viggle distillation adapter</h3>');
    expect(html.slice(start, html.indexOf('</article>', start))).not.toContain('Use in LoRA A');
  });
});
