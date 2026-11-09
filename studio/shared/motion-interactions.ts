import { INTERACTION_MOTION_LORA, leaveInteractionComparison, type OpenjutsuSettings } from './openjutsu';

export function incomingInteractions(settings: OpenjutsuSettings, enabled: boolean): OpenjutsuSettings {
  if (!enabled) return { ...settings, ...leaveInteractionComparison(settings) };
  const loras = settings.loras.filter(l => l.name !== INTERACTION_MOTION_LORA);
  if (loras.length >= 4) throw new Error('Remove one LoRA before enabling incoming hands and objects. Your other adapters have been kept.');
  return { ...settings, referenceScene: true, noLipSync: false, sourceFaceGuide: undefined,
    interactionGuide: 'aligned-interactions-v1', loras: [...loras, { name: INTERACTION_MOTION_LORA, strength: 1 }] };
}

export function incomingInteractionIssue(settings: OpenjutsuSettings, seconds: number): string | null {
  if (settings.interactionGuide !== 'aligned-interactions-v1') return null;
  const limit = Math.min(5, settings.clipSeconds);
  if (!seconds || seconds > limit) return `Select ${limit} seconds or less for incoming hands and objects. Longer continuation is still being evaluated.`;
  const tasks = settings.loras.filter(l => l.name === INTERACTION_MOTION_LORA && l.enabled !== false && l.strength !== 0);
  if (tasks.length !== 1 || tasks[0].strength !== 1) return 'Restore the Motion Transfer adapter at strength 1 for incoming hands and objects.';
  return null;
}
