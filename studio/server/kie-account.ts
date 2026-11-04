import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { KieAccountStatus } from '../shared/kie';
import type { Store } from './store';

const keySchema = z.string().trim().min(10).max(500).refine(value => !/[\s\x00-\x1f]/.test(value), 'Paste the API key without spaces or line breaks.');
export class KieAccount {
  constructor(private store: Store, private credits: (key: string, signal?: AbortSignal) => Promise<number>) {}
  private file() { return path.join(this.store.root, 'secrets', 'kie-api-key.json'); }
  key(): string {
    const file = this.file();
    if (!existsSync(file)) throw new Error('Add your Kie.ai API key in Settings first.');
    if (lstatSync(file).isSymbolicLink() || lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error('The private Kie credential path must not be a symbolic link.');
    return keySchema.parse(JSON.parse(readFileSync(file, 'utf8')).apiKey);
  }
  status(): KieAccountStatus {
    let key: string | null = null;
    try { key = this.key(); } catch { /* No credentials are loaded from another app or environment. */ }
    const cached = this.store.value<{ credits: number | null; checkedAt: string | null; error: string | null }>('kie-account-status', { credits: null, checkedAt: null, error: null });
    return { configured: !!key, keyHint: key ? `••••${key.slice(-4)}` : null, credits: key ? cached.credits : null, checkedAt: key ? cached.checkedAt : null, error: cached.error };
  }
  fingerprint() { return createHash('sha256').update(this.key()).digest('hex'); }
  async save(value: unknown) {
    const { apiKey } = z.object({ apiKey: keySchema }).strict().parse(value);
    const credits = await this.credits(apiKey);
    if (!Number.isFinite(credits) || credits < 0) throw new Error('Kie.ai returned an invalid account balance. The key was not saved.');
    const folder = path.dirname(this.file());
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error('Choose a private credential folder without symbolic links.');
    await mkdir(folder, { recursive: true, mode: 0o700 }); await chmod(folder, 0o700);
    const temporary = this.file() + '.tmp';
    if (existsSync(temporary) && lstatSync(temporary).isSymbolicLink()) throw new Error('The private temporary key path is linked.');
    await writeFile(temporary, JSON.stringify({ version: 1, apiKey }) + '\n', { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, this.file());
    this.store.set('kie-account-status', { credits, checkedAt: new Date().toISOString(), error: null }); this.emit(); return this.status();
  }
  async refresh() {
    const key = this.key();
    try { const credits = await this.credits(key); this.store.set('kie-account-status', { credits, checkedAt: new Date().toISOString(), error: null }); this.emit(); return this.status(); }
    catch (error) { const previous = this.status(); this.store.set('kie-account-status', { credits: previous.credits, checkedAt: previous.checkedAt, error: 'Kie.ai account balance could not be refreshed. Check the key and your connection.' }); this.emit(); throw error; }
  }
  private emit() { this.store.emit('event', { type: 'kie-account', data: this.status() }); }
}
