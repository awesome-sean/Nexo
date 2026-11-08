import { spawn } from 'node:child_process';

/** Open the assisted installer. It asks the user before closing the running app. */
export function launchUpdate(installer: string, onClose: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(installer, [], {
      detached: true, windowsHide: false, stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', onClose);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
