import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

interface RateWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

interface RateBucket {
  limitId?: string;
  primary?: RateWindow | null;
  secondary?: RateWindow | null;
}

export interface CodexRateResponse {
  rateLimits?: RateBucket | null;
  rateLimitsByLimitId?: Record<string, RateBucket> | null;
}

export function parseCodexRateLimits(response: CodexRateResponse) {
  // Only the Codex bucket can describe the user's Codex quota.
  const bucket = response.rateLimitsByLimitId?.codex ??
    (!response.rateLimits?.limitId || response.rateLimits.limitId === 'codex' ? response.rateLimits : null);
  const windows = [bucket?.primary, bucket?.secondary];
  const read = (minutes: number) => {
    const window = windows.find((item) => item?.windowDurationMins === minutes);
    if (!window || !Number.isFinite(window.usedPercent) ||
        !Number.isFinite(window.resetsAt) || window.resetsAt <= 0) {
      return { pct: null, resetMs: 0 };
    }
    return {
      pct: Math.round(Math.min(100, Math.max(0, window.usedPercent))),
      resetMs: window.resetsAt * 1000,
    };
  };
  return { primary: read(300), secondary: read(10080) };
}

function codexCommand(): string {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  // The desktop app bundles an executable even when the CLI is absent from PATH.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = fs.readdirSync(root)
        .map((name) => path.join(root, name, 'codex.exe'))
        .filter((file) => fs.existsSync(file))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates[0]) return candidates[0];
    } catch { /* A standalone CLI can still be available. */ }
  }
  return 'codex';
}

export function readCodexRateLimits(command = codexCommand(), args = ['app-server']): Promise<CodexRateResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    const finish = (error: Error | null, result?: CodexRateResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Codex 额度读取超时')), 20_000);
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', () => finish(new Error('找不到 Codex CLI，请安装 CLI 或设置 CODEX_CLI_PATH')));
    child.stdin.on('error', () => finish(new Error('Codex app-server 输入通道已关闭')));
    child.on('exit', () => finish(new Error('Codex app-server 提前退出，请检查登录状态')));
    lines.on('line', (line) => {
      let message: any;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new Error('Codex 额度接口不可用，请检查 CLI 版本与 ChatGPT 登录状态'));
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else if (message.result && typeof message.result === 'object') {
        finish(null, message.result);
      } else {
        finish(new Error('Codex 额度响应格式无效'));
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'nexo_band9', title: 'Nexo', version: '0.3.0' },
    } });
  });
}

export async function fetchCodexUsage() {
  return parseCodexRateLimits(await readCodexRateLimits());
}
