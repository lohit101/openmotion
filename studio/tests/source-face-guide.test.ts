import { describe, expect, it } from 'vitest';
import { compileOpenjutsu, compileOpenjutsuFace } from '../server/openjutsu-workflow';
import { applySourceFaceGuide } from '../server/source-face-guide';
import { openjutsuDefaults, openjutsuFiles, openjutsuSettingsSchema } from '../shared/openjutsu';
import { moduleDownloadPlan } from '../shared/module-downloads';
import type { Graph } from '../shared/types';

describe('isolated source-face guide evaluation', () => {
  for (const referenceScene of [false, true]) for (const sourceFaceGuide of ['source-face-guide-v1', 'source-face-detail-v1'] as const) {
    it(`changes only the native facial guide for ${referenceScene ? 'photo' : 'source'} scene / ${sourceFaceGuide}`, () => {
      const settings = { ...openjutsuDefaults, referenceScene, motion: 768 as const, steps: 6, seed: 1729 };
      const control = compileOpenjutsu(settings, { start: 1, length: 5 }, undefined, 'comparison');
      const result = compileOpenjutsu({ ...settings, sourceFaceGuide }, { start: 1, length: 5 }, undefined, 'comparison');
      const changed = [...new Set([...Object.keys(control), ...Object.keys(result)])].filter(id => JSON.stringify(control[id]) !== JSON.stringify(result[id]));
      expect(changed.sort()).toEqual(['41', '69', '70', '71']);
      expect(result['41'].inputs).toMatchObject({ faces: ['71', 0], face_size: ['71', 1], face_blur: sourceFaceGuide === 'source-face-guide-v1' ? 0.05 : 0.015 });
      expect(result['70'].inputs).toMatchObject({ images: ['36', 0], detection_threshold: 0.2, detect_interval: 1 });
      expect(result['71'].inputs).toMatchObject({ track_data: ['70', 0], hold_frames: 0 });
      expect(result['41'].inputs.mask).toEqual(control['41'].inputs.mask);
      expect(result['69'].inputs.text).toBe('face');
      for (const title of ['Sampler', 'Schedule', 'Sigma Shift', 'Clip Seed', 'Sample Video + Audio']) {
        const node = Object.keys(control).find(id => control[id]._meta?.title === title)!;
        expect(node).toBeDefined();
        expect(result[node]).toEqual(control[node]);
      }
      expect(control['30'].inputs['ref_video_audios.ref_video_audio_0']).toEqual(['29', 12]);
      expect(result['30']).toEqual(control['30']);
      expect(JSON.stringify(result)).not.toContain('Mute the');
      expect(result['5']).toEqual(control['5']);
      expect(control['41'].inputs.faces).toBeUndefined();
      expect(openjutsuFiles({ ...settings, sourceFaceGuide })).toEqual(openjutsuFiles(settings));
      expect(moduleDownloadPlan('openjutsu', { ...settings, sourceFaceGuide })).toEqual(moduleDownloadPlan('openjutsu', settings));
    });
  }
  it('does not add a profile to old settings or change the native Fix Faces graph', () => {
    expect(openjutsuSettingsSchema.parse(openjutsuDefaults)).not.toHaveProperty('sourceFaceGuide');
    expect(compileOpenjutsuFace({ ...openjutsuDefaults, sourceFaceGuide: 'source-face-detail-v1' }, { style: 'mouth', chunkSeconds: 6.5 }))
      .toEqual(compileOpenjutsuFace(openjutsuDefaults, { style: 'mouth', chunkSeconds: 6.5 }));
  });
  it('rejects muted-audio combinations, unknown profiles and incompatible graphs', () => {
    expect(openjutsuSettingsSchema.safeParse({ ...openjutsuDefaults, noLipSync: true, sourceFaceGuide: 'source-face-guide-v1' }).success).toBe(false);
    expect(openjutsuSettingsSchema.safeParse({ ...openjutsuDefaults, sourceFaceGuide: 'anything' }).success).toBe(false);
    expect(() => applySourceFaceGuide({} as Graph, 'source-face-guide-v1')).toThrow('copied');
    const duplicate = compileOpenjutsu({ ...openjutsuDefaults, noLipSync: true }, { start: 0, length: 5 });
    expect(() => applySourceFaceGuide(duplicate, 'source-face-guide-v1')).toThrow('existing');
  });
});
