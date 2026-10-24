import { copyFile, mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { defaults, geometry, segmentCount } from '../shared/types';
import type { Job, Settings } from '../shared/types';
import type { Store } from './store';
import { ingest, poster } from './media';

export async function seedExamples(store: Store, repo: string) {
  if (store.value('examplesImported', false)) return;
  const root = path.join(repo, 'outputs');
  const referencePath = path.join(root, 'simple-dance-test/character-reference.png');
  try { await access(referencePath); } catch { store.set('examplesImported', true); return; }
  const reference = store.asset('example-reference') || await ingest(store, referencePath, 'image', 'Studio character.png', true, 'example-reference');
  const examples = [
    { id: 'example-indoor', folder: 'simple-dance-test', output: 'after.mp4', title: 'Indoor movement', time: 123.3, relight: true, history: 'history.json' },
    { id: 'example-outdoor-relit', folder: 'first-gpu-test', output: 'after-relight.mp4', title: 'Coastal dance', time: 104.75, relight: true, history: 'relight-history.json' },
    { id: 'example-outdoor-base', folder: 'first-gpu-test', output: 'after-fast-baseline.mp4', title: 'Coastal dance, first pass', time: 130.18, relight: false, history: 'baseline-history.json' },
  ];
  for (const item of examples) {
    if (store.job(item.id)) continue;
    const directory = path.join(root, item.folder);
    try {
      await access(path.join(directory, item.output));
      const sourceId = item.folder === 'simple-dance-test' ? 'example-source-indoor' : 'example-source-outdoor';
      const source = store.asset(sourceId) || await ingest(store, path.join(directory, 'before.mp4'), 'video', item.folder === 'simple-dance-test' ? 'Indoor dance.mp4' : 'Coastal dance.mp4', true, sourceId);
      const plan = JSON.parse(await readFile(path.join(directory, 'test-plan.json'), 'utf8'));
      const settings: Settings = { ...defaults, prompt: plan.prompt || defaults.prompt, relight: item.relight, loraA: 'None', loraB: 'None' };
      const [width, height] = geometry(settings, source);
      const folder = path.join(store.root, 'jobs', item.id); await mkdir(folder, { recursive: true });
      const output = path.join(folder, 'final.mp4'), thumb = path.join(folder, 'poster.jpg');
      await copyFile(path.join(directory, item.output), output); await poster(output, thumb);
      let history: any = null;
      try { history = JSON.parse(await readFile(path.join(directory, item.history), 'utf8')); } catch { /* Output remains available if historical metadata was not packaged. */ }
      const stamp = history?.status?.messages?.find((v: any[]) => v[0] === 'execution_success')?.[1]?.timestamp;
      const createdAt = new Date(stamp || Date.now()).toISOString();
      const job: Job = { id: item.id, title: item.title, status: 'completed', settings, sourceId, referenceId: reference.id,
        createdAt, startedAt: createdAt, finishedAt: createdAt, favorite: false, deleted: false, width, height,
        progress: { stage: 'Complete', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 48, targetFrames: 48, updatedAt: Date.now() },
        segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output, poster: thumb, cancelRequested: false, elapsedSeconds: item.time, origin: 'import', workflow: history?.prompt?.[2] || null };
      store.addJob(job);
      if (item.id === 'example-indoor' && !store.value('draftInitialized', false)) { store.set('draft', { sourceId, referenceId: reference.id, settings }); store.set('draftInitialized', true); }
    } catch (error) { console.warn(`Could not import ${item.title}:`, error instanceof Error ? error.message : error); }
  }
  store.set('examplesImported', true);
}
