import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { readAlertPreferences, type ActivityAlert, type AlertPreferences, type AlertTarget } from '../shared/alerts';

const preferenceKey = 'recast-alert-preferences-v1', deliveryKey = 'recast-alert-deliveries-v1';
type Permission = NotificationPermission | 'unsupported';
type SoundState = 'idle' | 'ready' | 'blocked' | 'unsupported';
interface AlertState { preferences: AlertPreferences; permission: Permission; sound: SoundState; desktopError: string; }
const serverState: AlertState = { preferences: readAlertPreferences({}), permission: 'unsupported', sound: 'idle', desktopError: '' };
const permission = (): Permission => typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window ? Notification.permission : 'unsupported';
function loadPreferences() { try { return readAlertPreferences(JSON.parse(localStorage.getItem(preferenceKey) || '{}')); } catch { return readAlertPreferences({}); } }

/** Local-only delivery. Permission and audio activation are explicit browser gestures. */
export class BrowserAlerts {
  private state: AlertState = { preferences: loadPreferences(), permission: permission(), sound: 'idle', desktopError: '' };
  private listeners = new Set<() => void>();
  private audio: AudioContext | null = null;
  private activated = false;
  private shown = new Set<string>();
  private banners = new Set<Notification>();
  private delivered = new Map<string, number>();
  private lastSound = -Infinity;
  private open: (target: AlertTarget) => void = () => undefined;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(patch: Partial<AlertState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  configure(patch: Partial<AlertPreferences>) {
    const preferences = readAlertPreferences({ ...this.state.preferences, ...patch });
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Session controls still work. */ }
    this.update({ preferences });
  }
  mount(open: (target: AlertTarget) => void) {
    this.open = open;
    const refresh = () => this.update({ permission: permission() });
    const gesture = () => { if (this.state.preferences.sounds) void this.unlock(); };
    const storage = (event: StorageEvent) => { if (event.key === preferenceKey) this.update({ preferences: loadPreferences() }); };
    const visible = () => { refresh(); if (document.visibilityState === 'visible' && document.hasFocus()) { for (const banner of this.banners) banner.close(); this.banners.clear(); } };
    document.addEventListener('pointerdown', gesture, true); document.addEventListener('keydown', gesture, true);
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible); window.addEventListener('storage', storage); refresh();
    return () => { document.removeEventListener('pointerdown', gesture, true); document.removeEventListener('keydown', gesture, true); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); window.removeEventListener('storage', storage); this.open = () => undefined; };
  }
  async enableDesktop() {
    if (permission() === 'unsupported') { this.update({ permission: 'unsupported' }); return; }
    try {
      const result = await Notification.requestPermission();
      this.update({ permission: result, desktopError: '' });
      this.configure({ desktop: result === 'granted' });
    } catch { this.update({ permission: permission(), desktopError: 'Notifications could not be enabled. Check this site’s notification permission.' }); }
  }
  async unlock() {
    if (this.audio?.state === 'running') return true;
    try {
      const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) { this.update({ sound: 'unsupported' }); return false; }
      if (!this.audio || this.audio.state === 'closed') {
        this.audio = new Context();
        this.audio.onstatechange = () => { if (this.audio?.state === 'running') this.activated = true; this.update({ sound: this.audio?.state === 'running' ? 'ready' : 'blocked' }); };
      }
      const context = this.audio;
      if (context.state !== 'running') { this.update({ sound: 'blocked' }); await context.resume(); }
      if (context.state === 'running') this.activated = true;
      this.update({ sound: context.state === 'running' ? 'ready' : 'blocked' });
      return context.state === 'running';
    } catch { this.update({ sound: 'blocked' }); return false; }
  }
  private play(tone: ActivityAlert['tone'], force = false) {
    const context = this.audio, volume = this.state.preferences.volume;
    if (!context || context.state !== 'running' || !volume || (!force && Date.now() - this.lastSound < 1800)) return false;
    this.lastSound = Date.now();
    const notes = tone === 'success' ? [659.25, 880] : tone === 'warning' ? [554.37, 440] : [392, 261.63];
    try {
      for (const [index, frequency] of notes.entries()) {
        const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + index * .16;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume * .16, start + .015); gain.gain.exponentialRampToValueAtTime(.0001, start + .27);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .3);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
      return true;
    } catch { this.update({ sound: 'blocked' }); return false; }
  }
  async previewSound(tone: ActivityAlert['tone']) { await this.unlock(); if (!this.play(tone, true)) this.update({ sound: 'blocked' }); }
  private async playActivated(alert: ActivityAlert) {
    const context = this.audio; if (!context || !this.activated) return;
    if (context.state !== 'running') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { if (!await Promise.race([context.resume().then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1500); })])) { this.update({ sound: 'blocked' }); return; } }
      catch { this.update({ sound: 'blocked' }); return; } finally { clearTimeout(timer); }
    }
    if (this.state.preferences.sounds && this.state.preferences.events[alert.category]) this.play(alert.tone);
  }

  private claim(alert: ActivityAlert) {
    const claim = () => {
      const now = Date.now(), lifetime = alert.category === 'connection' ? 5000 : 86400000;
      let saved: Record<string, number> = {};
      try { const data = JSON.parse(localStorage.getItem(deliveryKey) || '{}'); if (data && typeof data === 'object' && !Array.isArray(data)) saved = data; } catch { /* Use the tab-local guard if storage is blocked. */ }
      if (now - (saved[alert.id] || this.delivered.get(alert.id) || 0) < lifetime) return false;
      const recent = Object.entries(saved).filter(([, at]) => Number.isFinite(at) && now - at < 86400000).slice(-127);
      recent.push([alert.id, now]);
      try { localStorage.setItem(deliveryKey, JSON.stringify(Object.fromEntries(recent))); } catch { /* Tab-local fallback. */ }
      this.delivered.set(alert.id, now); if (this.delivered.size > 128) this.delivered.delete(this.delivered.keys().next().value!);
      return true;
    };
    // Locks serialize same-origin tabs; storage remains a best-effort fallback elsewhere.
    return navigator.locks ? navigator.locks.request('recast-alert-delivery', claim).catch(() => claim()) : Promise.resolve(claim());
  }
  private banner(alert: ActivityAlert) {
    try {
      const banner = new Notification(`Recast · ${alert.title}`, { body: alert.body, tag: alert.id, silent: true });
      this.banners.add(banner);
      banner.onclick = () => { window.focus(); this.open(alert.target); banner.close(); this.banners.delete(banner); };
      banner.onclose = () => this.banners.delete(banner);
      banner.onerror = () => { this.banners.delete(banner); this.update({ desktopError: 'The browser could not display a notification. Check browser and system notification settings.' }); };
      this.update({ desktopError: '' });
      return true;
    } catch { this.update({ desktopError: 'This browser could not display desktop notifications. In-app messages still work.' }); return false; }
  }
  async notify(alert: ActivityAlert) {
    if (this.shown.has(alert.id)) return;
    this.shown.add(alert.id); if (this.shown.size > 256) this.shown.delete(this.shown.values().next().value!);
    if (alert.toast !== false) toast[alert.tone](alert.title, { id: alert.id, description: alert.detail || alert.body, duration: alert.tone === 'error' ? 14000 : 8000, action: { label: 'View', onClick: () => this.open(alert.target) } });
    const prefs = this.state.preferences;
    if (!prefs.events[alert.category]) return;
    const desktop = prefs.desktop && permission() === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus());
    const sound = prefs.sounds && prefs.volume > 0 && this.activated && !!this.audio && this.audio.state !== 'closed';
    if (!desktop && !sound) return;
    try { if (!await this.claim(alert)) return; } catch { return; }
    // Re-read preferences after the cross-tab lock, in case the user just muted alerts.
    if (!this.state.preferences.events[alert.category]) return;
    if (desktop && this.state.preferences.desktop && permission() === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) this.banner(alert);
    if (sound && this.state.preferences.sounds) void this.playActivated(alert);
  }
  testDesktop() { if (permission() === 'granted') return this.banner({ id: 'recast-alert-test', category: 'connection', tone: 'success', title: 'Notifications are ready', body: 'You’ll hear from Recast when a task finishes or needs attention.', target: { view: 'alerts' } }); return false; }
}

export const browserAlerts = new BrowserAlerts();
export const useAlertSettings = () => useSyncExternalStore(browserAlerts.subscribe, browserAlerts.snapshot, () => serverState);
