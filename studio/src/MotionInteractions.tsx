import { Toggle } from './components';
import { incomingInteractionIssue } from '../shared/motion-interactions';
import type { OpenjutsuSettings } from '../shared/openjutsu';

export default function MotionInteractions({ settings, seconds, change, shorten }: {
  settings: OpenjutsuSettings; seconds: number; change: (enabled: boolean) => void; shorten: () => void;
}) {
  if (!settings.referenceScene) return null;
  const enabled = settings.interactionGuide === 'aligned-interactions-v1';
  const issue = incomingInteractionIssue(settings, seconds), limit = Math.min(5, settings.clipSeconds);
  return <div className="oj-interactions">
    <Toggle label="Keep incoming hands & objects" checked={enabled} onChange={change}
      detailVisible detail="Uses the complete source performance with the Motion Transfer adapter. Helps preserve incoming hands, objects and contact while using your character’s setting. Requires lip-sync enabled." />
    {enabled && <p className="oj-scene-note">Improved guide · up to {limit}s per video for now. Identity and hair can still vary after turns or occlusion.</p>}
    {issue && <div className="oj-interaction-warning" role="status"><p>{issue}</p>
      {seconds > limit ? <button type="button" className="secondary-button" onClick={shorten}>Use {limit}s from current start</button>
        : <button type="button" className="secondary-button" onClick={() => change(true)}>Restore interaction guide</button>}
    </div>}
  </div>;
}
