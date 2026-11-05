import { effectDuration, type EditorSource, type TimelineAudio, type TimelineClip } from '../shared/clip-editor';

// Numbers come from the validated draft, never user-authored FFmpeg expressions.
export function videoEffectFilters(input: string, output: string, clip: TimelineClip, source: EditorSource, width: number, height: number) {
  const duration = (clip.outFrame - clip.inFrame) / source.fps;
  const filters = [`${input}trim=start_frame=${clip.inFrame}:end_frame=${clip.outFrame},setpts=PTS-STARTPTS,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${output}base]`];
  const blurIn = effectDuration(clip.blurIn, duration), blurOut = effectDuration(clip.blurOut, duration);
  let current = `${output}base`;
  if (blurIn || blurOut) {
    const start = blurIn ? `max(0,1-T/${blurIn})` : '0', end = blurOut ? `max(0,(T-${duration - blurOut})/${blurOut})` : '0';
    const weight = `min(1,max(${start},${end}))`;
    filters.push(`[${current}]split=2[${output}clear][${output}blurbase]`, `[${output}blurbase]gblur=sigma=12:steps=2[${output}blur]`, `[${output}clear][${output}blur]blend=all_expr='A*(1-(${weight}))+B*(${weight})'[${output}mixed]`);
    current = `${output}mixed`;
  }
  const fadeIn = effectDuration(clip.fadeIn, duration), fadeOut = effectDuration(clip.fadeOut, duration);
  const fade = [fadeIn && `fade=t=in:st=0:d=${fadeIn}`, fadeOut && `fade=t=out:st=${duration - fadeOut}:d=${fadeOut}`].filter(Boolean);
  filters.push(`[${current}]${fade.length ? fade.join(',') : 'null'}[${output}]`);
  return filters;
}

export function audioEffectFilter(input: string, output: string, controls: Pick<TimelineClip, 'volume' | 'audioFadeIn' | 'audioFadeOut'>, inSeconds: number, outSeconds: number, start: number, duration: number) {
  const length = outSeconds - inSeconds;
  const fadeIn = effectDuration(controls.audioFadeIn, length), fadeOut = effectDuration(controls.audioFadeOut, length);
  return `${input}atrim=start=${inSeconds}:end=${outSeconds},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${length},atrim=duration=${length},volume=${controls.volume ?? 1}${fadeIn ? `,afade=t=in:st=0:d=${fadeIn}` : ''}${fadeOut ? `,afade=t=out:st=${length - fadeOut}:d=${fadeOut}` : ''},adelay=delays=${Math.round(start * 48000)}S:all=1,apad=whole_dur=${duration},atrim=duration=${duration}[${output}]`;
}

export const audible = (clip: Pick<TimelineAudio, 'muted' | 'volume'>) => !clip.muted && (clip.volume ?? 1) > 0;
