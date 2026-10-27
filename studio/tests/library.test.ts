import { describe, expect, it } from 'vitest';
import { libraryJobs, recordedSampling, runSummary, savedRunSettings } from '../shared/library';
import { defaults, type Job } from '../shared/types';
import { imageDefaults, imageGeometry } from '../shared/image-replacement';

function job(id: string, image: boolean, favorite: boolean, deleted = false): Job {
  return { id, title: id, status: 'completed', sourceId: 'source', referenceId: 'reference', settings: { ...defaults, prompt: 'Video prompt', seed: 123 }, createdAt: `2026-10-2${id}`, favorite, deleted, width: 720, height: 1280, progress: { stage: 'Completed', node: null, value: 1, max: 1, unit: 'image', segment: 1, segments: 1, completedFrames: 1, targetFrames: 1, updatedAt: 0 }, segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: 'ready', poster: 'ready', cancelRequested: false, elapsedSeconds: Number(id), origin: 'render', workflow: null, ...(image ? { mediaType: 'image', image: { settings: { ...imageDefaults, model: 'qwen21', prompt: 'Photo prompt', seed: 456 }, geometry: imageGeometry({ width: 720, height: 1280 }, 2, 'qwen21'), maskId: null, faceId: null } } : {}) };
}
describe('independent mixed media library', () => {
  it('applies photo/video filters to library and favourites without leaking trashed media', () => {
    const jobs = [job('1', true, true), job('2', false, true), job('3', true, false), job('4', false, true, true)];
    expect(libraryJobs(jobs, 'all', 'all', '', 'newest').map(j => j.id)).toEqual(['3', '2', '1']);
    expect(libraryJobs(jobs, 'favorites', 'all', '', 'oldest').map(j => j.id)).toEqual(['1', '2']);
    expect(libraryJobs(jobs, 'favorites', 'image', '', 'newest').map(j => j.id)).toEqual(['1']);
    expect(libraryJobs(jobs, 'favorites', 'video', '', 'newest').map(j => j.id)).toEqual(['2']);
    expect(libraryJobs(jobs, 'trash', 'all', '', 'newest').map(j => j.id)).toEqual(['4']);
    expect(jobs.map(j => j.id)).toEqual(['1', '2', '3', '4']);
  });
  it('searches the actual image prompt and puts unknown run times last in either order', () => {
    const photo = job('1', true, false), video = job('2', false, false); video.elapsedSeconds = null;
    expect(libraryJobs([photo, video], 'all', 'all', 'photo prompt', 'newest')).toEqual([photo]);
    expect(libraryJobs([video, photo], 'all', 'all', '', 'slowest').map(j => j.id)).toEqual(['1', '2']);
    expect(libraryJobs([video, photo], 'all', 'all', '', 'fastest').map(j => j.id)).toEqual(['1', '2']);
    expect(savedRunSettings(photo)).toMatchObject({ prompt: 'Photo prompt', seed: 456 });
    expect(runSummary(photo).find(([key]) => key === 'Model')?.[1]).toBe('Qwen Image 2.1');
    expect(runSummary(photo).some(([key]) => key === 'Frame rate')).toBe(false);
  });
  it('reads sampling only from recorded graph values, without invented defaults', () => {
    expect(recordedSampling({ '1': { class_type: 'KSampler', _meta: { title: 'Body pass' }, inputs: { steps: 20, cfg: 1, sampler_name: 'euler', model: ['2', 0] } }, '2': { class_type: 'Loader', inputs: { model: 'Qwen' } } })).toEqual([{ id: '1', title: 'Body pass', values: [['Steps', '20'], ['CFG', '1'], ['Sampler name', 'euler']] }]);
  });
});
