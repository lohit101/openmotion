import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localReferenceGeometry } from '../server/framing';
import { command } from '../server/media';
import { defaults } from '../shared/types';
import type { Job } from '../shared/types';

vi.mock('../server/media', () => ({ command: vi.fn() }));
const directories: string[] = [];
afterEach(async () => { vi.resetAllMocks(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'recast-framing-')); directories.push(repo);
  const python = path.join(repo, '.local/geometry-venv/bin/python'), model = path.join(repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx');
  for (const file of [python, model]) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'fixture'); }
  const folder = path.join(repo, 'jobs/one'); await mkdir(folder, { recursive: true });
  const source = path.join(folder, 'prepared-source.mp4'), reference = path.join(repo, 'original.jpg');
  await writeFile(source, 'source'); await writeFile(reference, 'reference');
  const report = { version: 'face-v1', status: 'aligned', width: 480, height: 864, anchorFrame: 0, scale: 2, translateX: 30, translateY: 40,
    sourceSha256: hash('source'), referenceSha256: hash('reference'), preparedSha256: hash('prepared image'), warnings: [] };
  vi.mocked(command).mockImplementation(async (_python, args) => {
    const option = (name: string) => args[args.indexOf(name) + 1];
    await writeFile(option('--output'), 'prepared image'); await writeFile(option('--report'), JSON.stringify(report)); return JSON.stringify(report);
  });
  const job = { settings: { ...defaults }, width: 480, height: 864 } as Job;
  return { repo, folder, source, reference, report, job, pipeline: localReferenceGeometry(repo) };
}

describe('immutable source-aligned references', () => {
  it('reuses an identical prepared reference and refuses changed inputs or a mutated aligned file', async () => {
    const f = await fixture(), signal = new AbortController().signal;
    const result = await f.pipeline.prepare(f.job, f.source, f.reference, f.folder, signal);
    expect(result.file).toBe(path.join(f.folder, 'aligned-reference.png')); expect(result.summary).toMatchObject({ scale: 2, width: 480 });
    expect(result.summary).not.toHaveProperty('sourceSha256');
    expect(await f.pipeline.prepare(f.job, f.source, f.reference, f.folder, signal)).toEqual(result); expect(command).toHaveBeenCalledOnce();
    for (const [file, changed, original] of [[f.source, 'changed source', 'source'], [f.reference, 'changed ref', 'reference'], [result.file, 'mutated pixels', 'prepared image']]) {
      await writeFile(file, changed);
      await expect(f.pipeline.prepare(f.job, f.source, f.reference, f.folder, signal)).rejects.toThrow('will not be silently changed');
      await writeFile(file, original);
    }
    expect(command).toHaveBeenCalledOnce(); expect(await readFile(f.reference, 'utf8')).toBe('reference');
  });
  it('fails before running the detector for multiple actor indices or missing local prerequisites', async () => {
    const f = await fixture(), signal = new AbortController().signal;
    for (const objectIndices of ['1', '0,1']) {
      await expect(f.pipeline.prepare({ ...f.job, settings: { ...defaults, objectIndices } }, f.source, f.reference, f.folder, signal)).rejects.toThrow('No GPU generation was submitted');
    }
    await rm(path.join(f.repo, '.local/geometry-models/face_detection_yunet_2023mar.onnx'));
    await expect(f.pipeline.prepare(f.job, f.source, f.reference, f.folder, signal)).rejects.toThrow('scripts/studio.sh'); expect(command).not.toHaveBeenCalled();
  });
  it('passes detector errors through as pre-submission failures and parses output drift without retrying', async () => {
    const f = await fixture(), signal = new AbortController().signal;
    vi.mocked(command).mockRejectedValueOnce(new Error('More than one face'));
    await expect(f.pipeline.prepare(f.job, f.source, f.reference, f.folder, signal)).rejects.toThrow('No GPU generation was submitted');
    const quality = { status: 'warning', warnings: ['Head scale 0.6x'], samples: [{ headScale: 0.6, centerOffsetX: -0.15 }] };
    vi.mocked(command).mockResolvedValueOnce(JSON.stringify(quality));
    expect(await f.pipeline.check(f.job, f.source, '/local/final.mp4', f.folder, signal)).toEqual(quality);
    expect(command).toHaveBeenCalledTimes(2); expect(vi.mocked(command).mock.calls[1][1]).toContain('--output-video');
  });
});
