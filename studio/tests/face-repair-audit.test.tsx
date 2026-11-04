import { describe, expect, it } from 'vitest';
import type { Job } from '../shared/types';
import { normalizeRepairRanges } from '../shared/face-repair';
import { repairSelectionRangeIndex, resolveRepairAttempt } from '../shared/face-repair-ui';

type ViewJob = Pick<Job, 'id' | 'faceRepair'>;
const saved = (id: string): ViewJob => ({ id, faceRepair: { state: 'review' } as NonNullable<Job['faceRepair']> });

describe('repair review state regression audit', () => {
  it('can start a new draft from an opened saved repair instead of restoring the same attempt', () => {
    const opened = saved('opened-repair');
    expect(resolveRepairAttempt(opened, [opened], [opened], opened.id)).toBe(opened);
    expect(resolveRepairAttempt(opened, [opened], [opened], null)).toBeNull();
  });

  it('does not substitute an unrelated opened attempt when a selected attempt is absent', () => {
    const opened = saved('first');
    expect(resolveRepairAttempt(opened, [opened], [opened], 'missing-second')).toBeNull();
  });

  it('uses the exact selected attempt and supports a just-created result before global jobs arrive', () => {
    const original: ViewJob = { id: 'original' }, first = saved('first'), second = saved('second');
    const jobs = [original, first], attempts = [second, first];
    expect(resolveRepairAttempt(original, jobs, attempts, 'second')).toBe(second);
    expect(resolveRepairAttempt(original, jobs, [], 'first')).toBe(first);
    expect(jobs).toEqual([original, first]);
    expect(attempts).toEqual([second, first]);
  });

  it('can initially review the opened repair while its parent and attempt list load', () => {
    const opened = saved('opened');
    expect(resolveRepairAttempt(opened, [], [], 'opened')).toBe(opened);
    expect(resolveRepairAttempt({ id: 'original' }, [], [], 'original')).toBeNull();
  });
});

describe('loop membership follows normalized source time, not row order', () => {
  it('maps unsorted visible selections to the correct chronological loop', () => {
    const late = { startFrame: 110, endFrame: 134 }, early = { startFrame: 55, endFrame: 79 };
    const ranges = normalizeRepairRanges([late, early], 240, 24);
    expect(repairSelectionRangeIndex(late, ranges)).toBe(1);
    expect(repairSelectionRangeIndex(early, ranges)).toBe(0);
  });

  it('maps overlapping selections to the same single merged repair loop', () => {
    const a = { startFrame: 40, endFrame: 70 }, b = { startFrame: 60, endFrame: 90 };
    const ranges = normalizeRepairRanges([a, b], 240, 24);
    expect(ranges).toHaveLength(1);
    expect(repairSelectionRangeIndex(a, ranges)).toBe(0);
    expect(repairSelectionRangeIndex(b, ranges)).toBe(0);
    expect(repairSelectionRangeIndex({ startFrame: 39, endFrame: 41 }, ranges)).toBe(-1);
  });

  it('keeps distinct selected intervals distinct even when their blend handles overlap', () => {
    const a = { startFrame: 20, endFrame: 21 }, b = { startFrame: 23, endFrame: 24 };
    const ranges = normalizeRepairRanges([a, b], 240, 24);
    expect(ranges[0]!.editableEndFrame).toBeGreaterThan(ranges[1]!.editableStartFrame);
    expect(repairSelectionRangeIndex(a, ranges)).toBe(0);
    expect(repairSelectionRangeIndex(b, ranges)).toBe(1);
  });
});
