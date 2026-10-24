import type { Job } from './types';

export type FramingStatusJob = Pick<Job, 'id' | 'status' | 'settings' | 'framingCheck'>;
export interface FramingNoticeData { title: string; message: string; badge: string; }

export function framingNotice(job: FramingStatusJob): FramingNoticeData | null {
  if (job.status !== 'completed' || job.settings.mode !== 'swap' || job.framingCheck?.status === 'matched') return null;
  const warning = job.framingCheck?.warnings.find(value => value.trim())?.trim();
  if (job.framingCheck?.status === 'warning') return {
    title: 'Framing needs review', badge: 'Review framing',
    message: warning || 'The subject’s size or position differs from the source. Your video is saved; compare it with the original.',
  };
  return {
    title: 'Framing not verified', badge: 'Framing unchecked',
    message: warning || 'Your video is saved. Compare the subject’s size and position with the source before using this render.',
  };
}

// Initial library notices stay visible inline without producing a toast storm
// on reload. New completed checks notify once per status; a later warning can
// replace an earlier unverified notice under the same toast identity.
export class FramingWarningTracker {
  private initialized = false;
  private seen = new Set<string>();
  collect(jobs: FramingStatusJob[]): (FramingNoticeData & { jobId: string })[] {
    const notices: (FramingNoticeData & { jobId: string })[] = [];
    for (const job of jobs) {
      const status = job.framingCheck?.status;
      if (status !== 'warning' && status !== 'unverified') continue;
      const key = `${job.id}:${status}`;
      const notice = framingNotice(job); if (!notice || this.seen.has(key)) continue;
      this.seen.add(key);
      if (this.initialized) notices.push({ ...notice, jobId: job.id });
    }
    this.initialized = true;
    return notices;
  }
}
