import type { Settings } from './types';
import { samplingSteps, usesSpeedAdapter } from './sampling';
export { samplingSteps } from './sampling';

export const samplingOptions: { value: Settings['preset']; label: string }[] = [
  { value: 'fast', label: 'Fast / 6 steps' },
  { value: 'natural', label: 'Natural / 8 steps' },
  { value: 'quality12', label: 'Quality / 12 steps' },
  { value: 'quality16', label: 'Quality / 16 steps' },
  { value: 'quality', label: 'Quality / 20 steps' },
];

export function samplingNote(preset: Settings['preset']): string {
  if (preset === 'natural') return 'Natural uses 8 steps and is included in setup. In our short comparison it changed some mouth and brow expressions. Relighting is a separate switch in Advanced settings. More steps take longer; compare the result with your source.';
  if (!usesSpeedAdapter(preset)) return `Quality uses ${samplingSteps(preset)} steps with the speed adapter disabled. It takes longer and does not guarantee a better result. Relighting is controlled separately in Advanced settings.`;
  return 'Higher resolution takes more time and memory. Relighting is controlled separately in Advanced settings.';
}
