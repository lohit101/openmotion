// Same 17k+5 frame grid and five-frame anchors as the pinned Viggle node pack.
// The last window is end-aligned, so its overlap may exceed five frames. Only
// new frames are accepted; earlier completed output is never overwritten.
export const VIGGLE_WINDOW = 124;
export const VIGGLE_ANCHOR = 5;
export interface VideoWindow { skip: number; cap: number; overlap: number; }

export function viggleWindows(target: number): VideoWindow[] {
  if (!Number.isInteger(target) || target < 5 || target > 720) throw new Error('Choose 5–720 frames for Viggle (up to 30 seconds at 24 fps).');
  if (target <= VIGGLE_WINDOW) return [{ skip: 0, cap: target, overlap: 0 }];
  const padded = target + ((5 - target) % 17 + 17) % 17;
  const last = padded - VIGGLE_WINDOW, starts: number[] = [];
  for (let skip = 0; skip <= last; skip += VIGGLE_WINDOW - VIGGLE_ANCHOR) starts.push(skip);
  if (starts.at(-1) !== last) starts.push(last);
  let completed = 0;
  return starts.map(skip => {
    const cap = Math.min(VIGGLE_WINDOW, target - skip), overlap = completed - skip;
    completed = skip + cap;
    return { skip, cap, overlap };
  });
}

export function viggleWindow(completed: number, target: number): VideoWindow {
  const window = viggleWindows(target).find(plan => plan.skip + plan.overlap === completed);
  if (!window) throw new Error('Saved Viggle progress does not match its segment plan. Existing output has been kept.');
  return window;
}
