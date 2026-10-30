/** Image-space cues only: a five-point nose offset is not a measured yaw angle. */
export interface SourceHeadLayout {
  version: 'source-head-layout-v1'; status: 'available' | 'unavailable'; reason?: string;
  bbox?: number[]; canvas?: number[]; rollDegrees?: number | null; noseOffset?: number | null;
}
export const hasSourceHeadLayout = (version?: string) => ['body-only-v8', 'body-only-single-v3'].includes(version || '');
export function sourceHeadLayoutPrompt(layout?: SourceHeadLayout): string {
  if (layout?.status !== 'available') return '';
  const cues: string[] = [];
  if (typeof layout.rollDegrees === 'number' && Math.abs(layout.rollDegrees) >= 6)
    cues.push(`Keep the source head tilt: its eye line ${layout.rollDegrees < 0 ? 'rises' : 'falls'} toward the right side of <image1>. Do not level the head.`);
  if (typeof layout.noseOffset === 'number' && Math.abs(layout.noseOffset) >= .18)
    cues.push(`Keep the source head turned toward the ${layout.noseOffset < 0 ? 'left' : 'right'} side of <image1>, with its existing foreshortening and visible ear. Do not turn it into a front-facing portrait.`);
  return cues.length ? '\nSource-frame layout: ' + cues.join(' ') : '';
}
