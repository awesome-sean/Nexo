import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import type { DailyUsage } from '../../common/daily-usage.ts';
import { getCoreLocalAppData } from './pulse-core-client.ts';
import { pushError } from './error-log.ts';

// USD per million tokens, Standard API equivalent. Verified 2026-11-06.
// https://developers.openai.com/api/docs/pricing
// Cache writes use the published 30-minute retention price.
const PRICES: Record<string, { input: number; cached: number; write: number; output: number; long: boolean }> = {
  'gpt-6.1-sol': { input: 2, cached: 0.1, write: 2.5, output: 10, long: true },
  'gpt-6.1-terra': { input: 1, cached: 0.05, write: 1.25, output: 5, long: true },
  'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50, long: true },
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5, long: true },
  'gpt-5.3-codex': { input: 1.75, cached: 0.175, write: 0, output: 14, long: false },
};

interface Tokens {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens?: number;
  output_tokens: number;
}

function validTokens(value: any): value is Tokens {
  return value && ['input_tokens', 'cached_input_tokens', 'output_tokens'].every(
    (key) => Number.isFinite(value[key]) && value[key] >= 0,
  ) && (value.cache_write_input_tokens === undefined ||
    (Number.isFinite(value.cache_write_input_tokens) && value.cache_write_input_tokens >= 0)) &&
    value.cached_input_tokens + (value.cache_write_input_tokens ?? 0) <= value.input_tokens;
}

export function estimateRequestUsd(model: string, tokens: Tokens, requestInput = tokens.input_tokens): number | null {
  const canonical = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const price = PRICES[canonical];
  if (!price || !validTokens(tokens) || ((tokens.cache_write_input_tokens ?? 0) > 0 && !price.write)) return null;
  const inputFactor = price.long && requestInput > 272000 ? 2 : 1;
  const outputFactor = inputFactor === 2 ? 1.5 : 1;
  const writes = tokens.cache_write_input_tokens ?? 0;
  const uncached = tokens.input_tokens - tokens.cached_input_tokens - writes;
  // Reasoning output is already included in output_tokens.
  return ((uncached * price.input + tokens.cached_input_tokens * price.cached + writes * price.write) * inputFactor +
    tokens.output_tokens * price.output * outputFactor) / 1_000_000;
}

export function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function collectDailyUsage(roots: string[], now: Date, exchangeRate: number): Promise<DailyUsage> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const result: DailyUsage = {
    date: localDate(now), cny: null, usd: null, exchangeRate, inputTokens: 0,
    cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, pricedRequests: 0,
    unpricedRequests: 0, incomplete: false, updatedAt: now.getTime(),
  };
  const files: string[] = [];
  let available = false;
  const walk = async (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); available = true; }
    catch (error: any) { if (error.code !== 'ENOENT') result.incomplete = true; return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && file.endsWith('.jsonl')) {
        try { if ((await fs.promises.stat(file)).mtimeMs >= start) files.push(file); }
        catch { result.incomplete = true; }
      }
    }
  };
  for (const root of roots) await walk(root);
  const seen = new Set<string>();
  let usd = 0;
  for (const file of files) {
    let model = '';
    let turnId = '';
    let sessionId = file;
    let previous: Tokens | null = null;
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    input.on('error', () => { result.incomplete = true; lines.close(); });
    try {
      for await (const line of lines) {
        if (!line.includes('token_count') && !line.includes('turn_context') && !line.includes('session_meta')) continue;
        let event: any;
        try { event = JSON.parse(line); } catch { result.incomplete = true; continue; }
        const payload = event.payload;
        if (event.type === 'session_meta') sessionId = payload?.id ?? payload?.session_id ?? file;
        if (event.type === 'turn_context') { model = payload?.model ?? ''; turnId = payload?.turn_id ?? ''; }
        if (event.type !== 'event_msg' || payload?.type !== 'token_count' || !payload.info) continue;
        const total = payload.info.total_token_usage;
        const last = payload.info.last_token_usage;
        const sameTotal = validTokens(total) && previous &&
          ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens'].every(
            (key) => (total[key as keyof Tokens] ?? 0) === (previous![key as keyof Tokens] ?? 0),
          );
        const old = previous;
        if (validTokens(total)) previous = total;
        const timestamp = new Date(event.timestamp).getTime();
        if (sameTotal || !Number.isFinite(timestamp) || timestamp < start || timestamp >= end || timestamp > now.getTime()) continue;
        const fingerprint = createHash('sha256').update(JSON.stringify([
          turnId || sessionId, event.timestamp, total, last,
        ])).digest('hex');
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        if (!validTokens(last)) { result.unpricedRequests++; result.incomplete = true; continue; }
        let usage = last;
        if (validTokens(total)) {
          const delta = {
            input_tokens: total.input_tokens - (old?.input_tokens ?? 0),
            cached_input_tokens: total.cached_input_tokens - (old?.cached_input_tokens ?? 0),
            cache_write_input_tokens: (total.cache_write_input_tokens ?? 0) - (old?.cache_write_input_tokens ?? 0),
            output_tokens: total.output_tokens - (old?.output_tokens ?? 0),
          };
          if (old && validTokens(delta) && Object.keys(delta).every(
            (key) => delta[key as keyof Tokens] <= (last[key as keyof Tokens] ?? 0),
          )) usage = delta;
          // A counter gap can contain requests with unknown model attribution.
          else if (validTokens(delta) && Object.keys(delta).some(
            (key) => delta[key as keyof Tokens] !== (last[key as keyof Tokens] ?? 0),
          )) result.incomplete = true;
        }
        result.inputTokens += usage.input_tokens;
        result.cachedInputTokens += usage.cached_input_tokens;
        result.cacheWriteTokens += usage.cache_write_input_tokens ?? 0;
        result.outputTokens += usage.output_tokens;
        const cost = estimateRequestUsd(model, usage, last.input_tokens);
        if (cost === null) { result.unpricedRequests++; result.incomplete = true; }
        else { usd += cost; result.pricedRequests++; }
      }
    } catch { result.incomplete = true; }
    finally { lines.close(); input.destroy(); }
  }
  if (available && (result.pricedRequests > 0 || result.unpricedRequests === 0)) {
    result.usd = usd;
    result.cny = usd * exchangeRate;
  }
  return result;
}

export class CodexDailyUsage {
  private snapshot: DailyUsage | null = null;
  private fetching = false;
  private rate = 7;
  private readonly settingsFile: string;

  constructor(settingsFile = path.join(getCoreLocalAppData(), 'usage-settings.json')) {
    this.settingsFile = settingsFile;
    try {
      const rate = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).exchangeRate;
      if (Number.isFinite(rate) && rate > 0 && rate <= 1000) this.rate = rate;
    } catch { /* Use the documented manual default of 7.00 CNY per USD. */ }
  }

  getExchangeRate(): number { return this.rate; }

  setExchangeRate(rate: unknown): number {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new Error('汇率须大于 0 且不超过 1000');
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    const temp = this.settingsFile + `.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ exchangeRate: rate }) + '\n');
      fs.renameSync(temp, this.settingsFile);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    this.rate = rate;
    if (this.snapshot) this.snapshot = { ...this.snapshot, exchangeRate: rate,
      cny: this.snapshot.usd === null ? null : this.snapshot.usd * rate };
    return rate;
  }

  getSnapshot(now = Date.now()): DailyUsage | null {
    const date = localDate(new Date(now));
    if (!this.fetching && (!this.snapshot || this.snapshot.date !== date || now - this.snapshot.updatedAt >= 30000)) {
      this.fetching = true;
      const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
      void collectDailyUsage([path.join(home, 'sessions'), path.join(home, 'archived_sessions')], new Date(now), this.rate)
        .then((result) => { this.snapshot = { ...result, exchangeRate: this.rate, cny: result.usd === null ? null : result.usd * this.rate }; })
        .catch(() => { this.snapshot = null; pushError('quota', '本机 Token 日志读取失败，费用估算暂不可用', 'warn'); })
        .finally(() => { this.fetching = false; });
    }
    return this.snapshot?.date === date ? this.snapshot : null;
  }
}

