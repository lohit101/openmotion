import { describe, expect, it } from 'vitest';
import { clipFrameCount, clipTime, frameFloor, normalizeClip, trimClip } from '../shared/clip';

describe('thirty-second segmented clip selection', () => {
  it('bounds imported drafts and short videos without creating invalid source ranges', () => {
    expect(normalizeClip({ start: 49, seconds: 90 }, 50, 24)).toEqual({ start: 20, seconds: 30 });
    expect(normalizeClip({ start: 19, seconds: 30 }, 20, 24)).toEqual({ start: 0, seconds: 20 });
    expect(normalizeClip({ start: 0, seconds: 5 }, 2.1, 24)).toEqual({ start: 0, seconds: 50 / 24 });
    expect(normalizeClip({ start: 0, seconds: 5 }, .1, 24)).toBeNull();
    expect(normalizeClip({ start: NaN, seconds: 5 }, 10, 24)).toBeNull();
  });
  it('moves the entire window but cannot exceed thirty seconds or the source end', () => {
    const clip = { start: 3, seconds: 30 };
    expect(trimClip(clip, 'move', 99, 60, 24)).toEqual({ start: 30, seconds: 30 });
    expect(trimClip(clip, 'end', 60, 60, 24)).toEqual(clip);
    expect(trimClip(clip, 'start', 0, 60, 24)).toEqual(clip);
    const shorter = trimClip(clip, 'start', 4, 60, 24);
    expect(shorter).toEqual({ start: 4, seconds: 29 });
    expect(trimClip(shorter, 'end', 99, 60, 24)).toEqual({ start: 4, seconds: 30 });
  });
  it('preserves exact frame boundaries through repeated edits and frame-rate changes', () => {
    for (const fps of [16, 24, 30]) for (const duration of [.5, 3.17, 10, 200]) {
      let selection = normalizeClip({ start: duration / 2, seconds: 5 }, duration, fps)!;
      for (const action of ['move', 'start', 'end'] as const) for (const point of [-1, 0, .29, duration / 2, duration, duration + 10]) {
        selection = trimClip(selection, action, point, duration, fps);
        expect(selection.start).toBeGreaterThanOrEqual(0);
        expect(selection.seconds).toBeLessThanOrEqual(30);
        expect(selection.start + selection.seconds).toBeLessThanOrEqual(duration + 1e-7);
        expect(selection.seconds * fps).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(frameFloor(selection.start, fps)).toBe(Math.round(selection.start * fps));
      }
    }
    expect(clipTime(59.999)).toBe('1:00.00');
    for (const fps of [16, 24, 30]) for (let frames = 5; frames <= fps * 30; frames++) expect(clipFrameCount(frames / fps, fps)).toBe(frames);
  });
});
