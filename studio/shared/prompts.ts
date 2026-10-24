import prompts from '../../config/prompts.json';

export type MotionMode = 'swap' | 'motion';
export const PROMPT_VERSION = 'scene-v1' as const;
export const defaultNegativePrompt = prompts.negative;
const compact = (value: string) => value.trim().replace(/\s+/g, ' ');
const legacyPrompts = new Set(prompts.legacyDemoPrompts.map(compact));

export function defaultPrompt(mode: MotionMode = 'swap'): string { return prompts[mode]; }

// Only known, unedited sample text is migrated. User descriptions and saved jobs
// are not rewritten by a broad clothing/scene keyword heuristic.
export function migrateDemoPrompt(prompt: string, mode: MotionMode): string {
  return legacyPrompts.has(compact(prompt)) ? defaultPrompt(mode) : prompt;
}

export function promptAfterModeChange(prompt: string, mode: MotionMode): string {
  const value = compact(prompt);
  return [prompts.swap, prompts.motion, ...prompts.legacyDemoPrompts].some(p => compact(p) === value) ? defaultPrompt(mode) : prompt;
}

export function compilePrompt(mode: MotionMode, prompt: string): string {
  const base = defaultPrompt(mode), custom = migrateDemoPrompt(prompt, mode).trim();
  if (!custom || [prompts.swap, prompts.motion].some(p => compact(p) === compact(custom))) return base;
  // SCAIL expects a description of the finished video, rather than chat roles or
  // editing commands. Refinements supplement the visual conditions, not replace them.
  return `${base}\n\n${custom}`;
}

export function renderPrompt(settings: { mode: MotionMode; prompt: string }, version?: typeof PROMPT_VERSION): string {
  // In-progress jobs made before this harness retain their original text on
  // continuation. Newly created jobs opt in and save the exact compiled graph.
  return version === PROMPT_VERSION ? compilePrompt(settings.mode, settings.prompt) : settings.prompt;
}
