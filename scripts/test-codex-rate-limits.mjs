import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCodexRateLimits, readCodexRateLimits } from '../src/main/services/codex-rate-limits.ts';

const window = (minutes, used = 25) => ({ windowDurationMins: minutes, usedPercent: used, resetsAt: 2000000000 });

test('Codex windows are identified by duration and bucket', () => {
  const result = parseCodexRateLimits({
    rateLimits: { primary: window(300, 99) },
    rateLimitsByLimitId: { codex: { primary: window(10080, 42), secondary: window(300, 17) } },
  });
  assert.equal(result.primary.pct, 17);
  assert.equal(result.secondary.pct, 42);
  assert.equal(result.primary.resetMs, 2000000000000);
});

test('Absent, unsupported and invalid windows stay unknown', () => {
  for (const response of [{}, { rateLimits: { primary: window(15) } },
    { rateLimits: { limitId: 'other', primary: window(300) } },
    { rateLimits: { primary: window(300, NaN) } }]) {
    assert.equal(parseCodexRateLimits(response).primary.pct, null);
    assert.equal(parseCodexRateLimits(response).secondary.pct, null);
  }
  assert.equal(parseCodexRateLimits({ rateLimits: { primary: window(300, 0) } }).primary.pct, 0);
  assert.equal(parseCodexRateLimits({ rateLimits: { primary: window(300, 115) } }).primary.pct, 100);
});

test('App-server initialization precedes the quota request and RPC errors reject', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pulse9-rpc-'));
  const server = path.join(dir, 'server.cjs');
  writeFileSync(server, `
const readline = require('node:readline');
let initialized = false;
readline.createInterface({input:process.stdin}).on('line', line => {
 const msg=JSON.parse(line);
 if(msg.method==='initialize') console.log(JSON.stringify({id:msg.id,result:{}}));
 if(msg.method==='initialized') initialized=true;
 if(msg.method==='account/rateLimits/read') {
  console.log(JSON.stringify(initialized && !process.argv.includes('--fail')
    ? {id:msg.id,result:{rateLimits:{primary:{usedPercent:23,windowDurationMins:300,resetsAt:2000000000}}}}
    : {id:msg.id,error:{code:-1,message:'fixture failure'}}));
 }
});`);
  try {
    const result = await readCodexRateLimits(process.execPath, [server]);
    assert.equal(parseCodexRateLimits(result).primary.pct, 23);
    await assert.rejects(readCodexRateLimits(process.execPath, [server, '--fail']), /额度接口不可用/);
    await assert.rejects(readCodexRateLimits(path.join(dir, 'absent.exe')), /找不到 Codex/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
