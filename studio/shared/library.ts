import { isImageJob } from './image-replacement';
import { engineLabel } from './engines';
import { outputDimensions, type Graph, type Job } from './types';

export type LibraryCollection = 'all' | 'favorites' | 'trash';
export type LibraryMedia = 'all' | 'image' | 'video';
export type LibrarySort = 'newest' | 'oldest' | 'name' | 'fastest' | 'slowest';
export function libraryJobs(jobs: Job[], collection: LibraryCollection, media: LibraryMedia, query: string, sort: LibrarySort) {
  const search = query.trim().toLocaleLowerCase();
  return jobs.filter(job => (collection === 'trash' ? job.deleted : !job.deleted && (collection !== 'favorites' || job.favorite))
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
  return { ...(isImageJob(job) ? job.image?.settings || {} : job.settings) };
}
export function runSummary(job: Job): [string, string][] {
  const [width, height] = outputDimensions(job);
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
