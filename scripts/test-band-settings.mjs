import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {buildSync} from 'esbuild';
const require=createRequire(import.meta.url);
const compile=(file,external=['node:*'])=>buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',external}).outputFiles[0].text;

test('vibration preference persists, rejects invalid input and keeps its last saved value on write failure',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexo-band-settings-'));
  try {
    const file=path.join(directory,'band-settings.json');
    let failWrite=false;
    const mockFs={...fs,renameSync(...args){if(failWrite)throw new Error('save denied');fs.renameSync(...args);}};
    const module={exports:{}};
    vm.runInNewContext(compile('src/main/services/band-settings-store.ts'),{module,exports:module.exports,Date:{now:()=>100},require:name=>name==='node:fs'?mockFs:require(name)});
    const Store=module.exports.BandSettingsStore;
    const store=new Store(file);
    assert.equal(store.get().vibrationEnabled,true);
    assert.throws(()=>store.setVibration('false'),/无效/);
    const disabled=store.setVibration(false);
    assert.equal(disabled.vibrationEnabled,false);
    assert.equal(disabled.revision,100);
    assert.equal(new Store(file).get().vibrationEnabled,false);
    disabled.vibrationEnabled=true;
    assert.equal(store.get().vibrationEnabled,false);
    failWrite=true;
    assert.throws(()=>store.setVibration(true),/save denied/);
    assert.equal(store.get().vibrationEnabled,false);
    assert.equal(new Store(file).get().vibrationEnabled,false);
    failWrite=false;
    assert.equal(store.setVibration(true).revision,101);
    assert.equal(store.setVibration(true).revision,101);
    fs.writeFileSync(file,'{invalid');
    assert.equal(new Store(file).get().vibrationEnabled,true);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('Bluetooth pushes and reconnect handshakes send the newest saved setting alongside task state',async()=>{
  const module={exports:{}};
  vm.runInNewContext(compile('src/main/services/fetch-bridge-direct.ts'),{module,exports:module.exports,Buffer,Date,require});
  const sent=[];
  const client=new EventEmitter();
  client.connected=true;
  client.call=async(method,request)=>{
    assert.equal(method,'device.interconnect.send');
    sent.push(JSON.parse(Buffer.from(request.payload).toString('utf8')));
  };
  let settings={vibrationEnabled:false,revision:12};
  const bridge=new module.exports.DirectFetchBridge(client,{onRequest(){},onResponse(){}},()=>({...settings}));
  await bridge.pushBandSettings();
  assert.equal(sent.length,0);
  bridge.start();
  await bridge.pushBandSettings();
  assert.equal(sent[0].tag,'band-settings');
  assert.deepEqual(sent[0].bandSettings,settings);
  await bridge.pushTraffic({state:'waiting',sampledAt:1});
  assert.equal(sent[1].traffic.state,'waiting');
  assert.deepEqual(sent[1].bandSettings,settings);
  client.connected=false;
  settings={vibrationEnabled:true,revision:13};
  await bridge.pushBandSettings();
  assert.equal(sent.length,2);
  client.connected=true;
  client.emit('device.interconnect',{packageName:'com.codeisland.band',payload:Array.from(Buffer.from(JSON.stringify({tag:'__hs__',count:0})))});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).tag,'__hs__');
  assert.deepEqual(sent.at(-1).bandSettings,settings);
  bridge.stop();
});

test('periodic compact status includes saved vibration settings independently of quota availability',()=>{
  const module={exports:{}};
  const source=compile('src/main/services/status-server.ts',['*']);
  let requestHandler;
  const http={createServer(handler){requestHandler=handler;return {on(){},listen(){},close(){}};}};
  const settings={vibrationEnabled:false,revision:45};
  vm.runInNewContext(source,{module,exports:module.exports,URL,Date,require:name=>{
    if(name==='node:http')return http;
    if(name.endsWith('/quota-collector'))return {QuotaCollector:class {getQuotas(){return {codex:{}};}getQuotaMeta(){return {};}}};
    if(name.endsWith('/codex-traffic'))return {aggregateTraffic:()=>({state:'idle'})};
    if(name.endsWith('/band-settings'))return {DEFAULT_BAND_SETTINGS:{vibrationEnabled:true,revision:0}};
    if(name.endsWith('/error-log'))return {pushError(){}};
    throw new Error('Unexpected dependency '+name);
  }});
  const server=new module.exports.StatusServer({getAllSessions:()=>[]},18765,undefined,()=>settings);
  server.start();
  let response;
  requestHandler({url:'/api/status/compact',method:'GET'},{writeHead(status){assert.equal(status,200);},end(body){response=JSON.parse(body);}});
  assert.deepEqual(response.bandSettings,settings);
  assert.equal(response.traffic.state,'idle');
  server.stop();
});
