import { WarningCircle } from '@phosphor-icons/react';
import type { Job } from '../shared/types';
import { framingNotice } from '../shared/framing-status';

export default function FramingNotice({ job, onCompare }: { job: Job; onCompare?: () => void }) {
  const notice = framingNotice(job); if (!notice) return null;
  return <div className="framing-notice" role="status" aria-label="Framing review">
    <WarningCircle size={18} /><div><strong>{notice.title}</strong><p>{notice.message}</p></div>
    {onCompare && <button onClick={onCompare}>Compare source</button>}
  </div>;
}
