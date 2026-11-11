import { Toggle } from './components';
import { incomingInteractionIssue } from '../shared/motion-interactions';
import type { OpenjutsuSettings } from '../shared/openjutsu';

export default function MotionInteractions({ settings, seconds, change, shorten }: {
  settings: OpenjutsuSettings; seconds: number; change: (enabled: boolean) => void; shorten: () => void;
}) {
  if (!settings.referenceScene) return null;
  const enabled = settings.interactionGuide === 'aligned-interactions-v1' || settings.interactionGuide === 'aligned-interactions-v2';
  const issue = incomingInteractionIssue(settings, seconds), limit = Math.min(5, settings.clipSeconds);
  return <div className="oj-interactions">
    <Toggle label="Keep incoming hands & objects" checked={enabled} onChange={change}
      detail="Uses the complete source performance with the Motion Transfer adapter. Helps preserve incoming hands, objects and contact while using your character’s setting. Requires lip-sync enabled. Identity and hair can still vary after turns or occlusion; long-clip quality is still being evaluated." />
    {enabled && <p className="oj-scene-note">{settings.interactionGuide === 'aligned-interactions-v2' ? 'Long clips supported.' : `Saved short-clip guide · up to ${limit}s.`} Identity and hair may vary.</p>}
    {settings.interactionGuide === 'aligned-interactions-v1' && <button type="button" className="secondary-button" onClick={() => change(true)}>Enable longer clips</button>}
    {issue && <div className="oj-interaction-warning" role="status"><p>{issue}</p>
      {settings.interactionGuide === 'aligned-interactions-v1' && seconds > limit ? <button type="button" className="secondary-button" onClick={shorten}>Use {limit}s from current start</button>
        : <button type="button" className="secondary-button" onClick={() => change(true)}>Restore interaction guide</button>}
    </div>}
  </div>;
}
