import { describe, expect, it } from 'vitest';
import { compileOpenjutsu, compileOpenjutsuFace } from '../server/openjutsu-workflow';
import { applySourceInteractions } from '../server/source-interactions';
import { INTERACTION_MOTION_LORA, leaveInteractionComparison, openjutsuDefaults, openjutsuFiles, openjutsuFaceFiles, openjutsuSettingsSchema } from '../shared/openjutsu';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { modelDefinitions } from '../shared/models';
import type { Graph } from '../shared/types';

const settings = { ...openjutsuDefaults, referenceScene: true, motion: 768 as const, seed: 1729, clipSeconds: 5 };
const section = { start: 1.25, length: 3.125 };
const build = (profile?: 'reference-interactions-v1' | 'aligned-interactions-v1') => compileOpenjutsu({ ...settings, ...(profile ? { interactionGuide: profile } : {}) }, section, undefined, 'interactions');
function liveNodes(graph: Graph, id = '67', seen = new Set<string>()): Set<string> {
  if (seen.has(id)) return seen;
  const node = graph[id]; if (!node) throw new Error('Missing graph dependency: ' + id);
  seen.add(id);
  for (const value of Object.values(node.inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') liveNodes(graph, value[0], seen);
  return seen;
}
describe('source-interaction evaluation profiles', () => {
  for (const profile of ['reference-interactions-v1', 'aligned-interactions-v1'] as const) it(`keeps a single native generation and the same source clock / ${profile}`, () => {
    const control = build(), graph = build(profile), nodes = liveNodes(graph);
    expect(nodes.has('34')).toBe(true); expect(nodes.has('41')).toBe(false);
    for (const id of ['5', '32', '33', '34', '22', '59', '60', '63', '64', '67', '11', '26', '25']) expect(graph[id]).toEqual(control[id]);
    expect(graph['5'].inputs.skip_first_frames).toBe(30);
    expect(graph['34'].inputs.batch_index).toEqual(['33', 1]);
    expect(graph['34'].inputs.length).toEqual(['29', 6]);
    expect([...nodes].filter(id => graph[id].class_type === 'SamplerCustomAdvanced')).toEqual(['60']);
    expect(graph['57'].inputs.latent).toEqual(['30', 1]);
    expect(graph['30'].inputs['ref_images.ref_image_0']).toEqual(['2', 0]);
    expect(graph['43'].inputs.shot_prompt).toEqual(['recast_interaction_shots', 0]);
    expect(graph.recast_interaction_shots.inputs.string_a).toEqual(['11', 4]);
    expect(graph.reference_scene_prompt.inputs.string_b).toContain('Keep other people, incoming hands and moving objects');
    expect(graph.reference_scene_prompt.inputs.string_b).toContain('Do not replace bystanders');
    expect(graph.reference_scene_prompt.inputs.string_b).toContain('a back view stays a back view');
    expect(graph.recast_interaction_shots.inputs.string_b).toContain('Do not omit an interaction');
    expect(openjutsuFiles({ ...settings, interactionGuide: profile })).toEqual(openjutsuFiles(settings));
    expect(moduleDownloadPlan('openjutsu', { ...settings, interactionGuide: profile })).toEqual(moduleDownloadPlan('openjutsu', settings));
    // No protected-source latent or final-frame overlay is introduced.
    expect(graph['55']).toBeUndefined(); expect(graph['56']).toBeUndefined();
    expect([...nodes].some(id => /Composite|Paste|Blend/.test(graph[id].class_type))).toBe(false);
  });
  it('retains the complete RGB motion batch and its index-paired audio in reference mode', () => {
    const graph = build('reference-interactions-v1');
    expect(graph['30'].inputs['ref_videos.ref_video_0']).toEqual(['34', 0]);
    expect(graph['30'].inputs['ref_video_audios.ref_video_audio_0']).toEqual(['29', 12]);
    expect(graph['57'].inputs.conditioning).toEqual(['30', 0]);
    expect(graph.recast_interaction_guide).toBeUndefined();
  });
  it('uses one frame-zero aligned guide, with no second full-video reference path', () => {
    const graph = build('aligned-interactions-v1');
    expect(graph['30'].inputs['ref_videos.ref_video_0']).toBeUndefined();
    expect(graph['30'].inputs['ref_video_audios.ref_video_audio_0']).toBeUndefined();
    expect(graph.recast_interaction_guide).toMatchObject({ class_type: 'MiniMaxH3AddGuide', inputs: {
      positive: ['30', 0], latent: ['30', 1], image: ['34', 0], audio: ['29', 12], frame_idx: 0, vae: ['20', 0], audio_vae: ['21', 0],
    } });
    expect(graph['57'].inputs.conditioning).toEqual(['recast_interaction_guide', 0]);
    expect(JSON.stringify(graph.reference_scene_prompt)).not.toContain('<Video 1>');
    expect(JSON.stringify(graph.recast_interaction_prompt)).not.toContain('<Video 1>');
  });
  it('requires an explicit single window for the unqualified aligned-history combination', () => {
    for (const length of [0, 5.01, 10]) expect(() => compileOpenjutsu({ ...settings, interactionGuide: 'aligned-interactions-v1' }, { start: 0, length })).toThrow('one explicit section');
    expect(() => compileOpenjutsu({ ...settings, clipSeconds: 2.5, interactionGuide: 'aligned-interactions-v1' }, section)).toThrow('one explicit section');
    expect(() => compileOpenjutsu({ ...settings, interactionGuide: 'reference-interactions-v1' }, { start: 0, length: 10 })).not.toThrow();
  });
  it('attaches the long-clip guide after protected context for every native window', () => {
    const graph = compileOpenjutsu({ ...settings, interactionGuide: 'aligned-interactions-v2' }, { start: 1.25, length: 30 }, undefined, 'long-interactions');
    expect(graph.recast_interaction_guide.inputs).toMatchObject({ positive: ['57', 0], latent: ['57', 3], image: ['34', 0], audio: ['29', 12], frame_idx: 0 });
    expect(graph['57'].inputs.conditioning).toEqual(['30', 0]);
    expect(graph['57'].inputs.latent).toEqual(['30', 1]);
    expect(graph['58'].inputs.conditioning).toEqual(['recast_interaction_guide', 0]);
    expect(graph['60'].inputs.latent_image).toEqual(['57', 3]);
    expect(graph['25'].inputs.scene_continuity).toBe('Hard picture + protected audio');
    const original = build();
    for (const id of ['29', '32', '33', '34', '63', '64', '66', '67']) expect(graph[id]).toEqual(id === '67' ? { ...original[id], inputs: { ...original[id].inputs, filename: ['recast_run_name', 0] } } : original[id]);
    expect(liveNodes(graph).has('41')).toBe(false);
    expect([...liveNodes(graph)].filter(id => graph[id].class_type === 'SamplerCustomAdvanced')).toEqual(['60']);
    const unsafe = build(); unsafe['25'].inputs.scene_continuity = 'Visual continuity';
    expect(() => applySourceInteractions(unsafe, 'aligned-interactions-v2')).toThrow('protected native segment handoff');
  });
  it('does not add a profile to existing settings or affect the native face-fix graph', () => {
    expect(openjutsuSettingsSchema.parse(settings)).not.toHaveProperty('interactionGuide');
    expect(compileOpenjutsuFace({ ...settings, interactionGuide: 'aligned-interactions-v1' }, { style: 'mouth', chunkSeconds: 6.5 }))
      .toEqual(compileOpenjutsuFace(settings, { style: 'mouth', chunkSeconds: 6.5 }));
    const withTask = { ...settings, interactionGuide: 'aligned-interactions-v1' as const, loras: [...settings.loras, { name: INTERACTION_MOTION_LORA, strength: 1 }] };
    expect(compileOpenjutsuFace(withTask, { style: 'mouth', chunkSeconds: 6.5 })).toEqual(compileOpenjutsuFace(settings, { style: 'mouth', chunkSeconds: 6.5 }));
    expect(openjutsuFaceFiles(withTask)).toEqual(openjutsuFaceFiles(settings));
  });
  it('keeps standalone comparison cache names distinct without changing an explicit Studio namespace', () => {
    const a = compileOpenjutsu({ ...settings, interactionGuide: 'reference-interactions-v1' }, section);
    const b = compileOpenjutsu({ ...settings, interactionGuide: 'aligned-interactions-v1' }, section);
    expect(a.recast_interaction_run.inputs.string_b).not.toBe(b.recast_interaction_run.inputs.string_b);
    expect(a['26'].inputs.run_name).toEqual(['recast_interaction_run', 0]);
    expect(a['67'].inputs.filename).toEqual(['recast_interaction_run', 0]);
    expect(build('aligned-interactions-v1')['26'].inputs.run_name).toEqual(build()['26'].inputs.run_name);
  });
  it('refuses incompatible profile/scene/audio/facial-guide combinations before rendering', () => {
    for (const patch of [{ referenceScene: false }, { noLipSync: true }, { sourceFaceGuide: 'source-face-guide-v1' }, { interactionGuide: 'unknown' }]) {
      expect(openjutsuSettingsSchema.safeParse({ ...settings, interactionGuide: 'reference-interactions-v1', ...patch }).success).toBe(false);
    }
    expect(() => applySourceInteractions({}, 'reference-interactions-v1')).toThrow('reference-scene');
    expect(() => applySourceInteractions(build(), 'unknown' as never)).toThrow('Unknown');
    const wrong = build(); wrong['57'].inputs.latent = '30,1';
    expect(() => applySourceInteractions(wrong, 'reference-interactions-v1')).toThrow('original empty target');
    expect(() => applySourceInteractions(build('aligned-interactions-v1'), 'aligned-interactions-v1')).toThrow();
    const original = build(), saved = JSON.stringify(original);
    applySourceInteractions(original, 'reference-interactions-v1');
    expect(JSON.stringify(original)).toBe(saved);
  });
  it('adds only the explicitly selected task adapter to downloads and restores the original guide cleanly', () => {
    const candidate = { ...settings, interactionGuide: 'aligned-interactions-v1' as const, loras: [...settings.loras, { name: INTERACTION_MOTION_LORA, strength: 1 }] };
    expect(openjutsuFiles(candidate).filter(id => !openjutsuFiles(settings).includes(id))).toEqual(['loras/' + INTERACTION_MOTION_LORA]);
    const file = modelDefinitions.find(f => f.id === 'loras/' + INTERACTION_MOTION_LORA)!;
    expect(file.size).toBe(184840504);
    expect(leaveInteractionComparison(candidate)).toEqual({ interactionGuide: undefined, loras: settings.loras });
    expect(leaveInteractionComparison({ ...candidate, interactionGuide: undefined })).toEqual({ interactionGuide: undefined });
    expect(openjutsuSettingsSchema.parse({ ...candidate, ...leaveInteractionComparison(candidate) })).toEqual(settings);
    const disabled = { ...candidate, loras: candidate.loras.map(l => l.name === INTERACTION_MOTION_LORA ? { ...l, enabled: false } : l) };
    expect(openjutsuFiles(disabled)).not.toContain('loras/' + INTERACTION_MOTION_LORA);
  });
});
