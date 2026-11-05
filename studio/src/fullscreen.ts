type NativeVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void };

export function observeFullscreen(element: HTMLElement, changed: (active: boolean) => void, video?: HTMLVideoElement) {
  const document = element.ownerDocument;
  const sync = () => changed(document.fullscreenElement === element || !!(video as NativeVideo | undefined)?.webkitDisplayingFullscreen);
  const nativeStart = () => changed(true), nativeEnd = () => changed(false);
  document.addEventListener('fullscreenchange', sync);
  video?.addEventListener('webkitbeginfullscreen', nativeStart);
  video?.addEventListener('webkitendfullscreen', nativeEnd);
  sync();
  return () => { document.removeEventListener('fullscreenchange', sync); video?.removeEventListener('webkitbeginfullscreen', nativeStart); video?.removeEventListener('webkitendfullscreen', nativeEnd); };
}

export async function toggleFullscreen(element: HTMLElement, video?: HTMLVideoElement) {
  const document = element.ownerDocument;
  if (document.fullscreenElement === element) await document.exitFullscreen();
  else if (typeof element.requestFullscreen === 'function') await element.requestFullscreen();
  else {
    const native = video as NativeVideo | undefined;
    if (native?.webkitDisplayingFullscreen && native.webkitExitFullscreen) native.webkitExitFullscreen();
    else if (native?.webkitEnterFullscreen) native.webkitEnterFullscreen();
    else throw new Error('Fullscreen is not available in this browser.');
  }
}
