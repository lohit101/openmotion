import { describe, expect, it } from 'vitest';
import { samplingNote, samplingOptions, samplingSteps } from '../shared/sampling-display';

describe('sampling preset display', () => {
  it('shows Natural between the historical presets and reports each render’s actual step count', () => {
    expect(samplingOptions).toEqual([
      { value: 'fast', label: 'Fast / 6 steps' },
      { value: 'natural', label: 'Natural / 8 steps' },
      { value: 'quality12', label: 'Quality / 12 steps' },
      { value: 'quality16', label: 'Quality / 16 steps' },
      { value: 'quality', label: 'Quality / 20 steps' },
    ]);
    expect(samplingSteps('fast')).toBe(6);
    expect(samplingSteps('natural')).toBe(8);
    expect(samplingSteps('quality12')).toBe(12);
    expect(samplingSteps('quality16')).toBe(16);
    expect(samplingSteps('quality')).toBe(20);
  });
  it('keeps relighting separate from the Natural preset and avoids a promised quality improvement', () => {
    expect(samplingNote('natural')).toContain('Relighting is a separate switch');
    expect(samplingNote('natural')).toContain('More steps take longer');
    expect(samplingNote('quality')).toContain('does not guarantee a better result');
    for (const preset of ['quality12', 'quality16'] as const) {
      expect(samplingNote(preset)).toContain(`${samplingSteps(preset)} steps`);
      expect(samplingNote(preset)).toContain('speed adapter disabled');
    }
  });
});
