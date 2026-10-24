export function observeFullscreen(element: HTMLElement, changed: (active: boolean) => void) {
  const document = element.ownerDocument;
  const sync = () => changed(document.fullscreenElement === element);
  document.addEventListener('fullscreenchange', sync);
  sync();
  return () => document.removeEventListener('fullscreenchange', sync);
}

export async function toggleFullscreen(element: HTMLElement) {
  const document = element.ownerDocument;
  if (document.fullscreenElement === element) await document.exitFullscreen();
  else await element.requestFullscreen();
}
