import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FramingNotice from '../src/FramingNotice';
import { framingNotice, FramingWarningTracker } from '../shared/framing-status';
import { defaults } from '../shared/types';
import type { Job, FramingCheck } from '../shared/types';

const job = (id: string, check?: FramingCheck, status: Job['status'] = 'completed') => ({ id, status, settings: defaults, framingCheck: check });
const warning: FramingCheck = { status: 'warning', warnings: ['The generated face is smaller than the source.'], samples: [] };

describe('framing review notices', () => {
  it('keeps a warning visible for completed output and distinguishes missing checks from a match', () => {
    const rendered = renderToStaticMarkup(<FramingNotice job={job('one', warning) as Job} onCompare={() => undefined} />);
    expect(rendered).toContain('Framing needs review'); expect(rendered).toContain(warning.warnings[0]);
    expect(rendered).toContain('Compare source'); expect(rendered).not.toContain('error');
    expect(framingNotice(job('unchecked'))?.badge).toBe('Framing unchecked');
    expect(framingNotice(job('matched', { status: 'matched', warnings: [], samples: [] }))).toBeNull();
    expect(framingNotice(job('running', warning, 'running'))).toBeNull();
    expect(framingNotice({ ...job('motion', warning), settings: { ...defaults, mode: 'motion' } })).toBeNull();
  });
  it('does not toast existing library warnings on reload, or repeat one job warning', () => {
    const tracker = new FramingWarningTracker();
    expect(tracker.collect([job('old', warning)])).toEqual([]);
    expect(tracker.collect([job('old', warning), job('new', warning, 'running')])).toEqual([]);
    expect(tracker.collect([job('old', warning), job('new', warning)])).toMatchObject([{ jobId: 'new', title: 'Framing needs review' }]);
    expect(tracker.collect([job('new', { ...warning, warnings: ['Updated measurement.'] })])).toEqual([]);
  });
  it('notifies when a check arrives after completion, without treating unchecked output as failure', () => {
    const tracker = new FramingWarningTracker();
    expect(tracker.collect([job('one')])).toEqual([]);
    expect(tracker.collect([job('one', { status: 'unverified', warnings: [], samples: [] })])).toMatchObject([{ jobId: 'one', title: 'Framing not verified' }]);
    expect(tracker.collect([job('one', { status: 'unverified', warnings: [], samples: [] })])).toEqual([]);
    expect(tracker.collect([job('one', warning)])).toHaveLength(1);
    expect(tracker.collect([job('one', warning)])).toEqual([]);
  });
});
