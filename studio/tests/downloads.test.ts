import { describe, expect, it } from 'vitest';
import { downloadRows, modelUsage } from '../shared/downloads';
import { emptyModels, modelDefinitions, QWEN_STRUCTURE, type ModelInventory } from '../shared/models';

describe('download inventory presentation', () => {
  it('maps every bundled file to its actual workflow, including shared image preparation', () => {
    for (const file of modelDefinitions) expect(modelUsage(file.id).length).toBeGreaterThan(0);
    expect(modelUsage('diffusion_models/flux-2-klein-4b-fp8.safetensors').map(usage => usage.workflow)).toEqual(['Klein images', 'Viggle video']);
    expect(modelUsage(QWEN_STRUCTURE)[0].detail).toContain('above zero');
    expect(modelUsage('loras/user.safetensors')[0].workflow).toBe('Custom LoRA');
  });
  it('counts shared files and partial bytes once and keeps offline records separate from readiness', () => {
    const state = emptyModels(), id = modelDefinitions[0].id;
    const inventory: ModelInventory = { key: 'vast:123', instanceId: 123, endpoint: 'http://127.0.0.1:8188', gpu: 'A40', checkedAt: '2026-10-27T00:00:00Z', files: [
      { id, size: 900, partialSize: 120, measured: true }, { id: 'loras/user.safetensors', size: 80, partialSize: 0, measured: true },
    ] };
    const rows = downloadRows(state, inventory);
    expect(rows.filter(file => file.id === id)).toHaveLength(1);
    expect(rows.reduce((sum, file) => sum + file.onDisk, 0)).toBe(1100);
    expect(rows.find(file => file.id === 'loras/user.safetensors')?.usage[0].workflow).toBe('Custom LoRA');
    expect(state.files.every(file => file.status === 'unknown')).toBe(true);
    const online = downloadRows(state, inventory, true);
    expect(online.find(file => file.id === id)?.onDisk).toBe(1020);
    expect(downloadRows(state).every(file => file.onDisk === 0)).toBe(true);
  });
  it('uses true transfer bytes without counting a complete file as another partial', () => {
    const state = emptyModels(), file = state.files[0];
    Object.assign(file, { status: 'downloading', downloaded: 400, percent: 20 });
    expect(downloadRows(state, undefined, true)[0]).toMatchObject({ bytes: 0, partial: 400, onDisk: 400, status: 'downloading' });
    Object.assign(file, { status: 'installed', downloaded: modelDefinitions[0].size });
    expect(downloadRows(state, undefined, true)[0]).toMatchObject({ partial: 0, onDisk: modelDefinitions[0].size, status: 'installed' });
    state.installedLoras = [{ name: 'custom.safetensors', size: 200, partialSize: 10, included: false }];
    expect(downloadRows(state, undefined, true).find(row => row.id === 'loras/custom.safetensors')?.onDisk).toBe(210);
  });
});
