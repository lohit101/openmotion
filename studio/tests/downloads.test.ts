import { describe, expect, it } from 'vitest';
import { deletableModelFile, downloadRows, modelUsage } from '../shared/downloads';
import { downloadableModelDefinitions, emptyModels, isRetiredModel, modelDefinitions, QWEN_STRUCTURE, type ModelInventory } from '../shared/models';

describe('download inventory presentation', () => {
  it('hides retired files from the available catalog while retaining measured stored files and deletion', () => {
    const state = emptyModels(), retired = modelDefinitions.filter(file => isRetiredModel(file.id));
    expect(retired.length).toBeGreaterThan(0);
    expect(downloadRows(state).some(file => file.retired)).toBe(false);
    expect(downloadableModelDefinitions.some(file => isRetiredModel(file.id))).toBe(false);
    const id = retired[0].id, snapshot: ModelInventory = { key: 'vast:1', instanceId: 1, endpoint: 'http://127.0.0.1:8188', gpu: 'A40', checkedAt: '2026-11-03', files: [{ id, size: 1234, partialSize: 500, measured: true }] };
    expect(downloadRows(state, snapshot).find(row => row.id === id)).toMatchObject({ retired: true, onDisk: 1734, measured: true, usage: [{ workflow: 'Retired files' }] });
    expect(deletableModelFile(id)).toBe(true);
    expect(downloadRows(state, snapshot).filter(file => file.retired)).toHaveLength(1);
  });
  it('counts CUDA face dependencies as core face files, with no custom-LoRA classification',()=>{
    const snapshot:ModelInventory={key:'vast:1',instanceId:1,endpoint:'http://127.0.0.1:8188',gpu:'RTX A6000',checkedAt:'2026-10-28',files:[{id:'face-refinement/hyperswap_1a_256.onnx',size:402742682,partialSize:0,measured:true}]};
    const row=downloadRows(emptyModels(),snapshot).find(item=>item.id.startsWith('face-refinement/'))!;
    expect(row).toMatchObject({group:'core',onDisk:402742682,measured:true,usage:[{workflow:'GPU face refinement'}]});
    expect(row.id.startsWith('loras/')).toBe(false);
    const hidden: ModelInventory = { ...snapshot, files: [...snapshot.files, { id: 'face_consistency/facefusion/nsfw_1.onnx', size: 80414194, partialSize: 0, measured: true }, { id: 'face-refinement/nsfw_2.onnx', size: 22489928, partialSize: 0, measured: true }] };
    expect(downloadRows(emptyModels(), hidden).some(item => /nsfw_\d+/.test(item.id))).toBe(false);
    expect(modelDefinitions.some(file => /nsfw_\d+/.test(file.filename))).toBe(false);
  });
  it('maps every bundled file to its actual workflow, including shared image preparation', () => {
    for (const file of modelDefinitions) expect(modelUsage(file.id).length).toBeGreaterThan(0);
    expect(modelUsage('diffusion_models/flux-2-klein-4b-fp8.safetensors').map(usage => usage.workflow)).toEqual(['Klein images', 'Viggle video']);
    expect(modelUsage(QWEN_STRUCTURE)[0].detail).toContain('above zero');
    expect(modelUsage('loras/user.safetensors')[0].workflow).toBe('Custom LoRA');
    expect(modelUsage('diffusion_models/qwen_image_2.1_int8_convrot.safetensors').map(usage => usage.workflow)).toEqual(['Qwen images', 'Viggle video']);
  });
  it('permits catalog weights and runtime dependencies while rejecting arbitrary paths', () => {
    for (const file of modelDefinitions) expect(deletableModelFile(file.id)).toBe(true);
    expect(deletableModelFile('face-refinement/hyperswap_1a_256.onnx')).toBe(true);
    expect(deletableModelFile('loras/styles/custom.safetensors')).toBe(true);
    for (const id of ['../foo.safetensors', 'loras/../foo.safetensors', '/loras/foo.safetensors', 'loras//foo.safetensors', 'config/server.json', 'face-refinement/unknown.onnx', 'vae/unknown.safetensors']) expect(deletableModelFile(id)).toBe(false);
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
