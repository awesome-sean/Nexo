import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateRequestUsd, collectDailyUsage, CodexDailyUsage } from '../src/main/services/codex-daily-usage.ts';

const tokens = (input, cached = 0, output = 10, write = 0) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output,
  reasoning_output_tokens: 5,
});

test('Request cost separates cache hits and writes and counts reasoning inside output', () => {
  const value = estimateRequestUsd('gpt-6.1-sol', tokens(100000, 70000, 10000, 10000));
  assert.equal(value, (20000 * 2 + 70000 * 0.1 + 10000 * 2.5 + 10000 * 10) / 1e6);
  assert.equal(estimateRequestUsd('unknown-model', tokens(10)), null);
  assert.equal(estimateRequestUsd('gpt-6.1-sol', tokens(100, 101)), null);
  assert.equal(estimateRequestUsd('gpt-6.1-sol', tokens(NaN)), null);
});

test('Long-context API equivalent uses whole-request multipliers', () => {
  assert.equal(estimateRequestUsd('gpt-6.1-sol', tokens(272000, 200000, 100)), (72000 * 2 + 200000 * 0.1 + 100 * 10) / 1e6);
  assert.equal(estimateRequestUsd('gpt-6.1-sol-2026-10-01', tokens(300000, 200000, 100)), ((100000 * 2 + 200000 * 0.1) * 2 + 100 * 10 * 1.5) / 1e6);
});

test('Daily logs deduplicate repeated cumulative snapshots and copied fork prefixes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-usage-'));
  const now = new Date(2026, 10, 6, 12);
  const before = new Date(2026, 10, 5, 23, 59).toISOString();
  const first = new Date(2026, 10, 6, 1).toISOString();
  const second = new Date(2026, 10, 6, 2).toISOString();
  const record = (timestamp, total, last) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
  const context = { type: 'turn_context', payload: { model: 'gpt-6.1-sol', turn_id: 'same-inherited-turn' } };
  const earlier = record(before, tokens(100, 10, 10), tokens(100, 10, 10));
  const current = record(first, tokens(300, 60, 30), tokens(200, 50, 20));
  const unknown = record(second, tokens(400, 60, 40), tokens(100, 0, 10));
  try {
    fs.writeFileSync(path.join(dir, 'original.jsonl'), [context, earlier, current, current,
      { type: 'turn_context', payload: { model: 'unknown', turn_id: 'second' } }, unknown].map(JSON.stringify).join('\n'));
    fs.writeFileSync(path.join(dir, 'fork.jsonl'), [context, earlier, current].map(JSON.stringify).join('\n'));
    for (const file of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, file), now, now);
    const result = await collectDailyUsage([dir], now, 7);
    assert.equal(result.inputTokens, 300);
    assert.equal(result.cachedInputTokens, 50);
    assert.equal(result.outputTokens, 30);
    assert.equal(result.pricedRequests, 1);
    assert.equal(result.unpricedRequests, 1);
    assert.equal(result.incomplete, true);
    assert.equal(result.usd, estimateRequestUsd('gpt-6.1-sol', tokens(200, 50, 20)));
    assert.equal(result.cny, result.usd * 7);
    assert.equal(result.date, '2026-11-06');
    assert.equal((await collectDailyUsage([path.join(dir, 'absent')], now, 7)).cny, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Exchange rate is validated and persists in the selected settings file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fx-'));
  try {
    const file = path.join(dir, 'settings.json');
    const service = new CodexDailyUsage(file);
    assert.equal(service.getExchangeRate(), 7);
    assert.equal(service.setExchangeRate(7.25), 7.25);
    assert.equal(new CodexDailyUsage(file).getExchangeRate(), 7.25);
    for (const invalid of [NaN, Infinity, 0, -1, 1001, '7']) assert.throws(() => service.setExchangeRate(invalid));
    assert.equal(service.getExchangeRate(), 7.25);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A streaming snapshot adds only the cumulative delta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-stream-'));
  const now = new Date(2026, 10, 6, 12);
  const usage = (hour, total, last) => ({ timestamp: new Date(2026, 10, 6, hour).toISOString(),
    type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
  try {
    fs.writeFileSync(path.join(dir, 'rollout.jsonl'), [
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol', turn_id: 'stream' } },
      usage(1, tokens(100, 50, 10), tokens(100, 50, 10)),
      usage(2, tokens(100, 50, 20), tokens(100, 50, 20)),
    ].map(JSON.stringify).join('\n'));
    fs.utimesSync(path.join(dir, 'rollout.jsonl'), now, now);
    const result = await collectDailyUsage([dir], now, 7);
    assert.equal(result.inputTokens, 100);
    assert.equal(result.outputTokens, 20);
    assert.equal(result.incomplete, false);
    assert.equal(result.usd, estimateRequestUsd('gpt-6.1-sol', tokens(100, 50, 20)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
