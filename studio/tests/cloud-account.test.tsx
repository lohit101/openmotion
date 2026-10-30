import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApplication } from '../server/index';
import type { CloudLaunch } from '../shared/cloud';
import type { Job } from '../shared/types';
import { cloudAccountSchema } from '../shared/cloud-account';

const exec = promisify(execFile), repo = path.resolve(import.meta.dirname, '../..');
let home = '', local: Awaited<ReturnType<typeof createApplication>> | undefined;
afterEach(async () => {
  local?.idle.dispose(); local?.cloud.dispose(); local?.connection.disconnect(); local?.store.close(); local = undefined;
  vi.restoreAllMocks(); if (home) await rm(home, { recursive: true, force: true }); home = '';
});
async function setup() {
  home = await mkdtemp(path.join(os.tmpdir(), 'recast-account-')); vi.spyOn(os, 'homedir').mockReturnValue(home);
  const calls: { method: string; route: string; auth: string | null }[] = [];
  let instances: any[] = [], keys: any[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const route = new URL(String(url)).pathname, method = init?.method || 'GET', auth = new Headers(init?.headers).get('Authorization'); calls.push({ method, route, auth });
    if (auth === 'Bearer invalid-fixture-key') return Response.json({ msg: 'invalid-fixture-key is invalid' }, { status: 401 });
    if (method !== 'GET') throw new Error('Account setup attempted a provider mutation.');
    if (route === '/api/v1/instances/') return Response.json({ instances });
    if (route === '/api/v0/ssh/') return Response.json(keys);
    throw new Error('Unexpected provider request: ' + route);
  });
  local = await createApplication({ dataRoot: path.join(home, 'app-data'), seed: false, repo, cloudOptions: { fetcher, backgroundSafety: false } });
  return { agent: request(local.app), calls, fetcher, instances: (value: any[]) => { instances = value; }, keys: (value: any[]) => { keys = value; } };
}
const keyFile = () => path.join(home, '.config/vastai/vast_api_key');
async function sshKey(name = 'my key with spaces') {
  const identity = path.join(home, 'keys', name); await mkdir(path.dirname(identity), { recursive: true });
  await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'fixture-public-only', '-f', identity]); return identity;
}
describe('multi-user Vast setup', () => {
  it('sets up a fresh clone without a CLI install or shared credentials, using read-only validation', async () => {
    const { agent, calls } = await setup();
    const first = await agent.get('/api/cloud/account').expect(200);
    expect(first.body).toMatchObject({ apiKeyConfigured: false, ssh: { mode: 'managed', ready: false }, canEdit: true });
    expect(calls).toEqual([]);
    const saved = await agent.post('/api/cloud/account').send({ apiKey: 'fresh-fixture-key', sshMode: 'managed' }).expect(200);
    expect(saved.body.account).toMatchObject({ apiKeyConfigured: true, ssh: { mode: 'managed', ready: true }, canEdit: true });
    expect(saved.body.account.ssh.publicKey).toMatch(/^ssh-ed25519 /); expect(saved.body.account.ssh.fingerprint).toMatch(/^SHA256:/);
    expect(await readFile(keyFile(), 'utf8')).toBe('fresh-fixture-key\n'); expect((await stat(keyFile())).mode & 0o777).toBe(0o600);
    expect(calls.map(call => call.method + ' ' + call.route)).toEqual(['GET /api/v1/instances/', 'GET /api/v0/ssh/']);
    const bootstrap = await agent.get('/api/bootstrap'); expect(JSON.stringify([saved.body, bootstrap.body])).not.toMatch(/fresh-fixture-key|BEGIN OPENSSH PRIVATE/);
    expect(JSON.stringify(local!.store.value('cloud-ssh-selection', null))).not.toContain('fresh-fixture-key');
    const privateFile = saved.body.account.ssh.path; const before = await readFile(privateFile, 'utf8');
    await agent.post('/api/cloud/account').send({ sshMode: 'managed' }).expect(200); expect(await readFile(privateFile, 'utf8')).toBe(before);
  });
  it('preserves a previous key when verification fails and never returns its value', async () => {
    const { agent } = await setup(); await mkdir(path.dirname(keyFile()), { recursive: true }); await writeFile(keyFile(), 'previous-fixture-key\n', { mode: 0o600 });
    const failed = await agent.post('/api/cloud/account').send({ apiKey: 'invalid-fixture-key', sshMode: 'managed' }).expect(400);
    expect(failed.body.error).toContain('invalid or expired'); expect(JSON.stringify(failed.body)).not.toContain('invalid-fixture-key');
    expect(await readFile(keyFile(), 'utf8')).toBe('previous-fixture-key\n'); expect(existsSync(path.join(home, 'app-data/private/id_ed25519'))).toBe(false);
  });
  it('supports a user-owned key path, derives a missing public key, and keeps private bytes unchanged', async () => {
    const { agent } = await setup(); const identity = await sshKey(); const before = await readFile(identity, 'utf8'); await rm(identity + '.pub');
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'existing', privateKeyPath: '~/keys/my key with spaces' }).expect(200);
    expect(result.body.account.ssh).toMatchObject({ mode: 'existing', path: identity, ready: true }); expect(await readFile(identity, 'utf8')).toBe(before);
    expect(await readFile(identity + '.pub', 'utf8')).toMatch(/^ssh-ed25519 /); expect(JSON.stringify(result.body)).not.toContain(before);
  });
  it('refuses mismatched public/private keys without overwriting credentials or either key', async () => {
    const { agent } = await setup(); const identity = await sshKey('first'), other = await sshKey('second'); const wrong = await readFile(other + '.pub', 'utf8'); await writeFile(identity + '.pub', wrong);
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'existing', privateKeyPath: identity }).expect(400);
    expect(result.body.error).toContain('does not match'); expect(existsSync(keyFile())).toBe(false); expect(await readFile(identity + '.pub', 'utf8')).toBe(wrong);
  });
  it('rejects public-key paths, missing keys and unsafe private-key permissions', async () => {
    const { agent } = await setup(); const identity = await sshKey();
    for (const [value, message] of [[identity + '.pub', 'private key file'], [path.join(home, 'absent'), 'does not exist']]) {
      const result = await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'existing', privateKeyPath: value }).expect(400); expect(result.body.error).toContain(message);
    }
    await chmod(identity, 0o644);
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'existing', privateKeyPath: identity }).expect(400); expect(result.body.error).toContain('permissions'); expect(existsSync(keyFile())).toBe(false);
  });
  it('retains existing rental SSH identities when selecting another key for future rentals', async () => {
    const { agent, instances, keys, calls } = await setup(); const old = await sshKey('old'), next = await sshKey('next');
    await agent.post('/api/cloud/account').send({ apiKey: 'owner-fixture-key', sshMode: 'existing', privateKeyPath: old }).expect(200);
    const launch = { id: 'owned-launch', instanceId: 111, phase: 'stopped', safetyStatus: 'stopped' } as CloudLaunch; local!.cloud.state.launches.push(launch); instances([{ id: 111 }]);
    await agent.post('/api/cloud/account').send({ sshMode: 'existing', privateKeyPath: next }).expect(200);
    expect(local!.store.value<Record<string, string>>('cloud-ssh-identities', {})[launch.id]).toBe(old);
    keys([{ public_key: (await readFile(old + '.pub', 'utf8')).trim() }]); expect(await local!.cloud.ensureSshKey(launch)).toBe(old);
    expect(local!.cloud.accountStatus().ssh.path).toBe(next); expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('prevents account switching from orphaning a retained rental', async () => {
    const { agent } = await setup(); await agent.post('/api/cloud/account').send({ apiKey: 'owner-fixture-key', sshMode: 'managed' }).expect(200);
    local!.cloud.state.launches.push({ id: 'retained', instanceId: 111, phase: 'stopped', safetyStatus: 'stopped' } as CloudLaunch);
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'other-account-fixture-key', sshMode: 'managed' }).expect(400);
    expect(result.body.error).toContain('existing Recast rental'); expect(await readFile(keyFile(), 'utf8')).toBe('owner-fixture-key\n');
  });
  it('blocks account changes during generation before validating or writing credentials', async () => {
    const { agent, calls } = await setup(); local!.store.addJob({ id: 'active', status: 'running', createdAt: '', origin: 'render' } as Job);
    const status = await agent.get('/api/cloud/account'); expect(status.body.canEdit).toBe(false);
    await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'managed' }).expect(409);
    expect(calls).toEqual([]); expect(existsSync(keyFile())).toBe(false);
  });
  it('blocks account changes during model downloads without making provider requests', async () => {
    const { agent, calls } = await setup(); local!.models.state.busy = true;
    expect((await agent.get('/api/cloud/account')).body.canEdit).toBe(false);
    await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'managed' }).expect(409);
    expect(calls).toEqual([]); expect(existsSync(keyFile())).toBe(false);
  });
  it('keeps a concurrently rotated CLI credential instead of overwriting it after SSH checks', async () => {
    const { agent } = await setup(); await agent.post('/api/cloud/account').send({ apiKey: 'original-fixture-key', sshMode: 'managed' }).expect(200);
    const credentials = (local!.cloud as any).credentials;
    const prepare = credentials.prepareIdentity.bind(credentials);
    vi.spyOn(credentials, 'prepareIdentity').mockImplementation(async (...args) => {
      const identity = await prepare(...args); await writeFile(keyFile(), 'rotated-fixture-key\n'); return identity;
    });
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'replacement-fixture-key', sshMode: 'managed' }).expect(400);
    expect(result.body.error).toContain('credentials changed'); expect(await readFile(keyFile(), 'utf8')).toBe('rotated-fixture-key\n');
    expect(local!.cloud.state.busy).toBe(false);
  });
  it('does not save credentials if work starts during read-only verification', async () => {
    const { agent, fetcher } = await setup();
    fetcher.mockImplementationOnce(async () => { local!.models.state.busy = true; return Response.json({ instances: [] }); });
    const result = await agent.post('/api/cloud/account').send({ apiKey: 'fixture-key', sshMode: 'managed' }).expect(400);
    expect(result.body.error).toContain('Work or credentials changed'); expect(existsSync(keyFile())).toBe(false);
    expect(local!.cloud.state.busy).toBe(false);
  });
  it('rejects cross-site and different-port credential changes', async () => {
    const { agent, calls } = await setup(); const input = { apiKey: 'fixture-key', sshMode: 'managed' };
    await agent.post('/api/cloud/account').set('Origin', 'https://external.example').send(input).expect(403);
    await agent.post('/api/cloud/account').set('Origin', 'http://127.0.0.1:9999').send(input).expect(403);
    await agent.post('/api/cloud/account').set('Sec-Fetch-Site', 'cross-site').send(input).expect(403);
    expect(calls).toEqual([]); expect(existsSync(keyFile())).toBe(false);
  });
  it('validates the setup schema without placing key contents in validation errors', () => {
    expect(cloudAccountSchema.safeParse({ apiKey: 'key with spaces', sshMode: 'managed' }).success).toBe(false);
    expect(cloudAccountSchema.safeParse({ apiKey: 'key', sshMode: 'existing' }).success).toBe(false);
    expect(cloudAccountSchema.safeParse({ apiKey: 'key', sshMode: 'managed', privateKeyContents: 'never-accept' }).success).toBe(false);
  });
});
