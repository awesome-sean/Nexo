import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { assistantNeedsInput, isBlockingInputTool, isQuotaPause, hookTrafficEvent, applyTrafficEvent, aggregateTraffic } from '../src/common/codex-traffic.ts';
import { CodexTrafficService } from '../src/main/services/codex-traffic-store.ts';

test('optional questions do not become blocked tasks', () => {
  assert.equal(assistantNeedsInput('修改已完成，你想试一下吗？'), false);
  assert.equal(assistantNeedsInput('The implementation is complete. Would you like a preview?'), false);
  assert.equal(assistantNeedsInput('请提供对应文件后继续。'), true);
  assert.equal(isBlockingInputTool('functions.request_user_input'), true);
  assert.equal(isBlockingInputTool('functions.request_user_input_async'), false);
  assert.equal(hookTrafficEvent('PreToolUse', {session_id:'one',tool_name:'functions.request_user_input_async'}).state, 'working');
});

test('quota pauses stay red through Stop and recover when the model resumes', () => {
  const tasks = new Map();
  const send = (name, payload, at) => applyTrafficEvent(tasks, hookTrafficEvent(name, {session_id:'one',...payload}, at));
  send('UserPromptSubmit', {}, 100);
  send('PostModelRequest', {status:'failed',error:"You've hit your usage limit. Try again later."}, 200);
  assert.equal(aggregateTraffic(tasks.values()).state, 'waiting');
  assert.equal(tasks.get('one').waitReason, 'quota');
  send('Stop', {last_assistant_message:''}, 300);
  assert.equal(aggregateTraffic(tasks.values()).state, 'waiting');
  send('PreModelRequest', {}, 400);
  assert.equal(aggregateTraffic(tasks.values()).state, 'working');
  assert.equal(tasks.get('one').waitReason, undefined);
  send('PostModelRequest', {status:'completed',token_usage:{total_tokens:100}}, 500);
  send('Stop', {last_assistant_message:'Completed.'}, 600);
  assert.equal(aggregateTraffic(tasks.values(),600).state, 'done');
});

test('retryable errors and ordinary rate limits do not signal exhausted quota', () => {
  assert.equal(isQuotaPause({codexErrorInfo:'usageLimitExceeded'}), true);
  assert.equal(isQuotaPause({error:{code:'insufficient_quota'}}), true);
  assert.equal(isQuotaPause('额度不足，请稍后重试'), true);
  assert.equal(isQuotaPause({code:'rate_limit_exceeded',message:'Too many requests, retrying'}), false);
  assert.equal(isQuotaPause({httpStatusCode:429}), false);
  assert.equal(hookTrafficEvent('PostModelRequest',{session_id:'one',status:'failed',error:'usage_limit_exceeded',willRetry:true}).state,'working');
  assert.equal(hookTrafficEvent('PostModelRequest',{session_id:'one',status:'cancelled'}),null);
});

test('new JSONL progress releases the matching Hook wait without releasing other tasks or CLI overrides', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'nexo-recovery-'));
  const records = ['one','other','manual'].map(id=>({id,sessionId:id,source:id==='manual'?'cli':'hook',state:'waiting',waitReason:'approval',updatedAt:100}));
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({tasks:records}));
  const service = new CodexTrafficService(directory);
  try {
    const session = id=>({id,agent:'codex',status:'running_tool',updatedAt:200,startedAt:100,durationSeconds:0});
    service.trackSessions([session('one'),session('manual')]);
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')).tasks;
    assert.equal(saved.find(task=>task.id==='one').state,'working');
    assert.equal(saved.find(task=>task.id==='other').state,'waiting');
    assert.equal(saved.find(task=>task.id==='manual').state,'waiting');
  } finally { service.stop(); fs.rmSync(directory,{recursive:true,force:true}); }
});

test('JSONL quota errors and failed completions remain red while recoverable failures remain working', () => {
  const compiled=buildSync({stdin:{contents:"export {CodexSessionTailer} from './src/main/services/codex-tailer.ts';export {SessionManager} from './src/main/services/session-manager.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const module={exports:{}};
  new Function('require','module','exports',compiled)(createRequire(import.meta.url),module,module.exports);
  const manager=new module.exports.SessionManager();
  const tailer=new module.exports.CodexSessionTailer(manager);
  const context={sessionId:'one'};
  const parse=payload=>tailer.parseLine(JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload}),context);
  try {
    parse({type:'task_started'});
    parse({type:'error',codex_error_info:'usageLimitExceeded',message:'Usage limit reached'});
    assert.equal(manager.getSession('one').status,'waiting');
    assert.equal(manager.getSession('one').trafficWaitReason,'quota');
    parse({type:'task_complete',error:{codexErrorInfo:'usageLimitExceeded'}});
    assert.equal(manager.getSession('one').status,'waiting');
    parse({type:'task_started'});
    parse({type:'error',message:'Connection failed',will_retry:true});
    assert.equal(manager.getSession('one').status,'thinking');
    assert.equal(manager.getSession('one').trafficWaitReason,undefined);
  } finally { tailer.stop(); manager.dispose(); }
});

test('horizontal highlights exactly match the new supplied SVGs', () => {
  const source=fs.readFileSync('src/renderer/components/minibar/traffic-artwork.ts','utf8');
  const compiled=buildSync({stdin:{contents:source,loader:'ts'},platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const module={exports:{}};new Function('module','exports',compiled)(module,module.exports);
  const expected = {
  "horizontal": {
    "done": "M164 51.3335C168.246 44.9539 175.768 40.8622 185.666 40.3336",
    "working": "M281.333 51.333C285.579 44.9534 293.102 40.8617 303 40.3331",
    "waiting": "M398.667 51.333C402.913 44.9534 410.435 40.8617 420.333 40.3331"
  },
  "horizontalText": {
    "done": "M215.333 51.333C219.579 44.9535 227.102 40.8617 237 40.3331",
    "working": "M333.333 51.3335C337.579 44.9539 345.102 40.8622 355 40.3336",
    "waiting": "M450.667 51.333C454.913 44.9535 462.435 40.8617 472.333 40.3331"
  }
};
  assert.deepEqual(module.exports.TRAFFIC_HIGHLIGHTS.horizontal,expected.horizontal);
  assert.deepEqual(module.exports.TRAFFIC_HIGHLIGHTS.horizontalText,expected.horizontalText);
  assert.equal(createHash('sha256').update(fs.readFileSync('src/renderer/assets/gpt-floating.png')).digest('hex'),'711ef0f1664db1d99e1a37ff032878777253401a619fdc8e51a252e572b05cc4');
});
