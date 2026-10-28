import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAlerts } from '../src/alerts';
import type { ActivityAlert } from '../shared/alerts';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
let banners: FakeNotification[], frequencies: number[], contexts: FakeAudio[], focused: boolean, visibility: string;
class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => { FakeNotification.permission = 'granted'; return 'granted' as const; });
  onclick: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { banners.push(this); }
}
class FakeAudio {
  state: AudioContextState = 'running'; currentTime = 0; destination = {}; onstatechange: (() => void) | null = null;
  resume = vi.fn(async () => { this.state = 'running'; this.onstatechange?.(); });
  constructor() { contexts.push(this); }
  createOscillator() { return { type: '', frequency: { setValueAtTime: (value: number) => frequencies.push(value) }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null }; }
  createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
}
const alert = (id = 'ready'): ActivityAlert => ({ id, category: 'generation', tone: 'success', title: 'Your video is ready', body: 'Saved to your library.', target: { view: 'create', jobId: 'job-fixture' } });
beforeEach(() => {
  vi.clearAllMocks(); banners = []; frequencies = []; contexts = []; focused = false; visibility = 'hidden'; FakeNotification.permission = 'default';
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', { isSecureContext: true, Notification: FakeNotification, AudioContext: FakeAudio, addEventListener: vi.fn(), removeEventListener: vi.fn(), focus: vi.fn() });
  vi.stubGlobal('document', { get visibilityState() { return visibility; }, hasFocus: () => focused, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => boolean) => Promise.resolve(callback()) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('local browser alert delivery', () => {
  it('never requests permission or creates audio from incoming events; permission is an explicit action', async () => {
    const driver = new BrowserAlerts(); driver.configure({ desktop: true }); await driver.notify(alert());
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled(); expect(contexts).toHaveLength(0); expect(banners).toHaveLength(0);
    await driver.enableDesktop(); expect(FakeNotification.requestPermission).toHaveBeenCalledOnce(); expect(driver.snapshot()).toMatchObject({ permission: 'granted', preferences: { desktop: true } });
  });
  it('sends background desktop alerts and routes a click to the saved result', async () => {
    FakeNotification.permission = 'granted'; const driver = new BrowserAlerts(), open = vi.fn(); driver.mount(open); driver.configure({ desktop: true });
    await driver.notify(alert()); expect(banners).toHaveLength(1); expect(banners[0].options).toMatchObject({ silent: true, body: 'Saved to your library.' });
    banners[0].onclick?.(); expect(window.focus).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledWith({ view: 'create', jobId: 'job-fixture' }); expect(banners[0].close).toHaveBeenCalledOnce();
  });
  it('keeps desktop banners out of the focused tab and shares duplicate-delivery claims across tabs', async () => {
    FakeNotification.permission = 'granted'; const first = new BrowserAlerts(), second = new BrowserAlerts(); first.configure({ desktop: true }); second.configure({ desktop: true });
    focused = true; visibility = 'visible'; await first.notify(alert('visible')); expect(banners).toHaveLength(0);
    focused = false; visibility = 'hidden'; await Promise.all([first.notify(alert('same-event')), second.notify(alert('same-event'))]); expect(banners).toHaveLength(1);
  });
  it('respects event switches, mute and zero volume while keeping delivery failures isolated', async () => {
    FakeNotification.permission = 'granted'; const driver = new BrowserAlerts(); driver.configure({ desktop: true, events: { connection: true, models: true, generation: false, exports: true } });
    await driver.unlock(); await driver.notify(alert('disabled')); expect(frequencies).toHaveLength(0); expect(banners).toHaveLength(0);
    driver.configure({ events: { connection: true, models: true, generation: true, exports: true }, sounds: false }); await driver.notify(alert('silent'));
    expect(frequencies).toHaveLength(0); expect(banners).toHaveLength(1);
    driver.configure({ sounds: true, volume: 0, desktop: false }); await driver.notify(alert('zero')); expect(frequencies).toHaveLength(0);
    vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new Error('Lock unavailable')) } });
    driver.configure({ desktop: true }); await expect(driver.notify(alert('lock-error'))).resolves.toBeUndefined();
  });
  it('plays distinct local cues after activation and recovers a previously activated suspended context', async () => {
    const driver = new BrowserAlerts(); await driver.previewSound('success'); const ready = [...frequencies]; frequencies = [];
    await driver.previewSound('warning'); const warning = [...frequencies]; frequencies = [];
    await driver.previewSound('error'); expect(ready[1]).toBeGreaterThan(ready[0]); expect(warning[1]).toBeLessThan(warning[0]); expect(frequencies).not.toEqual(warning); expect(contexts).toHaveLength(1);
    frequencies = []; const restored = new BrowserAlerts(); await restored.unlock(); contexts.at(-1)!.state = 'suspended';
    await restored.notify(alert('after-suspension')); await vi.waitFor(() => expect(frequencies).toHaveLength(2)); expect(contexts.at(-1)!.resume).toHaveBeenCalledOnce();
  });
  it('persists controls and makes browser notification errors visible without throwing', async () => {
    const driver = new BrowserAlerts(); driver.configure({ sounds: false, volume: .25 }); expect(new BrowserAlerts().snapshot().preferences).toMatchObject({ sounds: false, volume: .25 });
    FakeNotification.permission = 'granted'; driver.configure({ desktop: true }); await driver.notify(alert('os-error')); banners[0].onerror?.();
    expect(driver.snapshot().desktopError).toContain('system notification settings');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });
});
