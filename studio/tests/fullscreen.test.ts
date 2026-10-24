import { describe, expect, it, vi } from 'vitest';
import { observeFullscreen, toggleFullscreen } from '../src/fullscreen';

function browser() {
  class FullscreenDocument extends EventTarget {
    fullscreenElement: HTMLElement | null = null;
    exitFullscreen = vi.fn(async () => this.change(null));
    change(element: HTMLElement | null) {
      this.fullscreenElement = element;
      this.dispatchEvent(new Event('fullscreenchange'));
    }
  }
  const document = new FullscreenDocument();
  const request = vi.fn(async () => document.change(element));
  const element = { ownerDocument: document, requestFullscreen: request } as unknown as HTMLElement;
  return { document, element, request };
}

describe('video fullscreen lifecycle', () => {
  it('enters and exits repeatedly using the same control', async () => {
    const { document, element, request } = browser();
    const changes = vi.fn();
    const cleanup = observeFullscreen(element, changes);
    for (let cycle = 0; cycle < 2; cycle++) {
      await toggleFullscreen(element);
      expect(changes).toHaveBeenLastCalledWith(true);
      await toggleFullscreen(element);
      expect(changes).toHaveBeenLastCalledWith(false);
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(document.exitFullscreen).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('follows browser/Escape exit and removes its listener on unmount', async () => {
    const { document, element } = browser();
    const changes = vi.fn();
    const cleanup = observeFullscreen(element, changes);
    await toggleFullscreen(element);
    document.change(null); // The browser exits independently, as with Escape.
    expect(changes).toHaveBeenLastCalledWith(false);
    await toggleFullscreen(element);
    expect(changes).toHaveBeenLastCalledWith(true);
    cleanup();
    changes.mockClear();
    document.change(null);
    expect(changes).not.toHaveBeenCalled();
  });

  it('does not claim fullscreen when the browser rejects the request', async () => {
    const { element, request } = browser();
    const changes = vi.fn();
    const cleanup = observeFullscreen(element, changes);
    request.mockRejectedValueOnce(new Error('User activation required'));
    await expect(toggleFullscreen(element)).rejects.toThrow('User activation required');
    expect(changes.mock.calls).toEqual([[false]]);
    cleanup();
  });
});
