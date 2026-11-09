import { INTERACTION_MOTION_LORA, leaveInteractionComparison, type OpenjutsuDraft, type OpenjutsuSettings } from './openjutsu';

export function upgradeIncomingDraft(draft: OpenjutsuDraft): OpenjutsuDraft {
  return draft.settings.interactionGuide === 'aligned-interactions-v1'
    ? { ...draft, settings: { ...draft.settings, interactionGuide: 'aligned-interactions-v2' } } : draft;
}

export function incomingInteractions(settings: OpenjutsuSettings, enabled: boolean): OpenjutsuSettings {
  if (!enabled) return { ...settings, ...leaveInteractionComparison(settings) };
  const loras = settings.loras.filter(l => l.name !== INTERACTION_MOTION_LORA);
  if (loras.length >= 4) throw new Error('Remove one LoRA before enabling incoming hands and objects. Your other adapters have been kept.');
  return { ...settings, referenceScene: true, noLipSync: false, sourceFaceGuide: undefined,
    interactionGuide: 'aligned-interactions-v2', loras: [...loras, { name: INTERACTION_MOTION_LORA, strength: 1 }] };
}

export function incomingInteractionIssue(settings: OpenjutsuSettings, seconds: number): string | null {
  if (settings.interactionGuide !== 'aligned-interactions-v1' && settings.interactionGuide !== 'aligned-interactions-v2') return null;
  const limit = Math.min(5, settings.clipSeconds);
  if (settings.interactionGuide === 'aligned-interactions-v1' && (!seconds || seconds > limit)) return `This saved guide supports ${limit} seconds or less. Enable longer clips to keep the interaction guide in every segment.`;
  const tasks = settings.loras.filter(l => l.name === INTERACTION_MOTION_LORA && l.enabled !== false && l.strength !== 0);
  if (tasks.length !== 1 || tasks[0].strength !== 1) return 'Restore the Motion Transfer adapter at strength 1 for incoming hands and objects.';
  return null;
}
