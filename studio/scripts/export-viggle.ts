/** Regenerate the editable/API graphs; never downloads models or submits jobs. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaults, type Job } from '../shared/types';
import { compileViggleWorkflow } from '../server/viggle-workflow';
import { defaultVigglePrompt } from '../shared/engines';
const directory = path.resolve(import.meta.dirname, '../../workflows/experimental/api');
for (const referencePreparation of ['auto', 'prepared'] as const) {
  const job: Job = { id: 'viggle-single-shot', title: 'Viggle single shot', status: 'queued', settings: { ...defaults, engine: 'viggle', referencePreparation, prompt: defaultVigglePrompt, seconds: 5, fps: 24 }, sourceId: '', referenceId: '',
    createdAt: '', favorite: false, deleted: false, width: 480, height: 864, progress: { stage: 'Queued', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 120, updatedAt: 0 }, segments: [], context: '', pendingPrompt: null,
    uploads: { source: 'source.mp4', reference: referencePreparation === 'auto' ? 'reference.png' : 'repainted-source-frame.png' }, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
  writeFileSync(path.join(directory, `viggle_int8_${referencePreparation}_swap.json`), JSON.stringify(compileViggleWorkflow(job), null, 2) + '\n');
}
