import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MotionInteractions from '../src/MotionInteractions';
import { incomingInteractions, incomingInteractionIssue, upgradeIncomingDraft } from '../shared/motion-interactions';
import { INTERACTION_MOTION_LORA, emptyOpenjutsuDraft, openjutsuDefaults, openjutsuFiles } from '../shared/openjutsu';
import { compileOpenjutsu, compileOpenjutsuFace } from '../server/openjutsu-workflow';
import { moduleDownloadPlan } from '../shared/module-downloads';

describe('live incoming-interaction controls', () => {
  it('upgrades only the editable saved short-guide flag without shortening or changing inputs', () => {
    const draft = { ...emptyOpenjutsuDraft(), sourceId: 'source', referenceId: 'photo', start: 2.5, length: 30, settings: { ...openjutsuDefaults, referenceScene: true, interactionGuide: 'aligned-interactions-v1' as const } };
    const before = structuredClone(draft), upgraded = upgradeIncomingDraft(draft);
    expect(draft).toEqual(before);
    expect(upgraded).toEqual({ ...draft, settings: { ...draft.settings, interactionGuide: 'aligned-interactions-v2' } });
    const normal = emptyOpenjutsuDraft(); expect(upgradeIncomingDraft(normal)).toBe(normal);
  });
  it('selects the actual tested guide and one active task adapter without mutating other settings', () => {
    const original = { ...structuredClone(openjutsuDefaults), noLipSync: true, sourceFaceGuide: 'source-face-guide-v1' as const, seed: 37, clipSeconds: 15 };
    const before = structuredClone(original), s = incomingInteractions(original, true);
    expect(original).toEqual(before);
    expect(s).toMatchObject({ referenceScene: true, noLipSync: false, interactionGuide: 'aligned-interactions-v2', seed: 37, clipSeconds: 15 });
    expect(s.sourceFaceGuide).toBeUndefined();
    expect(s.loras).toEqual([...original.loras, { name: INTERACTION_MOTION_LORA, strength: 1 }]);
    const g = compileOpenjutsu(s, { start: 1.25, length: 3.125 });
    expect(g.recast_interaction_guide.inputs.image).toEqual(['34', 0]);
    expect(g['57'].inputs.conditioning).toEqual(['30', 0]);
    expect(g['58'].inputs.conditioning).toEqual(['recast_interaction_guide', 0]);
    expect(Object.values(g).filter(n => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === INTERACTION_MOTION_LORA)).toHaveLength(1);
    expect(Object.values(g).filter(n => n.class_type === 'SamplerCustomAdvanced')).toHaveLength(1);
  });
  it('re-enables an existing adapter once and preserves unrelated adapters', () => {
    const s = incomingInteractions({ ...openjutsuDefaults, loras: [...openjutsuDefaults.loras, { name: INTERACTION_MOTION_LORA, strength: .2, enabled: false }] }, true);
    expect(s.loras.filter(l => l.name === INTERACTION_MOTION_LORA)).toEqual([{ name: INTERACTION_MOTION_LORA, strength: 1 }]);
    expect(incomingInteractions(s, true)).toEqual(s);
    const full = { ...openjutsuDefaults, loras: Array.from({ length: 4 }, (_, i) => ({ name: `custom${i}.safetensors`, strength: 1 })) };
    const before = structuredClone(full);
    expect(() => incomingInteractions(full, true)).toThrow('Remove one LoRA');
    expect(full).toEqual(before);
  });
  it('permits long selections while retaining the original saved short-guide restriction', () => {
    const s = { ...incomingInteractions({ ...openjutsuDefaults, clipSeconds: 15 }, true), interactionGuide: 'aligned-interactions-v1' as const };
    expect(incomingInteractionIssue(s, 8)).toContain('supports 5 seconds');
    expect(incomingInteractionIssue(s, 5)).toBeNull();
    expect(incomingInteractionIssue(s, 5.00000001)).toContain('supports 5 seconds');
    expect(incomingInteractionIssue({ ...s, clipSeconds: 2.5 }, 3)).toContain('supports 2.5 seconds');
    expect(() => compileOpenjutsu(s, { start: 0, length: 8 })).toThrow('one explicit section');
    const upgraded = incomingInteractions(s, true);
    for (const length of [0, 8, 15, 30, 60]) {
      expect(incomingInteractionIssue(upgraded, length)).toBeNull();
      expect(() => compileOpenjutsu(upgraded, { start: 0, length })).not.toThrow();
    }
  });
  it('reports a removed, disabled or altered motion adapter before UI submission', () => {
    const s = incomingInteractions(openjutsuDefaults, true);
    for (const loras of [[], [{ name: INTERACTION_MOTION_LORA, strength: 1, enabled: false }], [{ name: INTERACTION_MOTION_LORA, strength: .5 }]]) {
      expect(incomingInteractionIssue({ ...s, loras }, 3)).toContain('Restore the Motion Transfer');
    }
  });
  it('restores the original guide and keeps Fix Faces isolated', () => {
    const original = { ...openjutsuDefaults, referenceScene: true }, s = incomingInteractions(original, true);
    expect(compileOpenjutsu(incomingInteractions(s, false), { start: 0, length: 8 })).toEqual(compileOpenjutsu(original, { start: 0, length: 8 }));
    expect(compileOpenjutsuFace(s, { style: 'mouth', chunkSeconds: 6.5 })).toEqual(compileOpenjutsuFace(original, { style: 'mouth', chunkSeconds: 6.5 }));
    expect(incomingInteractionIssue(original, 8)).toBeNull();
  });
  it('routes only the selected task weight through the existing download button', () => {
    const s = incomingInteractions(openjutsuDefaults, true), plan = moduleDownloadPlan('openjutsu', s);
    expect(plan.files.filter(f => !openjutsuFiles(openjutsuDefaults).includes(f))).toEqual(['loras/' + INTERACTION_MOTION_LORA]);
    expect(plan.runtimes).toEqual(moduleDownloadPlan('openjutsu', openjutsuDefaults).runtimes);
  });
  it('shows the active long guide and explicit upgrade for old saved short drafts', () => {
    const settings = incomingInteractions({ ...openjutsuDefaults, clipSeconds: 15 }, true);
    const html = renderToStaticMarkup(<MotionInteractions settings={settings} seconds={8} change={() => {}} shorten={() => {}} />);
    expect(html).toContain('Keep incoming hands &amp; objects');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Long clips supported');
    expect(html).not.toContain('Use 5s from current start');
    expect(html).toContain('Identity and hair can still vary');
    expect(renderToStaticMarkup(<MotionInteractions settings={{ ...openjutsuDefaults, referenceScene: false }} seconds={8} change={() => {}} shorten={() => {}} />)).toBe('');
    const saved = renderToStaticMarkup(<MotionInteractions settings={{ ...settings, interactionGuide: 'aligned-interactions-v1' }} seconds={8} change={() => {}} shorten={() => {}} />);
    expect(saved).toContain('Enable longer clips');
    expect(saved).toContain('Use 5s from current start');
  });
});
