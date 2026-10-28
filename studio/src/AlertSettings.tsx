import { useState } from 'react';
import { Bell, CheckCircle, Play, SpeakerHigh, WarningCircle } from '@phosphor-icons/react';
import { browserAlerts, useAlertSettings } from './alerts';
import { Toggle } from './components';
import { alertCategories, type AlertCategory } from '../shared/alerts';
import './alerts.css';

const categories: Record<AlertCategory, { label: string; detail: string }> = {
  connection: { label: 'GPU connection & setup', detail: 'Connected, disconnected, and setup needing attention' },
  models: { label: 'Model downloads', detail: 'A download batch finishes or a file fails' },
  generation: { label: 'Images & videos', detail: 'A generation is ready, fails, or needs attention' },
  exports: { label: 'Clip exports', detail: 'Your local export is ready or fails' },
};

export default function AlertSettings() {
  const { preferences, permission, sound, desktopError } = useAlertSettings(), [requesting, setRequesting] = useState(false);
  const enable = async () => { setRequesting(true); try { await browserAlerts.enableDesktop(); } finally { setRequesting(false); } };
  return <section className="alert-settings" aria-labelledby="alert-settings-heading">
    <header><Bell size={24} /><div><h2 id="alert-settings-heading">Know when it’s ready</h2><p>Step away from the tab. Recast will let you know when work finishes or needs attention.</p></div></header>
    <section className="alert-channel" aria-label="Desktop notification settings">
      <div className="alert-channel-heading"><h3>Desktop notifications</h3><span className={`alert-readiness ${permission === 'granted' && preferences.desktop ? 'ready' : ''}`}>{permission === 'granted' && preferences.desktop ? <><CheckCircle size={13} />Enabled</> : permission === 'denied' ? 'Blocked by browser' : permission === 'unsupported' ? 'Unavailable' : 'Not enabled'}</span></div>
      {permission === 'granted' ? <><Toggle label="Desktop alerts" checked={preferences.desktop} onChange={desktop => browserAlerts.configure({ desktop })} detail="Show system banners when you’re in another tab or app." /><button type="button" className="secondary-button compact" disabled={!preferences.desktop} onClick={() => browserAlerts.testDesktop()}><Bell size={14} />Test notification</button></>
        : permission === 'default' ? <div className="alert-permission"><p>Allow Recast to show a notification outside the browser tab.</p><button type="button" className="primary-button compact" disabled={requesting} onClick={() => void enable()}><Bell size={14} />{requesting ? 'Waiting for permission…' : 'Enable desktop notifications'}</button></div>
        : <p className="alert-permission-note">{permission === 'denied' ? 'Allow notifications for this site in your browser’s site settings, then return here. Sound alerts and in-app messages still work.' : 'This browser does not offer desktop notifications here. Use a desktop browser on localhost or HTTPS. In-app messages remain available.'}</p>}
      {desktopError && <p className="alert-permission-note" role="status"><WarningCircle size={14} />{desktopError}</p>}
    </section>
    <section className="alert-channel" aria-label="Sound settings">
      <div className="alert-channel-heading"><h3>Sound</h3><span className={`alert-readiness ${preferences.sounds && sound === 'ready' ? 'ready' : ''}`}>{!preferences.sounds ? 'Muted' : sound === 'ready' ? <><CheckCircle size={13} />Ready</> : sound === 'unsupported' ? 'Unavailable' : 'Click a preview to activate'}</span></div>
      <Toggle label="Sound alerts" checked={preferences.sounds} onChange={sounds => { browserAlerts.configure({ sounds }); if (sounds) void browserAlerts.unlock(); }} detail="Short, distinct cues for success, attention and failure." />
      <label className="alert-volume"><SpeakerHigh size={17} /><span>Volume</span><input aria-label="Alert volume" type="range" min={0} max={100} step={5} value={Math.round(preferences.volume * 100)} disabled={!preferences.sounds || sound === 'unsupported'} onChange={event => browserAlerts.configure({ volume: Number(event.target.value) / 100 })} /><output>{Math.round(preferences.volume * 100)}%</output></label>
      <div className="alert-sound-previews" aria-label="Preview alert sounds">{([{ tone: 'success', label: 'Ready' }, { tone: 'warning', label: 'Attention' }, { tone: 'error', label: 'Failure' }] as const).map(item => <button key={item.tone} type="button" className="secondary-button compact" disabled={!preferences.sounds || !preferences.volume || sound === 'unsupported'} onClick={() => void browserAlerts.previewSound(item.tone)} aria-label={`Preview ${item.label.toLowerCase()} sound`}><Play size={12} weight="fill" />{item.label}</button>)}</div>
      {preferences.sounds && sound === 'blocked' && <p className="alert-permission-note" role="status">Click a sound preview to enable audio. Check whether this browser tab is muted if you cannot hear it.</p>}
    </section>
    <section className="alert-events" aria-labelledby="alert-events-heading"><h3 id="alert-events-heading">Alert me about</h3><p>Choose which events play sounds and send desktop notifications. In-app status messages stay visible.</p>
      <div>{alertCategories.map(category => <Toggle key={category} label={categories[category].label} detail={categories[category].detail} checked={preferences.events[category]} onChange={enabled => browserAlerts.configure({ events: { ...preferences.events, [category]: enabled } })} />)}</div>
    </section>
    <p className="alert-session-note"><Bell size={15} />Keep a Recast tab and the local app running. Desktop banners follow browser and system notification settings. These alerts do not use your rented GPU.</p>
  </section>;
}
