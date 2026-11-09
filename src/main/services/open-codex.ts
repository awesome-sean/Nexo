import { execFile } from 'node:child_process';
import path from 'node:path';

type OpenCodexResult = { ok: true } | { ok: false; error: string };
let pending: Promise<OpenCodexResult> | null = null;

export function openCodexWindow(): Promise<OpenCodexResult> {
  if (pending) return pending;
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: '此功能需要 Windows 版 ChatGPT。' });
  const script = path.resolve(import.meta.dirname, '../../assets/focus-codex.ps1')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  pending = new Promise<OpenCodexResult>(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script],
      { windowsHide: true, encoding: 'utf8', timeout: 25_000 }, (error, stdout) => {
        try {
          const result = JSON.parse(stdout.trim());
          if (result.ok === true) resolve({ ok: true });
          else resolve({ ok: false, error: typeof result.error === 'string' ? result.error : '打开 ChatGPT 失败，请重试。' });
        } catch {
          resolve({ ok: false, error: error?.killed ? '打开 ChatGPT 超时，请重试。' : '无法激活 ChatGPT 窗口，请确认应用已安装。' });
        }
      });
  }).finally(() => { pending = null; });
  return pending;
}
