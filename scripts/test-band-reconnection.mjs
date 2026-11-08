import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
function compile(entry) {
  return buildSync({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:['*'],define:{'import.meta.dirname':JSON.stringify(process.cwd()+'/dist-electron/main')}}).outputFiles[0].text;
}
const bridgeCode = compile('src/main/services/pulse-core-bridge.ts');

function fixture() {
  const ipc = new Map(), timeouts = new Map(), intervals = new Map();
  let timerId = 0, valid = true, startFailure = false, startGate = null;
  class Client extends EventEmitter {
    connected = false;
    calls = [];
    status = {connected:false,protocolState:'disconnected'};
    starts = 0;
    async start() { this.starts++; if(startGate) await startGate; if(startFailure) throw new Error('offline'); this.connected=true; }
    clearBandConnectionIntent() {}
    async call(method) {
      this.calls.push(method);
      if(method==='device.status') return this.status;
      if(method==='device.connect') this.status={connected:false,protocolState:'connecting'};
      if(method==='device.disconnect') this.status={connected:false,protocolState:'disconnected'};
      return {};
    }
  }
  const client = new Client();
  const module = {exports:{}};
  vm.runInNewContext(bridgeCode,{module,exports:module.exports,console,process,Buffer,
    setTimeout:(fn,delay)=>{const id=++timerId;timeouts.set(id,{fn,delay});return id;},clearTimeout:id=>timeouts.delete(id),
    setInterval:(fn,delay)=>{const id=++timerId;intervals.set(id,{fn,delay});return id;},clearInterval:id=>intervals.delete(id),
    require(name) {
      if(name==='electron') return {ipcMain:{handle:(name,callback)=>ipc.set(name,callback)}};
      if(name==='./device-config-service') return {deviceConfigService:{getDeviceConfigStatus:()=>({exists:valid,valid})}};
      if(name==='./fetch-bridge-direct') return {BAND_PACKAGE:'com.codeisland.band',DirectFetchBridge:class {running=false;start(){this.running=true;}stop(){this.running=false;}}};
      if(name==='./pulse-core-policy') return {shouldConnectBand:reason=>['startup','reconnect','manual-connect'].includes(reason)};
      if(name==='./error-log') return {pushError(){},onErrorLog(){}};
      if(name.startsWith('./')) return {};
      return require(name);
    },
  });
  const bridge = new module.exports.PulseCoreBridge(client);
  bridge.attach(null);
  return {bridge,client,timeouts,intervals,invoke:name=>ipc.get(name)(),setValid:value=>{valid=value;},setStartFailure:value=>{startFailure=value;},setStartGate:value=>{startGate=value;},
    async runRetry(){const [id,timer]=timeouts.entries().next().value;timeouts.delete(id);timer.fn();await flush();return timer.delay;},
    async poll(){await [...intervals.values()][0].fn();await flush();},
  };
}

test('startup requires valid configuration and shares one connect attempt with manual requests', async () => {
  const f=fixture();
  f.setValid(false);f.bridge.startAutoConnect();await flush();assert.equal(f.client.starts,0);
  f.setValid(true);f.bridge.startAutoConnect();await f.invoke('pulse:band:connect');
  assert.equal(f.client.starts,1);assert.equal(f.client.calls.filter(method=>method==='device.connect').length,1);
  await f.poll();assert.equal(f.timeouts.size,0);
  assert.equal(f.invoke('pulse:core:get-state').connection.state,'connecting');
  f.bridge.detach();
});

test('failed Bluetooth connection recovers with backoff and manual disconnect cancels retries', async () => {
  const f=fixture();f.bridge.startAutoConnect();await flush();
  f.client.status={connected:false,protocolState:'error'};
  f.client.emit('device.state',{state:{protocolState:'error'}});
  assert.equal(await f.runRetry(),5000);
  assert.equal(f.client.calls.filter(method=>method==='device.connect').length,2);
  f.client.status={connected:false,protocolState:'error'};
  f.client.emit('device.state',{state:{protocolState:'error'}});
  assert.equal([...f.timeouts.values()][0].delay,10000);
  await f.invoke('pulse:band:disconnect');await f.poll();
  assert.equal(f.timeouts.size,0);
  assert.equal(f.client.calls.filter(method=>method==='device.connect').length,2);
  f.bridge.detach();
});

test('daemon startup failures retry up to a sixty-second interval and detach cancels recovery', async () => {
  const f=fixture();f.setStartFailure(true);f.bridge.startAutoConnect();await flush();
  const delays=[];
  for(let i=0;i<6;i++) delays.push(await f.runRetry());
  assert.deepEqual(delays,[5000,10000,20000,40000,60000,60000]);
  f.bridge.detach();assert.equal(f.timeouts.size,0);
});

test('quitting during daemon startup prevents late connection and polling', async () => {
  const f=fixture();let release;f.setStartGate(new Promise(resolve=>{release=resolve;}));
  f.bridge.startAutoConnect();f.bridge.detach();release();await flush();
  assert.equal(f.client.calls.filter(method=>method==='device.connect').length,0);
  assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
});

test('quota fetch failures retry within sixty seconds and resume live data after recovery', async () => {
  let now=1000000, offline=true;
  class Clock extends Date {static now(){return now;}}
  const module={exports:{}};
  vm.runInNewContext(compile('src/main/services/quota-collector.ts'),{module,exports:module.exports,Date:Clock,process,
    require(name){
      if(name==='node:fs') return {existsSync:()=>false};
      if(name==='./codex-daily-usage') return {CodexDailyUsage:class {getSnapshot(){return null;}}};
      if(name==='./error-log') return {pushError(){}};
      if(name==='./codex-rate-limits') return {};
      return require(name);
    },
  });
  const collector=new module.exports.QuotaCollector(async()=>{if(offline) throw new Error('offline');return {primary:{pct:25,resetMs:now+3600000},secondary:{pct:40,resetMs:now+86400000}};});
  for(let i=0;i<7;i++) {
    collector.getQuotas();await flush();
    const next=collector.getQuotaMeta().nextTry.codex;
    assert.ok(next-now>0&&next-now<=60000);now=next;
  }
  offline=false;collector.getQuotas();await flush();
  assert.equal(collector.getQuotaMeta().nextTry.codex,0);
  assert.equal(collector.getQuotas().codex.pct5h,25);
  assert.equal(collector.getQuotas().codex.authoritative,true);
});

test('Bluetooth message send failures are contained while the next handshake can recover', async () => {
  const module={exports:{}}, errors=[];
  vm.runInNewContext(compile('src/main/services/fetch-bridge-direct.ts'),{module,exports:module.exports,Buffer,Date,
    require(name){if(name==='./error-log') return {pushError:(...args)=>errors.push(args)};return {};},
  });
  const client=new EventEmitter();client.connected=true;
  let failing=true, sent=0;
  client.call=async()=>{if(failing) throw new Error('disconnected');sent++;};
  const bridge=new module.exports.DirectFetchBridge(client,{onResponse(){}});
  bridge.start();
  const packet={packageName:'com.codeisland.band',payload:Array.from(Buffer.from(JSON.stringify({tag:'__hs__',count:0})))};
  client.emit('device.interconnect',packet);await flush();
  assert.ok(errors.some(entry=>entry[1].includes('等待链路恢复')));
  failing=false;client.emit('device.interconnect',packet);await flush();assert.equal(sent,1);
  bridge.stop();
});
