import type { Job } from './types';
import { anchorProgress } from './anchored-video';

export function nativeProgress(job: Job): number | null {
  const { value, max } = job.progress;
  return value !== null && max !== null && Number.isFinite(value) && Number.isFinite(max) && max > 0 ? Math.min(1, Math.max(0, value / max)) : null;
}

export const outputReady = (job?: Job): boolean => job?.status === 'completed' && !!job.output;

function preparation(job: Job): number {
  const stage = job.progress.stage.toLowerCase();
  if (/transferring.*inputs/.test(stage)) return 2 + 3 * (nativeProgress(job) || 0);
  if (/matching character|preparing target|preparing your clip/.test(stage)) return 1;
  return 0;
}

function videoProgress(job: Job): number {
  const { progress: p } = job, stage = p.stage.toLowerCase(), ratio = nativeProgress(job) || 0;
  const face = job.facialConsistency;
  if (face && p.completedFrames >= p.targetFrames && p.targetFrames > 0) {
    if (face.state === 'complete') return /checking subject/.test(stage) ? 99 : 98;
    if (face.state === 'downloaded') return 98;
    if (face.state === 'saving') return 96 + ratio;
    if (face.state === 'processing') return 80 + 16 * Math.min(1, (face.workUnits?.completed ?? face.processedFrames) / Math.max(1, face.workUnits?.total ?? face.frames));
    return /assembling/.test(stage) ? 76 : 78;
  }
  const count = Math.max(1, p.segments), saved = Math.min(count, job.segments.length);
  if (p.completedFrames >= p.targetFrames && p.targetFrames > 0) {
    return /checking subject/.test(stage) ? 98 : /assembling/.test(stage) ? 94 : 90;
  }
  const index = Math.max(0, Math.min(count - 1, p.segment - 1));
  if (saved > index) return 5 + 85 * saved / count;
  let phase = 0;
  // Fixed work budgets are estimates, not elapsed-time or invented frame counts.
  // Each window retains space for decode, export and both saved transfers.
  if (job.viggleRepaint?.activePhotoId) {
    const photo = job.viggleRepaint.photoProgress;
    phase = .02 + .1 * (photo?.max && photo.value !== null ? Math.max(0, Math.min(1, photo.value / photo.max)) : 0);
  }
  else if (/backing up continuity|saving continuation anchor/.test(stage)) phase = .975 + .025 * ratio;
  else if (/downloading completed segment/.test(stage)) phase = .94 + .035 * ratio;
  else if (p.node === '43') phase = .2 + .55 * ratio;
  else if (p.node === '44') phase = .75 + .12 * ratio;
  else if (p.node === '45' || p.node === '52') phase = .88;
  else if (p.node === '46') phase = .9 + .04 * ratio;
  else if (p.node === '47') phase = .94;
  else if (p.node === '118') phase = .04 + .1 * ratio;
  else if (p.node === '119' || p.node === '120') phase = .14;
  else if (p.node === '40' || p.node === '36') phase = .16;
  else if (p.node === '9' || p.node === '10') phase = .04 + .1 * ratio;
  else if (p.node !== null) phase = .02;
  const gpuStarted = p.node !== null || /checking workflow|waiting for gpu|starting gpu|completed segment|continuation/.test(stage) || saved > 0;
  return gpuStarted ? 5 + 85 * (Math.max(saved, index) + phase) / count : preparation(job);
}

function imagePasses(job: Job): { node: string; decoded: string[]; steps: number }[] {
  const s = job.image!.settings;
  const body = (steps: number) => ({ node: '118', decoded: ['119', '120', '154', '155'], steps });
  const head = (steps: number) => ({ node: '218', decoded: ['219', '220', '221', '222', '224'], steps });
  const lighting = { node: '318', decoded: ['319', '320', '322'], steps: 25 };
  const reference = { node: '502', decoded: ['503', '504', '505', '506'], steps: 30 };
  if (s.model !== 'qwen21') return [body(4), ...(s.identityRefine ? [head(4)] : [])];
  if (s.qwenRecipe === 'body-only') return ['body-only-v5', 'body-only-v6'].includes(job.image?.version || '') ? [...(job.image!.reusedBody ? [] : [body(s.qwenQuality === 'fast' ? 8 : 40)]), head(20)] : ['body-only-v3', 'body-only-v4'].includes(job.image?.version || '') ? [body(20), { node: '318', decoded: ['319', '320', '325'], steps: 25 }, head(20)] : [body(s.qwenQuality === 'fast' ? 8 : 40)];
  if (s.qwenRecipe === 'body-identity') return [...(s.qwenNormalizeReference ? [reference] : []), body(20), head(20), ...(s.qwenRelight ? [lighting] : [])];
  if (s.qwenRecipe === 'identity-first') return [head(20), body(25), ...(s.qwenRelight ? [lighting] : [])];
  if (s.qwenRecipe === 'source-anchored') {
    const steps = s.qwenQuality === 'quality' ? 20 : 8;
    return [...(s.qwenNormalizeReference ? [reference] : []), body(steps), ...(s.qwenHeadRefine ? [head(steps)] : []), ...(s.qwenRelight ? [lighting] : [])];
  }
  if (s.qwenRecipe === 'native-masked' || s.qwenRecipe === 'native-scene') return [body(25), ...(s.qwenHeadRefine ? [head(20)] : [])];
  return [body(8)];
}

function imageProgress(job: Job): number {
  const p = job.progress, stage = p.stage.toLowerCase();
  if (p.completedFrames >= p.targetFrames && p.targetFrames > 0) return /preserving scene/.test(stage) ? 97 : 94;
  if (/saving the completed replacement image/.test(stage)) return 92;
  if (['46', '130', '131', '324'].includes(p.node || '')) return 90;
  const passes = imagePasses(job), total = passes.reduce((sum, pass) => sum + pass.steps, 0);
  let completed = 0;
  for (const pass of passes) {
    if (p.node === pass.node) return 5 + 85 * (completed + pass.steps * (nativeProgress(job) || 0)) / total;
    completed += pass.steps;
    if (pass.decoded.includes(p.node || '')) return 5 + 85 * completed / total;
  }
  return p.node !== null || /checking workflow|waiting for gpu|starting gpu/.test(stage) ? 5 : preparation(job);
}

/** Weighted completion estimate; a high-water mark in the view prevents resets. */
export function overallProgressEstimate(job: Job): number {
  if (job.upscale) return outputReady(job) ? 100 : Number.isFinite(job.upscale.progress) ? Math.min(99, Math.max(0, job.upscale.progress)) : 0;
  if (outputReady(job)) return 100;
  if (job.status === 'queued' && !job.segments.length && !job.anchoredVideo?.branches.some(b => b.progress > 0)) return 0;
  if (job.anchoredVideo && job.anchoredVideo.state !== 'assembled') return anchorProgress(job);
  const raw = job.mediaType === 'image' && job.image ? imageProgress(job) : videoProgress(job);
  const estimate = job.facialConsistency && job.progress.completedFrames < job.progress.targetFrames ? raw * .82 : raw;
  return Number.isFinite(estimate) ? Math.min(99, Math.max(0, estimate)) : 0;
}

export function retainOverallProgress(previous: number, job: Job): number {
  if (outputReady(job)) return 100;
  const saved = Number.isFinite(previous) ? Math.min(99, Math.max(0, previous)) : 0;
  if (['failed', 'cancelled', 'interrupted', 'reconnecting'].includes(job.status)) return saved;
  return Math.max(saved, overallProgressEstimate(job));
}
