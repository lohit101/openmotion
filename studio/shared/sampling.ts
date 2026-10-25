import type { Settings } from './types';

const steps: Record<Settings['preset'], number> = { fast: 6, natural: 8, quality12: 12, quality16: 16, quality: 20 };
export function samplingSteps(preset: Settings['preset']): number { return steps[preset]; }
export function usesSpeedAdapter(preset: Settings['preset']): boolean { return preset === 'fast' || preset === 'natural'; }
