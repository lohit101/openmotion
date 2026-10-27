import { describe, expect, it } from 'vitest';
import { clipFrameCount, clipTime, frameFloor, normalizeClip, trimClip } from '../shared/clip';

describe('five-second clip selection', () => {
  it('bounds imported drafts and short videos without creating invalid source ranges', () => {
    expect(normalizeClip({ start: 19, seconds: 30 }, 20, 24)).toEqual({ start: 15, seconds: 5 });
    expect(normalizeClip({ start: 0, seconds: 5 }, 2.1, 24)).toEqual({ start: 0, seconds: 50 / 24 });
    expect(normalizeClip({ start: 0, seconds: 5 }, .1, 24)).toBeNull();
    expect(normalizeClip({ start: NaN, seconds: 5 }, 10, 24)).toBeNull();
  });
  it('moves the entire window but cannot exceed five seconds or the source end', () => {
    const clip = { start: 3, seconds: 5 };
    expect(trimClip(clip, 'move', 99, 10, 24)).toEqual({ start: 5, seconds: 5 });
    expect(trimClip(clip, 'end', 10, 10, 24)).toEqual(clip);
    expect(trimClip(clip, 'start', 0, 10, 24)).toEqual(clip);
    const shorter = trimClip(clip, 'start', 4, 10, 24);
    expect(shorter).toEqual({ start: 4, seconds: 4 });
    expect(trimClip(shorter, 'end', 99, 10, 24)).toEqual({ start: 4, seconds: 5 });
  });
  it('preserves exact frame boundaries through repeated edits and frame-rate changes', () => {
    for (const fps of [16, 24, 30]) for (const duration of [.5, 3.17, 10, 200]) {
      let selection = normalizeClip({ start: duration / 2, seconds: 5 }, duration, fps)!;
      for (const action of ['move', 'start', 'end'] as const) for (const point of [-1, 0, .29, duration / 2, duration, duration + 10]) {
        selection = trimClip(selection, action, point, duration, fps);
        expect(selection.start).toBeGreaterThanOrEqual(0);
        expect(selection.seconds).toBeLessThanOrEqual(5);
        expect(selection.start + selection.seconds).toBeLessThanOrEqual(duration + 1e-7);
        expect(selection.seconds * fps).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(frameFloor(selection.start, fps)).toBe(Math.round(selection.start * fps));
      }
    }
    expect(clipTime(59.999)).toBe('1:00.00');
    for (const fps of [16, 24, 30]) for (let frames = 5; frames <= fps * 5; frames++) expect(clipFrameCount(frames / fps, fps)).toBe(frames);
  });
});
