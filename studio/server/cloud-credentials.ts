import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Store } from './store';
import type { CloudAccountInput, CloudAccountStatus } from '../shared/cloud-account';

const exec = promisify(execFile);
const material = (value: string) => value.trim().split(/\s+/).slice(0, 2).join(' ');
const publicKeyPattern = /^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+(?:\s|$)/;
export const sshFingerprint = (publicKey: string) => 'SHA256:' + createHash('sha256')
  .update(Buffer.from(publicKey.trim().split(/\s+/)[1], 'base64')).digest('base64').replace(/=+$/, '');

/** The CLI and UI share one local credential file. No secret enters Studio's database. */
export class CloudCredentials {
  readonly keyFile: string;
  readonly managedIdentity: string;
  constructor(private store: Store, private overrideIdentity?: string, private home = os.homedir()) {
    this.keyFile = path.join(home, '.config/vastai/vast_api_key');
    this.managedIdentity = path.join(store.root, 'private/id_ed25519');
  }
  readKey() { try { return readFileSync(this.keyFile, 'utf8').trim(); } catch { return ''; } }
  selection(): CloudAccountStatus['ssh']['mode'] {
    const saved = this.store.value<{ mode: 'managed' | 'existing'; path: string } | null>('cloud-ssh-selection', null);
    return saved?.mode || (this.overrideIdentity || existsSync(path.join(this.home, '.ssh/comfyui_vast')) ? 'legacy' : 'managed');
  }
  identity() {
    const saved = this.store.value<{ mode: 'managed' | 'existing'; path: string } | null>('cloud-ssh-selection', null);
    if (saved) return saved.mode === 'managed' ? this.managedIdentity : saved.path;
    const legacy = this.overrideIdentity || path.join(this.home, '.ssh/comfyui_vast');
    return existsSync(legacy) ? legacy : this.managedIdentity;
  }
  status(canEdit: boolean, blockedReason: string | null): CloudAccountStatus {
    const identity = this.identity(); let publicKey: string | null = null;
    try { const value = readFileSync(identity + '.pub', 'utf8').split(/\r?\n/, 1)[0].trim(); if (value.length <= 16384 && publicKeyPattern.test(value)) publicKey = value; } catch { /* Not set up yet. */ }
    return { apiKeyConfigured: !!this.readKey(), credentialFile: '~/.config/vastai/vast_api_key',
      ssh: { mode: this.selection(), path: identity, publicKey, fingerprint: publicKey ? sshFingerprint(publicKey) : null,
        ready: existsSync(identity) && !!publicKey }, canEdit, blockedReason };
  }
  async prepareIdentity(input: CloudAccountInput): Promise<string> {
    let identity = this.managedIdentity;
    if (input.sshMode === 'existing') {
      const supplied = input.privateKeyPath!;
      if (/[\r\n\0]/.test(supplied)) throw new Error('Enter a local private-key file path.');
      identity = supplied.startsWith('~/') ? path.join(this.home, supplied.slice(2)) : supplied;
      if (!path.isAbsolute(identity)) throw new Error('Use an absolute path or ~/ for your private SSH key.');
      identity = path.normalize(identity);
      if (identity.endsWith('.pub')) throw new Error('Choose the private key file, without the .pub suffix.');
    } else {
      await mkdir(path.dirname(identity), { recursive: true, mode: 0o700 });
      if (!existsSync(identity)) await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'recast-studio', '-f', identity], { timeout: 15000 });
    }
    let stat;
    try { stat = await lstat(identity); } catch { throw new Error('That private SSH key file does not exist on this computer.'); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Choose a regular private SSH key file.');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('The private SSH key is readable by other users. Set its permissions to 600, then retry.');
    let existing = ''; try { existing = (await readFile(identity + '.pub', 'utf8')).split(/\r?\n/, 1)[0].trim(); } catch { /* Derive from the private key below. */ }
    let derived = '';
    try { derived = (await exec('ssh-keygen', ['-y', '-P', '', '-f', identity], { timeout: 10000 })).stdout.trim(); }
    catch {
      // A passphrase-protected private key may already be unlocked in ssh-agent.
      let keys = ''; try { keys = (await exec('ssh-add', ['-L'], { timeout: 5000 })).stdout; } catch { /* No usable agent. */ }
      if (!existing || !publicKeyPattern.test(existing) || !keys.split('\n').some(key => material(key) === material(existing)))
        throw new Error('This key could not be unlocked. Add it to ssh-agent with ssh-add, keep its matching .pub file beside it, then retry.');
      derived = existing;
    }
    if (!publicKeyPattern.test(derived)) throw new Error('Use an Ed25519, RSA or ECDSA OpenSSH key.');
    if (existing && material(existing) !== material(derived)) throw new Error('The .pub file does not match this private SSH key. Existing files were kept.');
    if (!existing) await writeFile(identity + '.pub', derived + '\n', { flag: 'wx', mode: 0o644 });
    return identity;
  }
  async saveKey(key: string) {
    const folder = path.dirname(this.keyFile); await mkdir(folder, { recursive: true, mode: 0o700 });
    if ((await lstat(folder)).isSymbolicLink()) throw new Error('The Vast credential folder is a symbolic link. Update it through the CLI instead.');
    const temporary = path.join(folder, '.recast-key-' + randomUUID());
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(key + '\n'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.keyFile);
    } finally { await rm(temporary, { force: true }); }
  }
  select(input: CloudAccountInput, identity: string) {
    this.store.set('cloud-ssh-selection', { mode: input.sshMode, path: identity });
  }
}
