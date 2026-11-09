/**
 * tailer 半行处理自检：写入方还在写的时候，读取方不能把尾部那半行吃掉。
 * 跑法：node scripts/test-tailer-partial-line.mjs
 *
 * tailer 原先采用「每 500ms 读一次 + 把位置推进到 stat.size」。如果读取时对方正写到一半，
 * 尾部那半行 JSON.parse 必然失败，而位置已经推到文件末尾 —— 这一行永远不会再被读，
 * 会话开始 / 结束事件就这样漏掉；多字节 UTF-8 被切在读取边界上还会变成乱码。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexSessionTailer } from '../src/main/services/codex-tailer.ts';

/** 假 SessionManager：只记录调用，不碰真实状态 */
const makeSM = () => {
  const calls = [];
  return {
    calls,
    updateSession: (id, agent, patch) => calls.push({ kind: 'update', id, agent, patch }),
    completeSession: (id, msg) => calls.push({ kind: 'complete', id, msg }),
    failSession: (id, msg) => calls.push({ kind: 'fail', id, msg }),
  };
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-tailer-test-'));

// Codex：同一套「半行 → 补全」流程
{
  const root = path.join(tmpDir, 'codex');
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'session.jsonl');
  const sm = makeSM();
  const tailer = new CodexSessionTailer(sm, root);

  const line = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'hello world' },
  });

  fs.writeFileSync(file, line.slice(0, 25), 'utf8');
  tailer.readNewLines(file);
  assert.equal(sm.calls.length, 0, '半行不能被解析成事件');

  fs.appendFileSync(file, line.slice(25) + '\n', 'utf8');
  tailer.readNewLines(file);
  assert.equal(sm.calls.length, 1, '补全后应恰好解析出一次事件');
  assert.equal(sm.calls[0].id, 'codex-active');
  assert.equal(sm.calls[0].agent, 'codex');
  assert.equal(sm.calls[0].patch.lastMessage, 'hello world');

  tailer.readNewLines(file);
  assert.equal(sm.calls.length, 1, '没有新数据时不能重复解析');
  tailer.stop();
}

// A record larger than the read buffer must preserve UTF-8 and await its final newline.
{
  const file = path.join(tmpDir, 'chunked.jsonl');
  const sm = makeSM();
  const tailer = new CodexSessionTailer(sm, tmpDir);
  const parsed = [];
  const parseLine = tailer.parseLine.bind(tailer);
  tailer.parseLine = (line, context) => { parsed.push(JSON.parse(line)); parseLine(line, context); };
  const message = '跨块文字🙂'.repeat(40000);
  const record = JSON.stringify({type:'event_msg',payload:{type:'agent_message',message}});
  const bytes = Buffer.from(record + '\n');
  fs.writeFileSync(file, bytes.subarray(0, bytes.length - 2));
  tailer.readFullFile(file);
  assert.equal(sm.calls.length, 0, 'initial partial records must wait for completion');
  fs.appendFileSync(file, bytes.subarray(bytes.length - 2));
  tailer.readNewLines(file);
  assert.equal(sm.calls.length, 1, 'a large record must be parsed exactly once');
  assert.equal(parsed[0].payload.message, message, 'UTF-8 must survive buffer boundaries');
  assert.equal(sm.calls[0].patch.lastMessage, message.slice(-1000), 'retain the existing preview length');
  tailer.readNewLines(file);
  assert.equal(sm.calls.length, 1);
  tailer.stop();
}
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('✅ tailer 半行自检通过（Codex）');
