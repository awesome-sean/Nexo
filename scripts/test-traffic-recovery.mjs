import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { assistantNeedsInput, isBlockingInputTool, isQuotaPause, hookTrafficEvent, applyTrafficEvent, aggregateTraffic, APPROVAL_GRACE_MS } from '../src/common/codex-traffic.ts';
import { CodexTrafficService, enqueueTraffic, readTrafficTasks } from '../src/main/services/codex-traffic-store.ts';

test('direct questions and asynchronous question tools require attention', () => {
  assert.equal(assistantNeedsInput('修改已完成，你想试一下吗？'), true);
  assert.equal(assistantNeedsInput('The implementation is complete. Would you like a preview?'), true);
  assert.equal(assistantNeedsInput('请提供对应文件后继续。'), true);
  assert.equal(isBlockingInputTool('functions.request_user_input'), true);
  assert.equal(isBlockingInputTool('functions.request_user_input_async'), true);
  assert.equal(hookTrafficEvent('PreToolUse', {session_id:'one',tool_name:'functions.request_user_input_async'}).state, 'waiting');
  assert.equal(assistantNeedsInput('修改已完成，可以在设置页面查看。'), false);
});

test('unanswered questions stay red through unrelated hooks and settle independently', () => {
  const tasks=new Map();
  const send=(name,payload,at)=>{
    const event=hookTrafficEvent(name,{session_id:'one',...payload},at);
    if(event)applyTrafficEvent(tasks,event);
  };
  send('PreToolUse',{tool_name:'request_user_input_async',tool_use_id:'card',tool_input:{questions:[{},{}]}},1000);
  send('PostToolUse',{tool_name:'request_user_input_async',tool_use_id:'card'},1100);
  send('PreToolUse',{tool_name:'Bash',tool_use_id:'background'},1200);
  send('PostToolUse',{tool_name:'Bash',tool_use_id:'background'},1300);
  send('PreModelRequest',{},1400);
  send('Stop',{last_assistant_message:'已显示问题，请选择。'},1500);
  assert.equal(aggregateTraffic(tasks.values()).state,'waiting');
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'working',at:1600,inputResolved:['card:0']});
  assert.equal(aggregateTraffic(tasks.values()).state,'waiting');
  assert.deepEqual(tasks.get('one').pendingInputIds,['card:1']);
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'working',at:1700,inputResolved:['card:1']});
  assert.equal(aggregateTraffic(tasks.values()).state,'working');
  send('Stop',{last_assistant_message:'已完成。'},1800);
  assert.equal(aggregateTraffic(tasks.values(),1800).state,'done');
  send('PreToolUse',{tool_name:'request_user_input_async',tool_use_id:'card',tool_input:{questions:[{},{}]}},1900);
  assert.equal(aggregateTraffic(tasks.values(),1900).state,'done','late duplicate hooks cannot reopen answered questions');
});

function questionHarness() {
  const compiled=buildSync({stdin:{contents:"export {CodexSessionTailer} from './src/main/services/codex-tailer.ts';export {SessionManager} from './src/main/services/session-manager.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const module={exports:{}};
  new Function('require','module','exports',compiled)(createRequire(import.meta.url),module,module.exports);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexo-question-'));
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({tasks:[{id:'question-thread',sessionId:'question-thread',source:'hook',state:'working',updatedAt:0}]}));
  const traffic=new CodexTrafficService(directory);
  const manager=new module.exports.SessionManager();
  const tailer=new module.exports.CodexSessionTailer(manager);
  manager.on('update',sessions=>traffic.trackSessions(sessions));
  const context={sessionId:'question-thread'};
  let at=Date.now();
  return {
    send(type,payload){tailer.parseLine(JSON.stringify({type,timestamp:new Date(++at).toISOString(),payload}),context);},
    state:()=>traffic.getSnapshot().state,
    hook(name,payload={}){enqueueTraffic(hookTrafficEvent(name,{session_id:'question-thread',...payload},++at),directory);traffic.drain();},
    tasks:()=>[...readTrafficTasks(directory).values()],
    reply(callId,index){return `<send_user_message_question_reply>\n${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,index]),answer:'选项一'}])}\n</send_user_message_question_reply>`;},
    close(){tailer.stop();manager.dispose();traffic.stop();fs.rmSync(directory,{recursive:true,force:true});}
  };
}

test('real async accepted acknowledgements and partial card replies drive both shared consumers', () => {
  const app=questionHarness();
  try {
    app.send('response_item',{type:'function_call',name:'request_user_input_async',call_id:'card',arguments:JSON.stringify({questions:[{title:'请选择配色',options:['绿','紫']},{title:'请输入名称'}]})});
    assert.equal(app.state(),'waiting','an explicit JSONL question can override an authoritative working Hook');
    app.send('response_item',{type:'function_call_output',call_id:'card',output:'{"accepted":true}'});
    app.send('response_item',{type:'reasoning'});
    app.send('response_item',{type:'function_call',name:'exec_command',call_id:'other',arguments:'{}'});
    app.send('response_item',{type:'function_call_output',call_id:'other',output:'finished'});
    app.send('event_msg',{type:'task_complete',last_agent_message:'等待你的选择。'});
    assert.equal(app.state(),'waiting');
    app.send('response_item',{type:'message',role:'user',content:[{type:'input_text',text:app.reply('card',0)}]});
    assert.equal(app.state(),'waiting','the second card still needs an answer');
    app.send('event_msg',{type:'user_message',message:app.reply('card',1)});
    assert.equal(app.state(),'working');
    app.send('response_item',{type:'reasoning'});
    assert.equal(app.state(),'working');
  } finally {app.close();}
});

test('failed question delivery and a fresh turn clear pending cards', () => {
  const app=questionHarness();
  try {
    app.send('response_item',{type:'function_call',name:'request_user_input_async',call_id:'rejected',arguments:'{}'});
    assert.equal(app.state(),'waiting');
    app.send('response_item',{type:'function_call_output',call_id:'rejected',output:'{"accepted":false,"error":"cancelled"}'});
    assert.equal(app.state(),'working');
    app.send('response_item',{type:'function_call',name:'request_user_input_async',call_id:'cancelled',arguments:'{}'});
    app.send('event_msg',{type:'turn_aborted'});
    assert.equal(app.state(),'idle');
    app.send('event_msg',{type:'task_started'});
    assert.equal(app.state(),'working');
  } finally {app.close();}
});

test('question replies resolve even when a delayed Hook has a newer timestamp', () => {
  const tasks=new Map();
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'hook',state:'waiting',waitReason:'input',inputOpened:['card:0'],at:2000});
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'working',inputResolved:['card:0'],at:1900});
  assert.equal(tasks.get('one').state,'working');
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'hook',state:'waiting',waitReason:'input',inputOpened:['card:0'],at:2100});
  assert.equal(tasks.get('one').state,'working');
});

test('a Hook without a call ID cannot leave a second unanswered phantom question', () => {
  const tasks=new Map();
  applyTrafficEvent(tasks,hookTrafficEvent('PreToolUse',{session_id:'one',tool_name:'request_user_input_async'},1000));
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'waiting',waitReason:'input',inputOpened:['actual-card:0'],at:1100});
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'working',inputResolved:['actual-card:0'],at:1200});
  assert.equal(tasks.get('one').state,'working');
  assert.equal(tasks.get('one').pendingInputIds,undefined);
});

test('answering a question cannot clear a concurrent quota pause', () => {
  const tasks=new Map();
  applyTrafficEvent(tasks,hookTrafficEvent('PreToolUse',{session_id:'one',tool_name:'request_user_input_async',tool_use_id:'card'},1000));
  applyTrafficEvent(tasks,hookTrafficEvent('PostModelRequest',{session_id:'one',status:'failed',error:'insufficient_quota'},1100));
  applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'working',inputResolved:['card:0'],at:1200});
  assert.equal(tasks.get('one').state,'waiting');
  assert.equal(tasks.get('one').waitReason,'quota');
  applyTrafficEvent(tasks,hookTrafficEvent('PreModelRequest',{session_id:'one'},1300));
  assert.equal(tasks.get('one').state,'working');
});

test('automatic approvals and recoverable failures do not flash the red user-attention signal', () => {
  const tasks=new Map();
  applyTrafficEvent(tasks,hookTrafficEvent('PermissionRequest',{session_id:'one'},1000));
  assert.equal(aggregateTraffic(tasks.values(),1000).state,'working');
  assert.equal(aggregateTraffic(tasks.values(),1000+APPROVAL_GRACE_MS-1).state,'working');
  assert.equal(aggregateTraffic(tasks.values(),1000+APPROVAL_GRACE_MS).state,'waiting');
  applyTrafficEvent(tasks,hookTrafficEvent('PostToolUse',{session_id:'one'},1100));
  assert.equal(aggregateTraffic(tasks.values(),1000+APPROVAL_GRACE_MS).state,'working');
  const app=questionHarness();
  try {
    app.send('event_msg',{type:'task_started'});
    app.send('event_msg',{type:'error',message:'Connection interrupted, reconnecting'});
    assert.equal(app.state(),'working');
    app.send('event_msg',{type:'error',code:'insufficient_quota'});
    assert.equal(app.state(),'waiting','quota exhaustion still requires attention immediately');
  } finally {app.close();}
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


test('long automatic approval remains yellow while explicit questions, quota and manual approval stay red', () => {
  const app=questionHarness();
  try {
    app.send('turn_context',{approvals_reviewer:'auto_review'});
    app.send('response_item',{type:'custom_tool_call',name:'exec_command',call_id:'long-command',input:'long running build'});
    app.hook('PermissionRequest');
    assert.equal(aggregateTraffic(app.tasks(),Date.now()+600000).state,'working','real JSONL reviewer context must suppress automatic-approval red');
    const directoryTask={id:'question-thread',sessionId:'question-thread',source:'hook',state:'waiting',waitReason:'approval',updatedAt:1,approvalsReviewer:'auto_review'};
    assert.equal(aggregateTraffic([directoryTask],600001).state,'working','a ten-minute command must never become a user approval request');
    assert.equal(aggregateTraffic([{...directoryTask,approvalsReviewer:'user'}],600001).state,'waiting');
    assert.equal(aggregateTraffic([{...directoryTask,waitReason:'input'}],600001).state,'waiting');
    assert.equal(aggregateTraffic([{...directoryTask,waitReason:'quota'}],600001).state,'waiting');
    app.send('response_item',{type:'function_call',name:'request_user_input_async',call_id:'confirm',arguments:'{}'});
    assert.equal(app.state(),'waiting');
    app.send('event_msg',{type:'user_message',message:app.reply('confirm',0)});
    assert.equal(app.state(),'working');
  } finally {app.close();}
});

test('late turn context annotates a pending Hook without replaying old session activity', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexo-reviewer-'));
  const records=[{id:'one',sessionId:'one',source:'hook',state:'waiting',waitReason:'approval',updatedAt:200},
    {id:'one:child',sessionId:'one',source:'hook',state:'waiting',waitReason:'approval',updatedAt:201}];
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({tasks:records}));
  const service=new CodexTrafficService(directory);
  try {
    service.trackSessions([{id:'one',agent:'codex',status:'running_tool',approvalsReviewer:'auto_review',updatedAt:100,startedAt:100,durationSeconds:0}]);
    assert.equal(service.getSnapshot().state,'working');
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')).tasks;
    assert.ok(saved.every(task=>task.approvalsReviewer==='auto_review'));
    assert.equal(saved[0].updatedAt,200,'old context must not rewrite the Hook event timestamp');
    service.trackSessions([{id:'one',agent:'codex',status:'running_tool',approvalsReviewer:'user',updatedAt:250,startedAt:100,durationSeconds:0}]);
    assert.equal(service.getSnapshot().state,'waiting','switching to manual approvals keeps the actual child request visible');
  } finally {service.stop();fs.rmSync(directory,{recursive:true,force:true});}
});


test('only unknown approval requests use the ten-second fallback', () => {
  const task={id:'request',sessionId:'request',source:'hook',state:'waiting',waitReason:'approval',updatedAt:1000};
  assert.equal(APPROVAL_GRACE_MS,10000);
  assert.equal(aggregateTraffic([task],10999).state,'working');
  assert.equal(aggregateTraffic([task],11000).state,'waiting');
  assert.equal(aggregateTraffic([{...task,approvalsReviewer:'user'}],1000).state,'waiting','confirmed human review is immediate');
  assert.equal(aggregateTraffic([{...task,approvalsReviewer:'auto_review'}],601000).state,'working');
  const tasks=new Map([[task.id,task]]);
  applyTrafficEvent(tasks,hookTrafficEvent('PreToolUse',{session_id:'request',tool_name:'exec_command'},5000));
  assert.equal(aggregateTraffic(tasks.values(),601000).state,'working','the fallback stops once execution begins');
});
