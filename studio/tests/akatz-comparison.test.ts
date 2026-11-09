import { describe, expect, it } from 'vitest';
import { akatzComparisonRequests, akatzSourceSceneRequest, derivedComparisonRequest } from '../shared/akatz-comparison';
import { AKATZ_CHARACTER_LORA, INTERACTION_MOTION_LORA, leaveInteractionComparison, openjutsuDefaults, openjutsuFaceFiles, openjutsuFiles, type OpenjutsuDraft } from '../shared/openjutsu';
import { compileOpenjutsu, compileOpenjutsuFace } from '../server/openjutsu-workflow';
import { moduleDownloadPlan } from '../shared/module-downloads';

const parent = (): OpenjutsuDraft => ({ sourceId: 'source', referenceId: 'reference', start: 0.5, length: 3.125, outputFPS: 24,
  settings: { ...structuredClone(openjutsuDefaults), referenceScene: true, interactionGuide: 'aligned-interactions-v1', clipSeconds: 5, motion: 768, seed: 1729,
    loras: [...structuredClone(openjutsuDefaults.loras), { name: INTERACTION_MOTION_LORA, strength: 1 }] } });

describe('isolated Akatz / motion adapter comparison', () => {
  it('keeps the baseline immutable and varies only explicit task-adapter weights', () => {
    const base = parent(), original = JSON.stringify(base), arms = akatzComparisonRequests(base);
    expect(JSON.stringify(base)).toBe(original);
    expect(arms.map(a => a.name)).toEqual(['motion-control', 'combined035', 'combined065', 'combined100', 'akatz-only']);
    expect(arms[0].request).toEqual(base);
    for (const arm of arms) {
      const expected = structuredClone(base), actual = structuredClone(arm.request);
      expected.settings.loras = []; actual.settings.loras = [];
      expect(actual).toEqual(expected);
    }
    expect(arms.slice(1).map(a => a.request.settings.loras.at(-1)?.strength)).toEqual([0.35, 0.65, 1, 1]);
    expect(arms.at(-1)!.request.settings.loras.some(l => l.name === INTERACTION_MOTION_LORA)).toBe(false);
  });
  it('chains three compatible model-only loaders through the existing sampler without a second generation', () => {
    const arms = akatzComparisonRequests(parent());
    const base = compileOpenjutsu(arms[0].request.settings, arms[0].request, undefined, 'comparison');
    for (const arm of arms.slice(1)) {
      const graph = compileOpenjutsu(arm.request.settings, arm.request, undefined, 'comparison');
      for (const id of ['22', '30', '34', '43', '45', '57', '58', '59', '60', '63', '67', 'recast_interaction_guide']) expect(graph[id]).toEqual(base[id]);
      const loaders = Object.entries(graph).filter(([, n]) => n.class_type === 'LoraLoaderModelOnly');
      expect(loaders).toHaveLength(arm.name === 'akatz-only' ? 2 : 3);
      const [id, last] = loaders.find(([, n]) => n.inputs.lora_name === AKATZ_CHARACTER_LORA)!;
      expect(last.inputs.strength_model).toBe(arm.request.settings.loras.at(-1)!.strength);
      expect(graph['17'].inputs.model).toEqual([id, 0]);
      expect(Object.values(graph).filter(n => n.class_type === 'SamplerCustomAdvanced')).toHaveLength(1);
    }
  });
  it('selects only the new small weight and keeps the existing runtime/download contract', () => {
    const arms = akatzComparisonRequests(parent()), before = moduleDownloadPlan('openjutsu', arms[0].request.settings);
    const after = moduleDownloadPlan('openjutsu', arms[1].request.settings);
    expect(after.files.filter(f => !before.files.includes(f))).toEqual(['loras/' + AKATZ_CHARACTER_LORA]);
    expect(after.runtimes).toEqual(before.runtimes);
    expect(openjutsuFiles(openjutsuDefaults)).toHaveLength(7);
  });
  it('leaves the comparison cleanly and prevents task adapters leaking into Fix Faces', () => {
    const s = akatzComparisonRequests(parent())[1].request.settings;
    const clean = { ...s, ...leaveInteractionComparison(s) };
    expect(clean.loras).toEqual(openjutsuDefaults.loras);
    expect(openjutsuFaceFiles(s)).toEqual(openjutsuFaceFiles(clean));
    expect(compileOpenjutsuFace(s, { style: 'photo', chunkSeconds: 5 })).toEqual(compileOpenjutsuFace(clean, { style: 'photo', chunkSeconds: 5 }));
    expect(leaveInteractionComparison({ ...s, interactionGuide: undefined })).toEqual({ interactionGuide: undefined });
  });
  it('prepares a source-scene first swap and uses only verified native durations for derived requests', () => {
    const base = parent(), swap = akatzSourceSceneRequest(base);
    expect(swap.settings.referenceScene).toBe(false); expect(swap.settings.interactionGuide).toBeUndefined();
    expect(swap.settings.loras.at(-1)).toEqual({ name: AKATZ_CHARACTER_LORA, strength: 1 });
    expect(swap.settings.loras.some(l => l.name === INTERACTION_MOTION_LORA)).toBe(false);
    const graph = compileOpenjutsu(swap.settings, swap);
    expect(graph['55']).toBeDefined(); expect(graph['56']).toBeDefined();
    const next = derivedComparisonRequest(base, 'verified-derived-asset', 73);
    expect(next).toMatchObject({ sourceId: 'verified-derived-asset', referenceId: base.referenceId, start: 0, length: 73 / 24, settings: base.settings });
    expect(Math.round(next.length * 24)).toBe(73);
    for (const frames of [0, 4, 5, 22, 39, 72, 74, 124, 73.1]) expect(() => derivedComparisonRequest(base, 'derived', frames)).toThrow('verified native');
    expect(() => derivedComparisonRequest(base, '', 73)).toThrow('verified native');
  });
  it('rejects uncontrolled or incompatible parents before preparing a paid request', () => {
    const invalid = [
      { ...parent(), sourceId: null }, { ...parent(), length: 0 }, { ...parent(), length: 6 }, { ...parent(), outputFPS: 30 as const },
      { ...parent(), settings: { ...parent().settings, referenceScene: false } },
      { ...parent(), settings: { ...parent().settings, steps: 8 } },
      { ...parent(), settings: { ...parent().settings, model: 'another-model.safetensors' } },
      { ...parent(), settings: { ...parent().settings, loras: openjutsuDefaults.loras } },
      { ...parent(), settings: { ...parent().settings, loras: [...parent().settings.loras, { name: AKATZ_CHARACTER_LORA, strength: 1 }] } },
    ];
    for (const value of invalid) expect(() => akatzComparisonRequests(value)).toThrow();
  });
});
