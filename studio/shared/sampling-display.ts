import type { Settings } from './types';

export const samplingOptions: { value: Settings['preset']; label: string }[] = [
  { value: 'fast', label: 'Fast / 6 steps' },
  { value: 'natural', label: 'Natural / 8 steps' },
  { value: 'quality', label: 'Quality / 20 steps' },
];

const steps: Record<Settings['preset'], number> = { fast: 6, natural: 8, quality: 20 };
export function samplingSteps(preset: Settings['preset']): number { return steps[preset]; }

export function samplingNote(preset: Settings['preset']): string {
  if (preset === 'natural') return 'Natural uses 8 steps and is included in setup. In our short comparison it changed some mouth and brow expressions. Relighting is a separate switch in Advanced settings. More steps take longer; compare the result with your source.';
  if (preset === 'quality') return 'Quality uses 20 steps with the speed adapter disabled. It takes longer and does not guarantee a better result. Relighting is controlled separately in Advanced settings.';
  return 'Higher resolution takes more time and memory. Relighting is controlled separately in Advanced settings.';
}
