import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {aggregateTraffic,applyTrafficEvent,hookTrafficEvent,DONE_DURATION_MS,APPROVAL_GRACE_MS} from '../src/common/codex-traffic.ts';
import {enqueueTraffic,readTrafficSnapshot,CodexTrafficService} from '../src/main/services/codex-traffic-store.ts';
import {CodexHookInstaller,CODEX_HOOK_EVENTS} from '../src/main/services/codex-hook-install.ts';

const task=(id,state,updatedAt=1000)=>({id,sessionId:id,state,source:'hook',updatedAt});
function environment(run){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexo-codex-traffic-'));return Promise.resolve().then(()=>run(directory)).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));}

test('task priority, completion expiry and independent subagent completion',()=>{
 const tasks=new Map();
 for(const value of [task('a','done'),task('b','working'),task('c','waiting')]) tasks.set(value.id,value);
 assert.equal(aggregateTraffic(tasks.values(),2000).state,'waiting');
 tasks.delete('c');assert.equal(aggregateTraffic(tasks.values(),2000).state,'working');
 tasks.delete('b');assert.equal(aggregateTraffic(tasks.values(),1000+DONE_DURATION_MS-1).state,'done');
 assert.equal(aggregateTraffic(tasks.values(),1000+DONE_DURATION_MS).state,'idle');
 applyTrafficEvent(tasks,hookTrafficEvent('UserPromptSubmit',{session_id:'root'},5000));
 applyTrafficEvent(tasks,hookTrafficEvent('SubagentStop',{session_id:'root',agent_id:'child',last_assistant_message:'Done.'},5001));
 assert.equal(aggregateTraffic(tasks.values(),5002).state,'working');
 assert.equal(hookTrafficEvent('SubagentStop',{session_id:'root'}),null);
});

test('permission and input hooks require attention, tool results resume, explicit interruptions clear the session',()=>{
 const tasks=new Map();
 const update=(event,payload={})=>applyTrafficEvent(tasks,hookTrafficEvent(event,{session_id:'one',...payload},Date.now()));
 update('UserPromptSubmit');assert.equal(aggregateTraffic(tasks.values()).state,'working');
 update('PermissionRequest');assert.equal(aggregateTraffic(tasks.values()).state,'working');
 assert.equal(aggregateTraffic(tasks.values(),Date.now()+APPROVAL_GRACE_MS).state,'waiting');
 update('PostToolUse');assert.equal(aggregateTraffic(tasks.values()).state,'working');
 update('PreToolUse',{tool_name:'functions.request_user_input'});assert.equal(aggregateTraffic(tasks.values()).state,'waiting');
 update('PostToolUse',{tool_name:'functions.request_user_input'});
 update('Stop',{last_assistant_message:'请提供对应文件后继续。'});assert.equal(aggregateTraffic(tasks.values()).state,'waiting');
 update('Stop',{last_assistant_message:'Please confirm the target directory.'});assert.equal(aggregateTraffic(tasks.values()).state,'waiting');
 update('Stop',{last_assistant_message:'Implementation completed.'});assert.equal(aggregateTraffic(tasks.values()).state,'done');
 update('Interrupt');assert.equal(aggregateTraffic(tasks.values()).state,'idle');
});

test('parallel CLI producers enqueue tasks without overwriting one another',()=>environment(async directory=>{
 const send=(state,id)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['assets/nexo-cli.cjs',state,'--task',id,'--data-dir',directory],{stdio:'ignore',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('CLI failed')));
 });
 await Promise.all([send('working','a'),send('waiting','b'),send('done','c')]);
 assert.equal(readTrafficSnapshot(directory).state,'waiting');
 const service=new CodexTrafficService(directory);service.start();
 try {assert.equal(service.getSnapshot().state,'waiting');assert.equal(service.getSnapshot().counts.working,1);assert.equal(service.getSnapshot().counts.done,1);}finally{service.stop();}
}));

test('a committed clear event is not replayed against newer tasks after a crash',()=>environment(directory=>{
 const event={id:'clear',sessionId:'clear',source:'cli',at:100,clear:true};
 enqueueTraffic(event,directory);
 const [file]=fs.readdirSync(path.join(directory,'events'));
 fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({version:1,tasks:[task('same-millisecond','working',100)],receipts:[file]}));
 assert.equal(readTrafficSnapshot(directory).state,'working');
 const service=new CodexTrafficService(directory);service.start();
 try{assert.equal(service.getSnapshot().state,'working');}finally{service.stop();}
}));

test('hook installation preserves unrelated commands, is idempotent and removes only Nexo handlers',()=>environment(directory=>{
 const home=path.join(directory,'codex');fs.mkdirSync(home);
 const file=path.join(home,'hooks.json');
 const unrelated={type:'command',command:'existing-command',timeout:10};
 fs.writeFileSync(file,JSON.stringify({description:'existing',hooks:{Stop:[{hooks:[unrelated]}]}}));
 const installer=new CodexHookInstaller(path.resolve('assets/nexo-cli.cjs'),path.join(directory,'中文 hooks'),process.execPath,home);
 assert.equal(installer.install().installed,true);assert.equal(installer.install().installed,true);
 const installed=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(installed.description,'existing');assert.deepEqual(installed.hooks.Stop[0].hooks,[unrelated]);
 for(const event of CODEX_HOOK_EVENTS) assert.equal(installed.hooks[event].flatMap(group=>group.hooks).filter(handler=>handler.statusMessage==='Nexo Codex 状态灯').length,1);
 assert.equal(installer.remove().installed,false);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).hooks.Stop,[{hooks:[unrelated]}]);
 fs.writeFileSync(file,'{broken');assert.throws(()=>installer.install());assert.equal(fs.readFileSync(file,'utf8'),'{broken');
}));

// The JSONL fallback must not relabel historical activity as happening now.
test('JSONL input requests enter waiting and preserve original event timestamps',async()=>{
 const {build}=await import('esbuild');
 const result=await build({stdin:{contents:"export {CodexSessionTailer} from './src/main/services/codex-tailer.ts'; export {SessionManager} from './src/main/services/session-manager.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
 const {createRequire}=await import('node:module');
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const {CodexSessionTailer,SessionManager}=module.exports;
 const manager=new SessionManager();const tailer=new CodexSessionTailer(manager);
 const context={sessionId:'fallback'};const timestamp='2025-01-01T00:00:00Z';
 const parse=payload=>tailer.parseLine(JSON.stringify({type:'response_item',timestamp,payload}),context);
 try {
  parse({type:'function_call',name:'request_user_input'});
  assert.equal(manager.getSession('fallback').status,'waiting');
  assert.equal(manager.getSession('fallback').updatedAt,Date.parse(timestamp));
  parse({type:'function_call_output'});assert.equal(manager.getSession('fallback').status,'thinking');
 }finally{manager.dispose();}
});

test('the Windows hook wrapper forwards stdin JSON and emits harmless hook output',()=>environment(async directory=>{
 const home=path.join(directory,'codex');const hookDir=path.join(directory,'中文 hooks');
 const installer=new CodexHookInstaller(path.resolve('assets/nexo-cli.cjs'),hookDir,process.execPath,home);
 const {command:wrapper}=installer.install();
 const events=path.join(directory,'test-events');
 const output=await new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',wrapper,'hook','PermissionRequest','--data-dir',events],{windowsHide:true});
  let text='';let error='';child.stdout.on('data',chunk=>text+=chunk);child.stderr.on('data',chunk=>error+=chunk);
  child.on('error',reject);child.on('exit',code=>code===0?resolve(text):reject(new Error(error)));
  child.stdin.end(JSON.stringify({session_id:'wrapper-task',cwd:'C:/项目'}));
 });
 assert.deepEqual(JSON.parse(output),{});assert.equal(readTrafficSnapshot(events).state,'working');
 const saved=JSON.parse(fs.readFileSync(path.join(events,'events',fs.readdirSync(path.join(events,'events'))[0]),'utf8'));
 const tasks=new Map();applyTrafficEvent(tasks,saved);
 assert.equal(aggregateTraffic(tasks.values(),saved.at+APPROVAL_GRACE_MS).state,'waiting');
}));


test('restored orphaned fallback waiting records are removed without clearing live Hook or CLI tasks',()=>environment(directory=>{
 const now=Date.now();
 const saved=[
   {...task('old-fallback','waiting',now-7200000),source:'session'},
   {...task('live-fallback','waiting',now),source:'session'},
   task('live-hook','waiting',now),
   {...task('manual','waiting',now),source:'cli'},
   {...task('recent-completion','done',now),source:'session'},
 ];
 fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({version:1,tasks:saved,receipts:[]}));
 const service=new CodexTrafficService(directory);
 const session={id:'live-fallback',agent:'codex',status:'waiting',updatedAt:now,startedAt:now,durationSeconds:0};
 service.trackSessions([session]);
 let tasks=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')).tasks;
 assert.equal(tasks.some(task=>task.id==='old-fallback'),false);
 assert.equal(service.getSnapshot().counts.waiting,3);
 assert.equal(service.getSnapshot().counts.done,1);
 service.trackSessions([]);
 assert.equal(service.getSnapshot().counts.waiting,2);
 tasks=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')).tasks;
 assert.deepEqual(tasks.filter(task=>task.state==='waiting').map(task=>task.id).sort(),['live-hook','manual']);
}));

test('JSONL fallback cannot override authoritative Hook completion with a later waiting inference',()=>{
 const tasks=new Map();
 applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'hook',state:'done',at:1000});
 applyTrafficEvent(tasks,{id:'one',sessionId:'one',source:'session',state:'waiting',at:2000});
 assert.equal(tasks.get('one').state,'done');
 applyTrafficEvent(tasks,{id:'two',sessionId:'two',source:'session',state:'waiting',at:2000});
 assert.equal(aggregateTraffic(tasks.values(),2001).state,'waiting');
});

test('fast-forwarded JSONL files recover their own metadata ID when new events arrive',async()=>environment(async directory=>{
 const {build}=await import('esbuild');
 const result=await build({stdin:{contents:"export {CodexSessionTailer} from './src/main/services/codex-tailer.ts'; export {SessionManager} from './src/main/services/session-manager.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
 const {createRequire}=await import('node:module');
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const {CodexSessionTailer,SessionManager}=module.exports;
 const manager=new SessionManager();const tailer=new CodexSessionTailer(manager,directory);
 const file=path.join(directory,'session.jsonl');
 const old='2025-01-01T00:00:00Z';
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',timestamp:old,payload:{id:'actual-thread',session_id:'parent-thread',cwd:directory}})+'\n');
 fs.utimesSync(file,new Date(old),new Date(old));
 try {
   tailer.scanInitialFiles();
   fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_started'}})+'\n');
   tailer.readNewLines(file);
   assert.equal(manager.getSession('actual-thread').status,'thinking');
   assert.equal(manager.getSession('parent-thread'),undefined);
   assert.equal(manager.getSession('codex-active'),undefined);
 }finally{tailer.stop();manager.dispose();}
}));
