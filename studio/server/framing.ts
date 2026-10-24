import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { command } from './media';
import type { FramingCheck, Job, ReferenceFraming } from '../shared/types';

export const FRAMING_VERSION = 'face-v1' as const;
export interface ReferenceGeometry {
  prepare(job: Job, source: string, reference: string, folder: string, signal: AbortSignal): Promise<{ file: string; summary: ReferenceFraming }>;
  check(job: Job, source: string, output: string, folder: string, signal: AbortSignal): Promise<FramingCheck>;
}

const preparationSchema = z.object({
  version: z.literal(FRAMING_VERSION), status: z.literal('aligned'), width: z.number().int().positive(), height: z.number().int().positive(),
  anchorFrame: z.number().int().nonnegative(), scale: z.number().positive().finite(), translateX: z.number().finite(), translateY: z.number().finite(),
  preparedSha256: z.string().regex(/^[0-9a-f]{64}$/), warnings: z.array(z.string()).default([]),
});
const checkSchema = z.object({ status: z.enum(['matched', 'warning', 'unverified']), warnings: z.array(z.string()), samples: z.array(z.record(z.string(), z.unknown())) });
const sha256 = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
export const exists = (file: string) => access(file).then(() => true, () => false);

export function localReferenceGeometry(repo: string): ReferenceGeometry {
  const python = path.join(repo, '.local/geometry-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const model = path.join(repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx');
  const script = path.join(repo, 'scripts/reference_geometry.py');
  const prerequisites = async () => {
    if (!(await exists(python)) || !(await exists(model))) throw new Error('Local reference framing is not ready. Run bash scripts/studio.sh once before generating. No GPU generation was submitted.');
  };
  return {
    async prepare(job, source, reference, folder, signal) {
      await prerequisites();
      if (job.settings.objectIndices.split(',').map(v => Number(v.trim())).some(v => v !== 0) || job.settings.objectIndices.includes(',')) throw new Error('Source framing currently requires one unambiguous person at index 0. Choose a single-person shot. No GPU generation was submitted.');
      const file = path.join(folder, 'aligned-reference.png'), reportFile = path.join(folder, 'reference-framing.json');
      if (await exists(reportFile)) {
        try {
          const report = JSON.parse(await readFile(reportFile, 'utf8'));
          const summary = preparationSchema.parse(report);
          if (summary.width !== job.width || summary.height !== job.height || report.sourceSha256 !== await sha256(source) || report.referenceSha256 !== await sha256(reference) || summary.preparedSha256 !== await sha256(file)) throw new Error('Changed reference framing');
          return { file, summary };
        } catch {
          throw new Error('The saved reference framing is missing or no longer matches this job. Reuse settings to start a new job; an existing reference will not be silently changed. No GPU generation was submitted.');
        }
      }
      try {
        const output = await command(python, [script, 'prepare', '--source', source, '--reference', reference, '--output', file, '--report', reportFile, '--model', model], signal, 90000);
        const summary = preparationSchema.parse(JSON.parse(output));
        if (summary.width !== job.width || summary.height !== job.height) throw new Error('Prepared reference dimensions do not match the source canvas.');
        return { file, summary };
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(`Reference framing could not be prepared. ${error instanceof Error ? error.message : String(error)} No GPU generation was submitted.`);
      }
    },
    async check(_job, source, output, folder, signal) {
      await prerequisites();
      const result = await command(python, [script, 'check', '--source', source, '--output-video', output, '--report', path.join(folder, 'framing-check.json'), '--model', model], signal, 90000);
      return checkSchema.parse(JSON.parse(result));
    },
  };
}
