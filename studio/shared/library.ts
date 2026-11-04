import { isImageJob } from './image-replacement';
import { engineLabel } from './engines';
import { outputDimensions, type Graph, type Job } from './types';

export type LibraryCollection = 'all' | 'favorites' | 'trash';
export type LibraryMedia = 'all' | 'image' | 'video';
export type LibrarySort = 'newest' | 'oldest' | 'name' | 'fastest' | 'slowest';
export function libraryJobs(jobs: Job[], collection: LibraryCollection, media: LibraryMedia, query: string, sort: LibrarySort) {
  const search = query.trim().toLocaleLowerCase();
  return jobs.filter(job => !job.anchorChild && (collection === 'trash' ? job.deleted : !job.deleted && (collection !== 'favorites' || job.favorite))
    && (media === 'all' || (isImageJob(job) ? 'image' : 'video') === media)
    && (!search || `${job.title} ${job.image?.settings.prompt || job.settings.prompt || ''}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title, undefined, { numeric: true }) || a.id.localeCompare(b.id);
      if (sort === 'fastest' || sort === 'slowest') {
        if (a.elapsedSeconds == null || b.elapsedSeconds == null) return a.elapsedSeconds == null ? b.elapsedSeconds == null ? 0 : 1 : -1;
        return (a.elapsedSeconds - b.elapsedSeconds) * (sort === 'fastest' ? 1 : -1) || b.createdAt.localeCompare(a.createdAt);
      }
      return a.createdAt.localeCompare(b.createdAt) * (sort === 'oldest' ? 1 : -1) || a.id.localeCompare(b.id);
    });
}

export function savedRunSettings(job: Job): Record<string, unknown> {
  if (job.kie) return { provider: job.kie.provider, model: job.kie.model, ...job.kie.settings, taskId: job.kie.taskId, output: job.kie.output, creditsConsumed: job.kie.creditsConsumed };
  if (job.upscale) return { model: job.upscale.model, ...job.upscale.settings, source: job.upscale.source, fps: job.upscale.fps, frames: job.upscale.frames, sourceSHA256: job.upscale.sourceSHA256, profileSHA256: job.upscale.profileSHA256, attention: job.upscale.attention, workerSeconds: job.upscale.workerSeconds, processingGeometry: job.upscale.processingGeometry, workerTotalSeconds: job.upscale.workerTotalSeconds, phaseSeconds: job.upscale.phaseSeconds, execution: job.upscale.execution };
  if (job.faceRefinement) return { processing: job.faceRefinement.execution==='remote CUDA'?'GPU face refinement':'Local face refinement', model: 'Hyperswap 1a 256', execution: job.faceRefinement.execution, method:job.faceRefinement.method||'direct',performanceFrames:job.faceRefinement.performanceFrames,fallbackFrames:job.faceRefinement.fallbackFrames, parentJobId: job.faceRefinement.parentJobId, fps: job.settings.fps, frames: job.progress.targetFrames, refinedFrames: job.faceRefinement.refinedFrames, skippedFrames: job.faceRefinement.skippedFrames };
  if (job.edit) return { exportMode: job.edit.mode, processing: job.edit.method, format: job.edit.format, videoCodec: job.edit.videoCodec, width: job.edit.width, height: job.edit.height, fps: job.edit.fps, frames: job.edit.frames, duration: job.edit.duration, sourceClips: job.edit.sources.length };
  return { ...(isImageJob(job) ? job.image?.settings || {} : job.settings) };
}
export const jobDuration = (job: Job): number => job.kie ? job.kie.output?.duration ?? job.kie.settings.seconds : job.edit?.duration ?? job.progress.targetFrames / job.settings.fps;
export function runSummary(job: Job): [string, string][] {
  const [width, height] = outputDimensions(job);
  if (job.kie) return [['Provider', 'Kie.ai'], ['Model', 'Wan 3.0'], ['Quality', job.kie.settings.resolution.toLowerCase()], ['Output', job.kie.output ? `${job.kie.output.width} × ${job.kie.output.height}` : 'Pending'], ['Status', job.status], ['Duration', `${jobDuration(job).toFixed(2)}s`], ...(job.kie.output ? [['Frame rate', `${job.kie.output.fps} fps`] as [string, string]] : []), ['Audio', job.kie.output?.audio === 'none' ? 'No audio track' : job.kie.settings.keepSourceAudio ? 'Original source audio' : 'Wan-generated audio'], ...(job.kie.creditsConsumed !== undefined ? [['Provider credits', String(job.kie.creditsConsumed)] as [string, string]] : [])];
  if (job.upscale) return [['Workflow', 'Clarity · Video upscaling'], ['Model', job.upscale.model], ['Processing', job.upscale.settings.processing==='fast1080'?'Fast 1080p · AI at 720p':'Native output resolution'], ['Output', `${width} × ${height}`], ['Status', job.status], ['Frame rate', `${job.upscale.fps} fps`], ['Frames', String(job.upscale.frames)], ['Original', 'Preserved'], ...(job.upscale.workerSeconds != null ? [['Upscaler processing', `${job.upscale.workerSeconds.toFixed(1)} seconds`] as [string,string]] : [])];
  if (job.faceRefinement) return [['Workflow', job.faceRefinement.execution==='remote CUDA'?'GPU face refinement':'Local face refinement'], ['Output', `${width} × ${height}`], ['Status', job.status], ['Frame rate', `${job.settings.fps} fps`], ['Duration', `${(job.progress.targetFrames/job.settings.fps).toFixed(2)}s`], ['Refined frames', String(job.faceRefinement.refinedFrames ?? 'In progress')], ['Unmodified face frames', String(job.faceRefinement.skippedFrames ?? 'In progress')], ...(job.elapsedSeconds!=null ? [[job.faceRefinement.execution==='remote CUDA'?'GPU processing':'Local processing', `${job.elapsedSeconds.toFixed(1)} seconds`] as [string,string]] : [])];
  if (job.edit) return [['Workflow', 'Local clip edit'], ['Output', `${width} × ${height}`], ['Status', job.status], ['Duration', `${job.edit.duration.toFixed(2)}s`], ['Frame rate', `${job.edit.fps} fps`], ['Export', job.edit.method === 'stream-copy' ? 'Original streams · no re-encoding' : job.edit.format === 'mkv' ? 'Lossless FFV1 master · MP4 preview' : 'High-quality H.264 MP4'], ['Source clips', String(job.edit.sources.length)], ...(job.elapsedSeconds != null ? [['Local export time', `${job.elapsedSeconds.toFixed(1)} seconds`] as [string, string]] : [])];
  const model = isImageJob(job) ? job.image?.settings.model === 'qwen21' ? 'Qwen Image 2.1' : job.image?.settings.model === 'klein4b' ? 'FLUX.2 Klein 4B' : 'Not recorded' : engineLabel(job.settings);
  const summary: [string, string][] = [['Model', model], ['Output', `${width} × ${height}`], ['Status', job.status], ['Seed', String(job.image?.settings.seed ?? job.settings.seed ?? 'Not recorded')]];
  if (!isImageJob(job)) summary.push(['Frame rate', `${job.settings.fps} fps`], ['Selected clip', `${job.settings.start.toFixed(2)}s → ${(job.settings.start + job.settings.seconds).toFixed(2)}s`]);
  if (job.elapsedSeconds != null) summary.push([job.image?.localFraming ? 'Local adjustment' : 'Run time', `${job.elapsedSeconds.toFixed(job.elapsedSeconds < 10 ? 2 : 0)} seconds`]);
  if (job.image?.version) summary.push(['Recipe', job.image.version]);
  return summary;
}

export function settingLabel(key: string) {
  const labels: Record<string, string> = { qwenRecipe: 'Replacement method', qwenQuality: 'Image sampling', qwenHeadRefine: 'Head refinement', localIdentity: 'Local identity anchor', megapixels: 'Working detail (MP)', qwenRelight: 'Match scene lighting', qwenNormalizeReference: 'Prepare reference', qwenSceneIntegration: 'Integrate scene edges', qwenBodyPose: 'Pose guidance', qwenLayoutOnly: 'Placement guide', qwenIdentityGuide: 'Identity guide', qwenEdgeOnly: 'Contours only', faceDetail: 'Face close-up', identityRefine: 'Identity refinement', structureStrength: 'Geometry strength', bodyPoseStrength: 'Pose strength', framesPerPass: 'Frames per pass', fps: 'Frame rate', loraA: 'LoRA A', loraB: 'LoRA B', loraAStrength: 'LoRA A strength', loraBStrength: 'LoRA B strength' };
  return labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
}

export function recordedSampling(graph: Graph) {
  return Object.entries(graph).flatMap(([id, node]) => {
    const fields = ['steps', 'cfg', 'guidance', 'sampler_name', 'scheduler', 'denoise', 'sigmas'];
    const values = fields.filter(key => node.inputs[key] != null && !Array.isArray(node.inputs[key]))
      .map(key => [settingLabel(key === 'cfg' ? 'CFG' : key.replace('_', ' ')), String(node.inputs[key])] as const);
    return values.length ? [{ id, title: node._meta?.title || node.class_type, values }] : [];
  });
}
