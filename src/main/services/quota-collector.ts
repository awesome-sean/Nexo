import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pushError } from './error-log';
import { fetchCodexUsage } from './codex-rate-limits';
import { CodexDailyUsage } from './codex-daily-usage';
import type { DailyUsage } from '../../common/daily-usage';

export interface AgentQuota {
  name: string;
  resetText: string;
  /** 7d 窗口的重置倒计时；只有 fromLive 拿得到真值，三条兜底路径一律 null（不许编） */
  reset7dText: string | null;
  pct5h: number | null;
  pct7d: number | null;
  level5h: 'normal' | 'warn' | 'danger';
  level7d: 'normal' | 'warn' | 'danger';
  used5h: number;
  limit5h: number;
  used7d: number;
  limit7d: number;
  unit: 'tokens' | 'steps' | 'percent';
  /** true = 服务端回传的真实额度；false = 本地估算，仅供参考 */
  authoritative: boolean;
  needsAuth?: boolean;
  sampledAt?: number;
  reset5hAt?: number | null;
  reset7dAt?: number | null;
}


interface CodexWindow { used_percent:number; window_minutes:number; resets_at:number }
interface WindowState { pct:number|null; resetMs:number }
type LiveQuota = {primary:WindowState;secondary:WindowState;at:number};
export interface ClusterQuotas { codex:AgentQuota;updatedAt:number;dailyUsage?:DailyUsage|null }
function getLevel(pct: number | null): 'normal' | 'warn' | 'danger' {
  if (pct === null) return 'normal';
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'normal';
}

/**
 * 「还剩多久 · 几点重置」，例：`4h22min · 4:24`。
 * atMs 是重置的绝对时刻，不给就只出时长。
 * 本进程跑在用户本地时区，getHours() 直接就是墙上时间。
 */
function formatCountdown(ms: number, atMs?: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / (60 * 1000)));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const dur = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
  if (!atMs) return dur;
  const d = new Date(atMs);
  return `${dur} · ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** ≥24h 的窗口用「天+小时」，绝对时刻在 6 天外没有意义，不带 */
function formatLongCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  if (totalMin >= 24 * 60) {
    const d = Math.floor(totalMin / (24 * 60));
    const h = Math.floor((totalMin % (24 * 60)) / 60);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  return formatCountdown(ms); // 24h 以内退回老格式（不带绝对时刻）
}


function findLatestCodexRateLimits(): { primary?: CodexWindow; secondary?: CodexWindow } | null {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  if (!fs.existsSync(root)) return null;

  const files: { p: string; m: number }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          files.push({ p, m: fs.statSync(p).mtimeMs });
        } catch {}
      }
    }
  };
  walk(root);

  // 最近改动的文件里，事件时间戳最新的那条 rate_limits 才是当前额度
  files.sort((a, b) => b.m - a.m);
  let best: { ts: number; primary?: CodexWindow; secondary?: CodexWindow } | null = null;

  for (const { p } of files.slice(0, 10)) {
    let lines: string[];
    try {
      lines = fs.readFileSync(p, 'utf-8').split('\n');
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const entry = JSON.parse(lines[i]);
        const rl = entry.payload?.rate_limits;
        if (!rl?.primary) continue;
        const ts = new Date(entry.timestamp).getTime();
        if (!best || ts > best.ts) {
          best = { ts, primary: rl.primary, secondary: rl.secondary };
        }
        break;
      } catch {}
    }
  }

  return best;
}


export class QuotaCollector {
  private dailyUsage = new CodexDailyUsage();
  private cache: ClusterQuotas | null = null;
  private lastFetchTime = 0;
  private live: LiveQuota | null = null;
  private fetching = false;
  private nextTry = 0;
  private backoff = 0;
  private lastSuccessAt = 0;
  constructor(private fetcher = fetchCodexUsage) {}
  getExchangeRate() { return this.dailyUsage.getExchangeRate(); }
  setExchangeRate(rate: unknown) { const value=this.dailyUsage.setExchangeRate(rate);this.cache=null;return value; }
  getQuotaMeta() { return {lastSuccessAt:{codex:this.lastSuccessAt},nextTry:{codex:this.nextTry}}; }
  getQuotas(): ClusterQuotas {
    const now=Date.now();
    if(this.cache && now-this.lastFetchTime<5000) return this.cache;
    this.refresh(now);
    const stored=this.live || this.fromLog(now);
    const primary=stored?.primary && stored.primary.resetMs>now ? stored.primary : {pct:null,resetMs:0};
    const secondary=stored?.secondary && stored.secondary.resetMs>now ? stored.secondary : {pct:null,resetMs:0};
    const codex:AgentQuota={
      name:'GPT',resetText:primary.resetMs ? formatCountdown(primary.resetMs-now,primary.resetMs) : '等待额度数据',
      reset7dText:secondary.resetMs ? formatLongCountdown(secondary.resetMs-now) : null,
      pct5h:primary.pct,pct7d:secondary.pct,level5h:getLevel(primary.pct),level7d:getLevel(secondary.pct),
      used5h:primary.pct ?? 0,used7d:secondary.pct ?? 0,limit5h:100,limit7d:100,unit:'percent',
      authoritative:!!this.live && now-this.live.at<300000,sampledAt:this.live?.at,
      reset5hAt:primary.pct===null ? null : primary.resetMs,reset7dAt:secondary.pct===null ? null : secondary.resetMs,
    };
    this.cache={codex,updatedAt:now,dailyUsage:this.dailyUsage.getSnapshot(now)};
    this.lastFetchTime=now;
    return this.cache;
  }
  private fromLog(now:number): LiveQuota | null {
    const limits=findLatestCodexRateLimits();
    if(!limits) return null;
    const read=(minutes:number):WindowState=>{
      const window=[limits.primary,limits.secondary].find(value=>value?.window_minutes===minutes);
      return window && Number.isFinite(window.used_percent) && window.resets_at*1000>now
        ? {pct:Math.min(100,Math.max(0,Math.round(window.used_percent))),resetMs:window.resets_at*1000}
        : {pct:null,resetMs:0};
    };
    return {primary:read(300),secondary:read(10080),at:0};
  }
  private refresh(now:number):void {
    const used=this.live ? Math.max(this.live.primary.pct ?? 0,this.live.secondary.pct ?? 0) : 0;
    const interval=Math.max(10000,Math.round(30000*(1-used/100)));
    if(this.fetching || now<this.nextTry || (this.live && now-this.live.at<interval)) return;
    this.fetching=true;
    this.fetcher().then(value=>{
      this.live={...value,at:Date.now()};this.lastSuccessAt=this.live.at;this.backoff=0;this.nextTry=0;this.cache=null;
    }).catch(error=>{
      this.backoff=Math.min(this.backoff ? this.backoff*2 : interval,60000);
      this.nextTry=Date.now()+this.backoff;
      pushError('quota','Codex 额度读取失败，请检查 CLI 与登录状态。'+(error instanceof Error ? error.message : ''),'warn');
    }).finally(()=>{this.fetching=false;});
  }
}
