import { spawn } from 'node:child_process';
import path from 'node:path';

/** The helper waits until Nexo and its Bluetooth service have shut down. */
export function launchUpdate(installer: string): Promise<void> {
  const script = path.resolve(import.meta.dirname, '../../assets/apply-update.ps1')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script,
      '-Installer', installer, '-ApplicationPid', String(process.pid),
      '-InstallDirectory', path.dirname(process.execPath),
    ], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
