import { useId, useState } from 'react';
import { ArrowSquareOut, CheckCircle, Copy, Key } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { CloudState } from '../shared/cloud';
import type { CloudAccountStatus } from '../shared/cloud-account';
import { api, Modal, SmallSelect } from './components';
import { FieldLabel } from './InfoTip';
import './cloud-account.css';

export default function VastAccountSetup({ cloud, setCloud, label = 'Account & SSH keys', primary = false, onSaved }: {
  cloud: CloudState; setCloud: (state: CloudState) => void; label?: string; primary?: boolean; onSaved?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CloudAccountStatus | null>(null), [error, setError] = useState('');
  const [apiKey, setApiKey] = useState(''), [sshMode, setSshMode] = useState<'managed' | 'existing'>('managed'), [privateKeyPath, setPrivateKeyPath] = useState('');
  const show = async () => {
    setOpen(true); setApiKey(''); setError(''); setStatus(null); setLoading(true);
    try {
      const value = await api<CloudAccountStatus>('/cloud/account'); setStatus(value);
      setSshMode(value.ssh.mode === 'managed' ? 'managed' : 'existing'); setPrivateKeyPath(value.ssh.path);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  };
  const close = (value: boolean) => { if (saving) return; setOpen(value); if (!value) { setApiKey(''); setError(''); } };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving || !status?.canEdit) return; setSaving(true); setError('');
    try {
      const value = await api<{ account: CloudAccountStatus; cloud: CloudState }>('/cloud/account', {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), sshMode, ...(sshMode === 'existing' ? { privateKeyPath } : {}),
      });
      setStatus(value.account); setApiKey(''); setCloud(value.cloud); onSaved?.();
      toast.success('Vast account ready', { description: 'Account verified and SSH key prepared. No GPU was rented.' });
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(status!.ssh.publicKey!); toast.success('Public SSH key copied'); }
    catch { toast.error('Couldn’t copy the key', { description: 'Select and copy the public key shown below.' }); }
  };
  return <>
    <button type="button" className={`${primary ? 'primary-button' : 'secondary-button'} compact`} onClick={() => void show()} disabled={cloud.busy}><Key size={15} />{label}</button>
    <Modal open={open} onOpenChange={close} title="Connect your Vast account" description="Use your own Vast account and an SSH key stored on this computer.">
      <form className="vast-account-form" onSubmit={event => void save(event)} aria-busy={saving || loading}>
        {loading && <p role="status">Checking local account setup…</p>}
        <div className="full-label"><div className="vast-account-label"><FieldLabel label="Vast API key" htmlFor={`${id}-api-key`} help="The key is verified with read-only account requests, then saved in the local Vast CLI credential file. It is never returned to the browser, stored in a render or sent to a GPU host." /><a href="https://cloud.vast.ai/manage-keys/" target="_blank" rel="noreferrer">Get an API key <ArrowSquareOut size={12} /></a></div>
          <input id={`${id}-api-key`} type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={saving || loading || status?.canEdit === false}
            required={status ? !status.apiKeyConfigured : false} placeholder={status?.apiKeyConfigured ? 'Saved locally · leave blank to keep it' : 'Paste your Vast API key'} />
          {status?.apiKeyConfigured && <small className="vast-account-saved"><CheckCircle size={13} />A key is already saved on this computer.</small>}
        </div>
        <div className="full-label"><FieldLabel label="SSH key" help="Only the public key is registered with Vast when you launch a GPU. Your private key stays on this computer. Existing rentals keep their saved SSH identity when you change the default for future rentals." />
          <SmallSelect label="SSH key source" value={sshMode} onChange={value => setSshMode(value as 'managed' | 'existing')} disabled={saving || loading || status?.canEdit === false}
            options={[{ value: 'managed', label: 'Create or reuse a Recast key' }, { value: 'existing', label: 'Use my existing SSH key' }]} />
        </div>
        {sshMode === 'existing' && <div className="full-label"><FieldLabel label="Private-key file path" htmlFor={`${id}-identity`} help="Enter the private key’s local file path, such as ~/.ssh/id_ed25519. Do not paste private-key contents. Encrypted keys must already be unlocked in ssh-agent." />
          <input id={`${id}-identity`} value={privateKeyPath} onChange={event => setPrivateKeyPath(event.target.value)} placeholder="~/.ssh/id_ed25519" spellCheck={false} autoComplete="off" required disabled={saving || loading || status?.canEdit === false} />
        </div>}
        {status?.ssh.ready && <details className="vast-public-key"><summary>Saved public key & fingerprint</summary><code>{status.ssh.fingerprint}</code><textarea aria-label="Public SSH key" readOnly rows={3} value={status.ssh.publicKey || ''} /><button type="button" className="secondary-button compact" onClick={() => void copy()}><Copy size={13} />Copy public key</button></details>}
        {status?.blockedReason && <p className="vast-account-warning" role="status">{status.blockedReason}</p>}
        {error && <p className="vast-account-error" role="alert">{error}</p>}
        <p className="vast-account-local">Saved on this computer in <code>~/.config/vastai/vast_api_key</code>. Verification and setup do not rent or start a GPU.</p>
        <div className="modal-actions"><button className="primary-button" type="submit" disabled={!status?.canEdit || saving || loading}>{saving ? 'Verifying account & SSH key…' : 'Verify & save'}</button><button className="secondary-button" type="button" onClick={() => close(false)} disabled={saving}>Done</button></div>
      </form>
    </Modal>
  </>;
}
