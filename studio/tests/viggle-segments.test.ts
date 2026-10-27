import { describe, expect, it } from 'vitest';
import { viggleWindow, viggleWindows } from '../shared/viggle-segments';
import { engineIssue, planForJob, referenceModeForRun } from '../shared/engines';
import { defaults, nextSegment, type Job } from '../shared/types';
import { compileViggleWorkflow } from '../server/viggle-workflow';

describe('Viggle continuation planning', () => {
  it('preserves the recorded appearance policy when reusing older paid settings', () => {
    expect(referenceModeForRun({ settings: defaults, viggleSegmentation: 'five-frame-v1' })).toBe('original');
    expect(referenceModeForRun({ settings: { ...defaults, viggleReferenceMode: 'original' }, viggleSegmentation: 'last-frame-v2' })).toBe('previous');
  });
  it('uses native phase-aligned windows, including a nearly fully overlapped ending', () => {
    expect(viggleWindows(125)).toEqual([{ skip: 0, cap: 124, overlap: 0 }, { skip: 17, cap: 108, overlap: 107 }]);
    expect(viggleWindows(240)).toEqual([{ skip: 0, cap: 124, overlap: 0 }, { skip: 119, cap: 121, overlap: 5 }]);
    expect(viggleWindows(720)).toHaveLength(7);
    expect(viggleWindows(720).at(-1)).toEqual({ skip: 612, cap: 108, overlap: 107 });
    expect(() => viggleWindows(721)).toThrow('30 seconds');
  });
  it('covers every permitted frame count exactly once and always anchors inside completed output', () => {
    for (let target = 5; target <= 720; target++) {
      let completed = 0, previousStart = 0;
      for (const plan of viggleWindows(target)) {
        expect(plan.skip % 17).toBe(0);
        expect(plan.skip + plan.overlap).toBe(completed);
        expect(plan.cap).toBeLessThanOrEqual(124);
        expect(plan.cap - plan.overlap).toBeGreaterThan(0);
        if (completed) {
          expect(plan.skip).toBeGreaterThanOrEqual(previousStart);
          expect(plan.skip + 5).toBeLessThanOrEqual(completed);
        }
        expect(viggleWindow(completed, target)).toEqual(plan);
        previousStart = plan.skip; completed += plan.cap - plan.overlap;
      }
      expect(completed).toBe(target);
    }
    expect(() => viggleWindow(81, 240)).toThrow('does not match');
  });
  it('requires an explicit saved version, preserving old single-shot and Wan recovery behavior', () => {
    const s = { ...defaults, engine: 'viggle' as const, seconds: 30 };
    expect(engineIssue(s)).toBeNull();
    expect(() => planForJob(s, 124, 720, nextSegment)).toThrow('cannot continue');
    expect(planForJob(s, 124, 720, nextSegment, 'five-frame-v1')).toEqual({ skip: 119, cap: 124, overlap: 5 });
    expect(planForJob(defaults, 81, 240, nextSegment)).toEqual(nextSegment(81, 240));
  });
  it('keeps one character frame and the same sampling recipe across bounded windows', () => {
    const job = { id: 'long-viggle', settings: { ...defaults, engine: 'viggle', referencePreparation: 'auto', seconds: 10 },
      viggleSegmentation: 'five-frame-v1', width: 480, height: 864, progress: { completedFrames: 0, targetFrames: 240 },
      segments: [], uploads: { source: 'clip.mp4', reference: 'identity.png' }, context: '' } as unknown as Job;
    const first = compileViggleWorkflow(job);
    expect(first['2'].inputs).toMatchObject({ frame_load_cap: 124, skip_first_frames: 0 });
    expect(first['47'].inputs.next_skip_frames).toBe(119);
    expect(first['47'].inputs.terminal).toBeUndefined();
    expect(first['118']).toBeDefined();
    job.progress.completedFrames = 124; job.segments = [{ file: 'segment_0000.mp4', frames: 124, promptId: 'paid-first', seconds: 1 }];
    expect(() => compileViggleWorkflow(job)).toThrow('anchor is missing');
    job.context = 'character_swap/viggle/anchor.safetensors';
    expect(() => compileViggleWorkflow(job)).toThrow('original repainted frame');
    job.uploads!.preparedFrame = 'same-repaint.png';
    const second = compileViggleWorkflow(job);
    expect(second['4'].inputs.image).toBe('same-repaint.png');
    expect(second['118']).toBeUndefined(); expect(second['102']).toBeUndefined();
    expect(second['36'].inputs).toMatchObject({ context_path: job.context, skip_frames: 119, overlap: 5, job_id: job.id });
    expect(second['43'].inputs.latent_image).toEqual(['36', 0]);
    expect(second['42'].inputs).toEqual(first['42'].inputs);
    expect(second['2'].inputs).toMatchObject({ frame_load_cap: 121, skip_first_frames: 119 });
    expect(second['45'].inputs.overlap).toBe(5);
    expect(second['46'].inputs.filename_prefix).toBe('recast/long-viggle/segment_0001');
    expect(second['47'].inputs.terminal).toBe(true);
    expect(second['38'].inputs.noise_seed).toBe(job.settings.seed + 1);
  });
  it('chains the actual previous frame as appearance while retaining the separate five-frame motion anchor', () => {
    expect(defaults.viggleReferenceMode).toBe('previous');
    const job = { id: 'chain-test', settings: { ...defaults, engine: 'viggle', referencePreparation: 'auto', seconds: 14.5 },
      viggleSegmentation: 'last-frame-v2', width: 480, height: 864, progress: { completedFrames: 124, targetFrames: 348 },
      segments: [{ file: 'segment_0000.mp4', frames: 124, promptId: 'paid', seconds: 1 }],
      uploads: { source: 'clip.mp4', reference: 'original.png' }, context: 'character_swap/viggle/previous.safetensors' } as unknown as Job;
    const graph = compileViggleWorkflow(job);
    expect(graph['4'].class_type).toBe('RecastViggleContextReference');
    expect(graph['4'].inputs).toMatchObject({ context_path: job.context, job_id: job.id, skip_frames: 119, overlap: 5 });
    expect(graph['4'].inputs.image).toBeUndefined(); expect(graph['121'].inputs.images).toEqual(['4', 0]);
    expect(graph['40'].inputs.ref_image).toEqual(['121', 0]);
    expect(graph['36'].inputs.context_version).toBe('last-frame-v2');
    expect(graph['43'].inputs.latent_image).toEqual(['36', 0]); expect(graph['47'].inputs.version).toBe('last-frame-v2');
    expect(graph['118']).toBeUndefined(); expect(graph['103']).toBeUndefined();
  });
});
