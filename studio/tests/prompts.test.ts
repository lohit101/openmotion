import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import prompts from '../../config/prompts.json';
import { Store } from '../server/store';
import { compileWorkflow } from '../server/workflow';
import { compilePrompt, defaultPrompt, migrateDemoPrompt, PROMPT_VERSION, promptAfterModeChange, renderPrompt } from '../shared/prompts';
import { defaults, settingsSchema } from '../shared/types';
import type { Graph, Job } from '../shared/types';

const repo = path.resolve(import.meta.dirname, '../..');
const template: Graph = JSON.parse(readFileSync(path.join(repo, 'workflows/api/scail2_int8_swap.json'), 'utf8'));
const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });
function jobFixture(): Job {
  return { id: 'new', title: 'Prompt test', status: 'running', sourceId: 'source', referenceId: 'reference', settings: { ...defaults }, promptVersion: PROMPT_VERSION,
    createdAt: new Date().toISOString(), favorite: false, deleted: false, uploads: { source: 'source.mp4', reference: 'face.png' }, width: 480, height: 864,
    progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 24, updatedAt: Date.now() },
    segments: [], context: '', pendingPrompt: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
}

describe('scene-preserving prompt harness', () => {
  it('accepts blank or very short refinements and supplies the full descriptive default', () => {
    expect(settingsSchema.parse({}).prompt).toBe('');
    expect(settingsSchema.parse({ prompt: '  ' }).prompt).toBe('');
    expect(settingsSchema.parse({ prompt: 'x' }).prompt).toBe('x');
    expect(() => settingsSchema.parse({ prompt: 'x'.repeat(8001) })).toThrow();
    expect(compilePrompt('swap', '')).toBe(defaultPrompt('swap'));
    expect(compilePrompt('swap', 'Natural blinking.')).toBe(defaultPrompt('swap') + '\n\nNatural blinking.');
    expect(compilePrompt('swap', defaults.prompt)).toBe(defaultPrompt('swap'));
    expect(defaultPrompt('swap')).toContain('matching apparent head and torso size');
    expect(defaultPrompt('swap')).toContain('source environment');
    expect(defaultPrompt('swap')).not.toMatch(/curtains|cargo|sofa|bun|boots/);
  });
  it('uses reference-scene semantics for motion mode without erasing custom text', () => {
    expect(compilePrompt('motion', defaultPrompt('swap'))).toBe(defaultPrompt('motion'));
    expect(compilePrompt('motion', '')).toContain('reference environment');
    expect(compilePrompt('motion', '')).not.toContain('source environment');
    expect(promptAfterModeChange(defaultPrompt('swap'), 'motion')).toBe(defaultPrompt('motion'));
    expect(promptAfterModeChange('Warm light on a blue outfit.', 'motion')).toBe('Warm light on a blue outfit.');
  });
  it('migrates only exact sample prompts and preserves edits, inputs, settings and saved jobs', () => {
    for (const demo of prompts.legacyDemoPrompts) {
      expect(migrateDemoPrompt('  ' + demo.replaceAll(' ', '\n') + ' ', 'swap')).toBe(defaultPrompt('swap'));
      expect(migrateDemoPrompt(demo + ' Natural blinking.', 'swap')).toBe(demo + ' Natural blinking.');
    }
    const root = mkdtempSync(path.join(os.tmpdir(), 'recast-prompt-')); temporary.push(root);
    const store = new Store(root);
    try {
      const draft = { sourceId: 'new-source', referenceId: 'new-character', settings: { ...defaults, seconds: 1.5, preset: 'quality', prompt: prompts.legacyDemoPrompts[1] } };
      const original = { ...jobFixture(), id: 'historical', settings: { ...defaults, ...draft.settings, preset: 'quality' as const } };
      store.addJob(original); store.set('draft', draft);
      expect(store.draft()).toEqual({ ...draft, settings: { ...draft.settings, prompt: defaultPrompt('swap') } });
      expect(store.job('historical')!.settings.prompt).toBe(prompts.legacyDemoPrompts[1]);
      store.set('draft', { ...draft, settings: { ...draft.settings, prompt: 'My custom blue dress.' } });
      expect(store.draft().settings.prompt).toBe('My custom blue dress.');
    } finally { store.close(); }
  });
  it('sends the harness to native text conditioning and keeps pre-harness continuations unchanged', () => {
    const job = jobFixture(); job.settings.prompt = 'Natural blinking.';
    expect(compileWorkflow(template, job)['31'].inputs.text).toBe(compilePrompt('swap', 'Natural blinking.'));
    job.settings.prompt = '';
    expect(compileWorkflow(template, job)['31'].inputs.text).toBe(defaultPrompt('swap'));
    delete job.promptVersion; job.settings.prompt = prompts.legacyDemoPrompts[1];
    expect(compileWorkflow(template, job)['31'].inputs.text).toBe(prompts.legacyDemoPrompts[1]);
    expect(renderPrompt(job.settings)).toBe(job.settings.prompt);
  });
});
