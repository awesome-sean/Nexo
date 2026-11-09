import type { BrowserWindow } from 'electron';

/** Release the dashboard renderer after it has remained in the tray. */
export function releaseHiddenWindow(window: BrowserWindow, isBusy: () => boolean, delay = 30_000): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (window.isDestroyed() || window.isVisible()) return;
      if (isBusy()) schedule();
      else window.destroy();
    }, delay);
  };
  window.on('hide', schedule);
  window.on('show', cancel);
  window.on('closed', cancel);
}
