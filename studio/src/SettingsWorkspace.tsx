import { useEffect, useState, type ReactNode } from 'react';
import { ArrowSquareOut, Lightning, Plug } from '@phosphor-icons/react';
import type { Connection } from '../shared/types';
import { api, Toggle } from './components';

export type SettingsTab = 'connection' | 'downloads' | 'extras';
const tabs: { id: SettingsTab; label: string }[] = [{ id: 'connection', label: 'Connection' }, { id: 'downloads', label: 'Downloads' }, { id: 'extras', label: 'Extras' }];

function ConnectionSettings({ connection, error, browse }: { connection: Connection; error: (message: string) => void; browse: () => void }) {
  const [endpoint, setEndpoint] = useState(connection.endpoint), [ssh, setSSH] = useState(true);
  useEffect(() => { setEndpoint(connection.endpoint); }, [connection.endpoint]);
  const connect = async () => {
    try { await api('/connection/connect', { endpoint, useSSH: ssh }); }
    catch (reason) { error((reason as Error).message); }
  };
  return <section className="settings-connection" aria-labelledby="connection-settings-heading">
    <h2 id="connection-settings-heading">GPU connection</h2><p className="settings-description">Your files and library stay on this Mac. Connect when you’re ready to work.</p>
    <div className={`connection-summary ${connection.state}`}><Plug size={22} /><div><strong>{connection.state === 'online' ? connection.gpu : connection.state === 'connecting' ? 'Connecting to your GPU' : 'Offline workspace'}</strong><p>{connection.message}</p></div></div>
    <button className="secondary-button" onClick={browse}><Lightning size={14} />Browse GPUs & manage instances</button>
    <label className="full-label">ComfyUI address<input value={endpoint} onChange={event => setEndpoint(event.target.value)} spellCheck={false} /></label>
    <Toggle label="Restore saved SSH tunnel" checked={ssh} onChange={setSSH} detail="Uses the Vast connection already configured on this Mac" />
    <div className="connection-help"><strong>Before reconnecting</strong><p>Start the instance in GPU cloud, then connect here. For manually rented instances, configure their SSH command in the project first.</p><a href="https://cloud.vast.ai/instances/" target="_blank" rel="noreferrer">Open Vast instances <ArrowSquareOut size={13} /></a></div>
    <div className="settings-connection-actions">{connection.state === 'online' ? <button className="secondary-button" onClick={() => void api('/connection/disconnect', {}).catch(reason => error(reason.message))}>Disconnect</button> : <button className="primary-button" onClick={() => void connect()} disabled={connection.state === 'connecting'}>{connection.state === 'connecting' ? 'Connecting…' : 'Connect GPU'}</button>}</div>
    <p className="field-hint">Disconnecting this app does not stop rental billing. Use GPU cloud to stop the instance when you finish.</p>
  </section>;
}

export default function SettingsWorkspace({ tab, onTabChange, connection, error, browse, models, downloads }: { tab: SettingsTab; onTabChange: (tab: SettingsTab) => void;
  connection: Connection; error: (message: string) => void; browse: () => void; models: ReactNode; downloads: ReactNode }) {
  return <main className="settings-workspace"><div className="settings-inner">
    <header className="settings-heading"><h1>Settings</h1><p>Manage your connection and model files.</p></header>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">{tabs.map(item => <button key={item.id} type="button" role="tab" id={`settings-${item.id}-tab`}
      aria-selected={tab === item.id} aria-controls={`settings-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => onTabChange(item.id)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)! : tabs[(tabs.findIndex(option => option.id === item.id) + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
        onTabChange(next.id); document.getElementById(`settings-${next.id}-tab`)?.focus();
      }}>{item.label}</button>)}</div>
    <div role="tabpanel" id={`settings-${tab}-panel`} aria-labelledby={`settings-${tab}-tab`} tabIndex={0}>
      {tab === 'extras' ? models : tab === 'downloads' ? downloads : <ConnectionSettings connection={connection} error={error} browse={browse} />}
    </div>
  </div></main>;
}
