import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { hookTrafficEvent, applyTrafficEvent, aggregateTraffic } from '../src/common/codex-traffic.ts';

function page(screenBehavior, vibrationBehavior) {
  const ux = fs.readFileSync(new URL('../band-app/src/pages/index/index.ux', import.meta.url), 'utf8');
  const script = ux.split('<script>')[1].split('</script>')[0]
    .replace(/^import .*;$/gm, '').replace('export default', 'globalThis.page =');
  const sent = [];
  const screenRequests = [];
  const vibrations = [];
  const timers = new Map();
  const timerDelays = new Map();
  const intervals = new Map();
  let nextTimer = 0;
  const connection = { send: (message) => sent.push(message.data) };
  const context = vm.createContext({
    device: { getInfo({success}) { success({screenWidth:192,screenHeight:490}); } },
    brightness: { setKeepScreenOn(options) { screenRequests.push(options.keepScreenOn); if (screenBehavior) screenBehavior(options); } },
    vibrator: { vibrate(options) { vibrations.push(options.mode); if (vibrationBehavior) vibrationBehavior(); } },
    interconnect: { instance: () => connection }, router: { back() {} },
    setTimeout: (fn, delay) => { timers.set(++nextTimer, fn); timerDelays.set(nextTimer, delay); return nextTimer; },
    clearTimeout: (id) => { timers.delete(id); timerDelays.delete(id); },
    setInterval: (fn, delay) => { intervals.set(++nextTimer, {fn, delay}); return nextTimer; },
    clearInterval: (id) => intervals.delete(id),
  });
  vm.runInContext(script, context);
  Object.assign(context.page, context.page.private);
  const runTimer = () => {
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    timerDelays.delete(id);
    fn();
  };
  const runTimerAt = (delay) => {
    const id = [...timers.keys()].find(value => timerDelays.get(value) === delay);
    assert.notEqual(id, undefined, 'Expected a timer at ' + delay + ' ms');
    const callback = timers.get(id);
    timers.delete(id);
    timerDelays.delete(id);
    callback();
  };
  return { context, page: context.page, screenRequests, vibrations, sent, connection, timers, timerDelays, intervals, runTimer, runTimerAt };
}

test('Band page handshakes, renders remaining quota, and blocks duplicate requests', () => {
  const { page: p, sent, connection, runTimer } = page();
  p.onShow();
  runTimer();
  assert.equal(sent[0].tag, '__hs__');
  connection.onmessage({ data: JSON.stringify({ tag: '__hs__', count: 1 }) });
  assert.equal(sent[1].tag, 'fetch');
  p.refresh();
  assert.equal(sent.length, 2);
  connection.onmessage({ data: { tag: 'fetch', id: sent[1].id, resp: { ok: true, body: JSON.stringify({
    limits: { codex: { pct5h: 25, pct7d: 100, authoritative: true, sampledAt: Date.now() } },
  }) } } });
  assert.match(p.fiveImage, /ring-five-75\.png$/);
  assert.match(p.weekImage, /ring-week-0\.png$/);
  assert.match(p.fiveReset0, /small-dash\.png$/);
  assert.match(p.date2, /date-slash\.png$/);
  p.onHide();
});

test('Stale data and missing windows display unknown, with timers stopped on hide', () => {
  const { page: p, sent, connection, timers, runTimer } = page();
  p.onShow(); runTimer();
  connection.onmessage({ data: { tag: '__hs__' } });
  connection.onmessage({ data: { tag: 'fetch', id: sent[1].id, resp: { ok: true, body: {
    limits: { codex: { pct5h: 0, pct7d: null, authoritative: true, sampledAt: Date.now() - 600000 } },
  } } } });
  assert.match(p.fiveImage, /ring-five-unknown\.png$/);
  assert.match(p.weekImage, /ring-week-unknown\.png$/);
  assert.match(p.fiveReset2, /small-colon\.png$/);
  assert.match(p.weekReset2, /small-slash\.png$/);
  p.refresh();
  assert.equal(timers.size, 1);
  p.onHide();
  assert.equal(timers.size, 0);
});

test('Failed handshake times out and can retry', () => {
  const { page: p, sent, runTimer } = page();
  p.onShow(); runTimer(); runTimer();
  p.refresh();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].tag, '__hs__');
  p.onDestroy();
});

test('right swipe exits only twice within two seconds and resets across taps, hiding and reopening', () => {
  const {page:p,context,screenRequests,intervals} = page();
  context.backClock=1000000;
  vm.runInContext('Date.now = () => backClock',context);
  p.onShow();
  assert.equal(p.onBackPress(),true);
  assert.ok(intervals.size>0);
  context.backClock+=2001;
  assert.equal(p.onBackPress(),true);
  p.handleTap();context.backClock+=100;
  assert.equal(p.onBackPress(),true);
  context.backClock+=1000;
  assert.equal(p.onBackPress(),false);
  assert.equal(intervals.size,0);assert.equal(screenRequests.at(-1),false);
  p.onShow();assert.equal(p.onBackPress(),true);
  p.onHide();assert.equal(p.onBackPress(),true);
  p.onShow();assert.equal(p.onBackPress(),true);
  context.backClock+=2000;assert.equal(p.onBackPress(),false);
});

test('duplicate handshake cannot remove the active fetch timeout or stall recovery', () => {
  const { page: p, sent, connection, runTimer, runTimerAt, timers } = page();
  p.onShow(); runTimer();
  connection.onmessage({ data: { tag: '__hs__' } });
  assert.equal(sent.at(-1).tag, 'fetch');
  connection.onmessage({ data: { tag: '__hs__' } });
  assert.equal(timers.size, 1);
  runTimerAt(6000);
  p.refresh();
  assert.equal(sent.at(-1).tag, '__hs__');
  connection.onmessage({ data: { tag: '__hs__' } });
  assert.equal(sent.at(-1).tag, 'fetch');
  p.onHide();
});

test('transport errors reopen on the automatic five-second recovery tick and ignore late callbacks', () => {
  const { page: p, sent, connection, runTimer, intervals, timers } = page();
  p.onShow(); runTimer();
  const oldMessage = connection.onmessage;
  const oldError = connection.onerror;
  connection.onmessage({ data: { tag: '__hs__' } });
  connection.onerror();
  assert.equal(timers.size, 0);
  const tick = [...intervals.values()].find(item => item.delay === 1000).fn;
  for (let i=0; i<5; i++) tick();
  assert.equal(sent.at(-1).tag, '__hs__');
  connection.onmessage({ data: { tag: '__hs__' } });
  const count = sent.length;
  oldError(); oldMessage({ data: { tag: '__hs__' } });
  assert.equal(timers.size, 1);
  assert.equal(sent.length, count);
  p.onHide(); oldError();
  assert.equal(timers.size, 0);
});

test('Reset labels and daily CNY estimate use received values and expire per window', () => {
  const { page: p, sent, connection, runTimer } = page();
  p.onShow(); runTimer();
  connection.onmessage({ data: { tag: '__hs__' } });
  const now = Date.now();
  const date = new Date();
  const today = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  connection.onmessage({ data: { tag: 'fetch', id: sent[1].id, resp: { ok: true, body: {
    ts: now,
    daily: { date: today, cny: 62.46, incomplete: true, updatedAt: now },
    limits: { codex: { pct5h: 25, pct7d: 84, authoritative: true, sampledAt: now,
      reset5hAt: now - 1000, reset7dAt: now + 86400000, reset5hClock: '04:51', reset7dDate: '10/27' } },
  } } } });
  assert.match(p.fiveImage, /ring-five-unknown\.png$/);
  assert.match(p.weekImage, /ring-week-16\.png$/);
  assert.match(p.weekReset0, /small-1\.png$/);
  assert.match(p.weekReset2, /small-slash\.png$/);
  assert.match(p.money0, /money-6\.png$/);
  assert.match(p.money2, /money-dot\.png$/);
  assert.match(p.moneyLabel, /money-partial\.png$/);
  assert.match(p.moneySymbol, /money-symbol-partial\.png$/);
  assert.equal(p.moneyStyle2.height, '4px');
  assert.equal(p.moneyStyle3.top, '137px');
  p.onHide();
});

test('Money layout keeps digits contiguous for decimals, compact amounts and missing values', () => {
  const { page: p } = page();
  for (const text of ['9.99', '1234.56', '1.0w', '1.0m', '--']) {
    p.setMoney(text);
    let position = 109;
    for (let i = 0; i < 7; i++) {
      const width = text.charAt(i) === '.' ? 4 : 12;
      assert.equal(p['moneyStyle' + i].top, position + 'px');
      assert.equal(p['moneyStyle' + i].height, width + 'px');
      position += width;
    }
    assert.ok(position <= 193);
  }
});


test('Desk display requests screen-on while visible and releases on hide, exit and destroy', () => {
  const {page:p,screenRequests} = page();
  p.onShow();
  p.onHide();
  p.onShow();
  p.exitApp();
  p.onDestroy();
  assert.deepEqual(screenRequests,[true,false,true,false,false]);
  for (const file of ['band-app/src/manifest.json','band-app/manifest.json']) {
    const manifest = JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
    assert.ok(manifest.features.some(feature=>feature.name==='system.brightness'));
  }
});

test('Screen-on API errors preserve the display, transport startup and cleanup', () => {
  for (const fail of [() => {throw new Error('unsupported');}, options => options.fail({}, 'unsupported')]) {
    const {page:p,timers,sent,runTimer} = page(fail);
    p.onShow();runTimer();
    assert.equal(sent[0].tag,'__hs__');
    p.onHide();
    assert.equal(timers.size,0);
  }
});

test('Band 10/11 viewport preserves circles, centers the canvas and rescales compact money glyphs', () => {
  const {page:p} = page();
  p.applyViewport(212, 520);
  const ring = p.fiveImageStyle;
  assert.equal(ring.width, ring.height);
  assert.ok(Math.abs(parseFloat(p.hour1Style.top) - (38 * (520 * 192 / 212 / 490) - 6 * 192 / 212)) < 0.00001);
  assert.equal(parseFloat(p.screenStyle.height), 520 * 192 / 212);
  assert.ok(parseFloat(p.hour1Style.left) > 0);
  assert.ok(parseFloat(p.weekImageStyle.top) + parseFloat(p.weekImageStyle.height) < 520 * 192 / 212);
  p.setMoney('89.26');
  assert.ok(parseFloat(p.moneyStyle2.height) < 4);
  assert.ok(parseFloat(p.moneyStyle3.top) > parseFloat(p.moneyStyle2.top));
  p.applyViewport(192, 490);
  assert.equal(p.fiveImageStyle.width, '116px');
  assert.equal(p.hour1Style.top, '38px');
});

test('traffic dots stay lit across ticks, expire completed tasks and hide stale states',()=>{
 const {context,page:p}=page();
 assert.equal(p.statusDotStyle.width,'16px');
 assert.equal(p.statusDotStyle.height,'16px');
 assert.equal(p.statusDotStyle.left,'85px');
 assert.equal(p.statusDotStyle.top,'14px');
 for(const [index,state] of ['working','waiting','done'].entries()) {
   const startedAt=2000000+index*10000;
   vm.runInContext('Date.now = () => '+startedAt,context);
   p.receiveTraffic({state,sampledAt:startedAt,expiresAt:startedAt+9000});
   for(const offset of [0,1000,2000,3000]) {
     vm.runInContext('Date.now = () => '+(startedAt+offset),context);
     p.updateTraffic();
     assert.ok(p.statusDot.endsWith('status-'+state+'.png'));
   }
 }
 vm.runInContext('Date.now = () => 2030000',context);p.updateTraffic();assert.match(p.statusDot,/status-idle.png$/);
 p.receiveTraffic({state:'working',sampledAt:2030000});
 vm.runInContext('Date.now = () => 2075001',context);p.updateTraffic();assert.match(p.statusDot,/status-idle.png$/);
 p.receiveTraffic({state:'unrecognized'});assert.match(p.statusDot,/status-idle.png$/);
});

test('double taps switch pages, ignore single or slow taps and clean up on hide', () => {
  const {context,page:p,intervals}=page();
  let now=2000000;
  const tap=(delay=100)=>{now+=delay;vm.runInContext('Date.now = () => '+now,context);p.handleTap();};
  const doubleTap=()=>{tap(500);tap();};
  const animationCount=()=>[...intervals.values()].filter(timer=>timer.delay===100).length;
  p.onShow();
  tap();assert.equal(p.showExpression,false);
  tap(500);assert.equal(p.showExpression,false);
  tap();assert.equal(p.showExpression,true);
  for(let attempt=0;attempt<5;attempt++){
    doubleTap();assert.equal(p.showExpression,false);assert.equal(animationCount(),0);
    doubleTap();assert.equal(p.showExpression,true);assert.equal(animationCount(),1);
  }
  p.onHide();assert.equal(intervals.size,0);
  p.onShow();tap();assert.equal(p.showExpression,false);
  tap();assert.equal(p.showExpression,true);
  p.exitApp();assert.equal(intervals.size,0);
  const ux=fs.readFileSync(new URL('../band-app/src/pages/index/index.ux',import.meta.url),'utf8');
  assert.match(ux,/onclick="handleTap"/);
});

test('waiting opens expressions once, respects double taps and returns to time when execution resumes', () => {
  const {context,page:p,intervals}=page();
  let now=2000000;
  const time=value=>{now=value;vm.runInContext('Date.now = () => '+now,context);};
  time(now);p.onShow();p.handleTap();
  p.receiveTraffic({state:'waiting',sampledAt:now});
  assert.equal(p.showExpression,true);assert.equal(p.expressionName,'smirk');
  time(now+100);p.handleTap();time(now+100);p.handleTap();assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'waiting',sampledAt:now});assert.equal(p.showExpression,false);
  time(now+1000);p.handleTap();time(now+100);p.handleTap();assert.equal(p.showExpression,true);
  p.receiveTraffic({state:'waiting',sampledAt:now});assert.equal(p.showExpression,true);
  time(now+46000);p.updateTraffic();assert.equal(p.showExpression,true);assert.equal(p.expressionName,'smirk');
  p.receiveTraffic({state:'working',sampledAt:now});
  assert.equal(p.showExpression,false);
  assert.equal([...intervals.values()].filter(timer=>timer.delay===100).length,0);
  p.receiveTraffic({state:'waiting',sampledAt:now-1});assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'waiting',sampledAt:now+1});assert.equal(p.showExpression,true);
  p.onHide();
});

test('completion forces expressions and returns at the original ten-minute deadline', () => {
  const {context,page:p}=page();
  let now=2000000;
  const time=value=>{now=value;vm.runInContext('Date.now = () => '+now,context);};
  time(now);p.onShow();
  const deadline=now+600000;
  p.receiveTraffic({state:'done',sampledAt:now,expiresAt:deadline});
  assert.equal(p.showExpression,true);assert.equal(p.expressionName,'star');
  time(now+100);p.handleTap();time(now+100);p.handleTap();assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'done',sampledAt:now,expiresAt:deadline});assert.equal(p.showExpression,false);
  time(now+500);p.handleTap();time(now+100);p.handleTap();assert.equal(p.showExpression,true);
  time(2300000);p.receiveTraffic({state:'done',sampledAt:now,expiresAt:deadline});
  time(deadline-1);p.updateTraffic();assert.equal(p.showExpression,true);assert.equal(p.expressionName,'star');
  time(deadline);p.updateTraffic();assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'done',sampledAt:now,expiresAt:deadline});assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'done',sampledAt:now+1,expiresAt:now+600001});assert.equal(p.showExpression,true);
  p.receiveTraffic({state:'working',sampledAt:now+2});assert.equal(p.showExpression,false);
  p.receiveTraffic({state:'done',sampledAt:now+3,expiresAt:now+2});assert.equal(p.showExpression,false);
  p.onHide();
});

test('live traffic packets choose complete numeric frame sequences alongside steady status lights', () => {
  const {context, page: p, connection, runTimer, intervals} = page();
  vm.runInContext('Date.now = () => 2000000', context);
  p.onShow();
  runTimer();
  p.toggleView();
  const nextFrame = () => [...intervals.values()].find(timer => timer.delay === 100).fn();
  for (const [state, name, count] of [['working', 'naughty', 9], ['waiting', 'smirk', 17], ['done', 'star', 16], ['idle', 'sleep', 8]]) {
    connection.onmessage({data: {tag: 'traffic', traffic: {state, sampledAt: 2000000, expiresAt: 2600000}}});
    if (!p.showExpression) p.toggleView();
    assert.equal(p.expressionName, name);
    assert.equal(p.expressionFrame, 0);
    for (let frame = 0; frame < count; frame++) {
      assert.equal(p.expressionFrame, frame);
      const image = fs.readFileSync(new URL('../band-app/src' + p.expressionImage, import.meta.url));
      assert.equal(image.subarray(1, 4).toString(), 'PNG');
      assert.equal(image.readUInt32BE(16), 192);
      assert.equal(image.readUInt32BE(20), 490);
      nextFrame();
    }
    assert.equal(p.expressionFrame, 0);
  }
  p.receiveTraffic({state: 'waiting', sampledAt: 2000000});
  nextFrame();
  vm.runInContext('Date.now = () => 2001000', context);
  p.updateTraffic();
  assert.equal(p.expressionName, 'smirk');
  assert.equal(p.expressionFrame, 1);
  assert.match(p.statusDot, /status-waiting.png$/);
  vm.runInContext('Date.now = () => 2045001', context);
  nextFrame();
  assert.equal(p.expressionName, 'smirk');
  p.onHide();
});

test('completion uses four long pulses and waiting uses six short-long pairs', () => {
  const {page: p, connection, sent, vibrations, runTimer, runTimerAt} = page();
  const now = Date.now();
  const send = (state, sequence) => connection.onmessage({data: {
    tag: 'traffic', traffic: {state, sampledAt: now + sequence, expiresAt: now + 600000}
  }});
  p.onShow();
  runTimer();
  connection.onmessage({data:{tag:'__hs__'}});
  connection.onmessage({data:{tag:'fetch',id:sent.at(-1).id,resp:{ok:true,body:{limits:{codex:{}}}}}});
  send('working', 0);
  send('done', 1);
  assert.deepEqual(vibrations, ['long']);
  send('done', 2);
  p.toggleView();
  p.updateDisplay();
  assert.deepEqual(vibrations, ['long']);
  for (const at of [500, 1000, 1500]) runTimerAt(at);
  assert.deepEqual(vibrations, ['long', 'long', 'long', 'long']);

  send('waiting', 3);
  assert.equal(vibrations.length, 5);
  for (const at of [300, 1200, 1500, 2400, 2700, 3600, 3900, 4800, 5100, 6000, 6300]) runTimerAt(at);
  assert.deepEqual(vibrations.slice(4), ['short', 'long', 'short', 'long', 'short', 'long', 'short', 'long', 'short', 'long', 'short', 'long']);
  send('waiting', 4);
  p.toggleView();
  p.updateTraffic();
  assert.equal(vibrations.length, 16);
  send('working', 5);
  send('done', 6);
  assert.equal(vibrations.length, 17);
  assert.equal(vibrations.at(-1), 'long');
  p.onHide();
});

test('resuming or exiting cancels pending pulses and old responses cannot replay an alert', () => {
  const {page: p, vibrations, timerDelays, timers} = page();
  const now = Date.now();
  p.onShow();
  p.receiveTraffic({state: 'waiting', sampledAt: now});
  assert.equal(vibrations.length, 1);
  assert.ok([...timerDelays.values()].includes(300));
  p.receiveTraffic({state: 'working', sampledAt: now + 2});
  for (const at of [300, 1200, 1500, 2400, 2700, 3600, 3900, 4800, 5100, 6000, 6300]) assert.ok(![...timerDelays.values()].includes(at));
  p.receiveTraffic({state: 'waiting', sampledAt: now + 1});
  assert.equal(p.getTrafficState(), 'working');
  assert.equal(vibrations.length, 1);

  p.receiveTraffic({state: 'waiting', sampledAt: now + 3});
  p.receiveTraffic(null);
  p.receiveTraffic({state: 'waiting', sampledAt: now + 4});
  assert.equal(vibrations.length, 2);
  p.exitApp();
  assert.equal(timers.size, 0);
  p.receiveTraffic({state: 'done', sampledAt: now + 5});
  assert.equal(vibrations.length, 2);
});

test('leaving completion cancels the remaining long pulses', () => {
  const {page: p, vibrations, timerDelays, runTimerAt, runTimer} = page();
  const now = Date.now();
  p.onShow();
  runTimer();
  p.receiveTraffic({state:'done',sampledAt:now});
  runTimerAt(500);
  assert.deepEqual(vibrations, ['long','long']);
  p.receiveTraffic({state:'working',sampledAt:now+1});
  for (const at of [1000,1500]) assert.ok(![...timerDelays.values()].includes(at));
  p.onHide();
});

test('muting a live alert cancels its remaining pulses and enabling does not replay it', () => {
  const {page:p,vibrations,timerDelays} = page();
  p.onShow();
  const now = Date.now();
  p.receiveTraffic({state:'waiting',sampledAt:now});
  assert.deepEqual(vibrations,['short']);
  p.receiveBandSettings({vibrationEnabled:false,revision:2});
  assert.deepEqual([...timerDelays.values()],[2000]);
  p.receiveBandSettings({vibrationEnabled:true,revision:1});
  p.receiveTraffic({state:'done',sampledAt:now+1,expiresAt:now+600000});
  assert.deepEqual(vibrations,['short']);
  assert.equal(p.expressionName,'star');
  assert.match(p.statusDot,/status-done\.png$/);
  p.receiveBandSettings({vibrationEnabled:true,revision:3});
  p.receiveTraffic({state:'done',sampledAt:now+2,expiresAt:now+600000});
  assert.deepEqual(vibrations,['short']);
  p.receiveTraffic({state:'working',sampledAt:now+3});
  p.receiveTraffic({state:'waiting',sampledAt:now+4});
  assert.deepEqual(vibrations,['short','short']);
  p.onHide();
});

test('saved mute is applied before traffic from polling, handshake and live push packets', () => {
  const {page:p,sent,connection,runTimer,vibrations} = page();
  p.onShow();runTimer();
  connection.onmessage({data:{tag:'__hs__',bandSettings:{vibrationEnabled:false,revision:5}}});
  const now=Date.now();
  connection.onmessage({data:{tag:'fetch',id:sent.at(-1).id,resp:{ok:true,body:JSON.stringify({
    bandSettings:{vibrationEnabled:false,revision:5},traffic:{state:'waiting',sampledAt:now},limits:{codex:{pct5h:50}},
  })}}});
  assert.equal(p.getTrafficState(),'waiting');
  assert.equal(vibrations.length,0);
  p.onHide();p.onShow();runTimer();
  connection.onmessage({data:{tag:'traffic',bandSettings:{vibrationEnabled:false,revision:5},traffic:{state:'done',sampledAt:now+1}}});
  assert.equal(p.getTrafficState(),'done');
  assert.equal(vibrations.length,0);
  connection.onmessage({data:{tag:'band-settings',bandSettings:{vibrationEnabled:true,revision:6}}});
  connection.onmessage({data:{tag:'traffic',traffic:{state:'working',sampledAt:now+2}}});
  connection.onmessage({data:{tag:'traffic',traffic:{state:'waiting',sampledAt:now+3}}});
  assert.deepEqual(vibrations,['short']);
  p.onHide();
});

test('poll settings mute alerts even without quota data and old snapshots cannot unmute them', () => {
  const {page:p,sent,connection,runTimer,vibrations}=page();
  p.onShow();runTimer();
  connection.onmessage({data:{tag:'__hs__'}});
  connection.onmessage({data:{tag:'fetch',id:sent.at(-1).id,resp:{ok:true,body:{bandSettings:{vibrationEnabled:false,revision:8}}}}});
  connection.onmessage({data:{tag:'traffic',bandSettings:{vibrationEnabled:true,revision:7},traffic:{state:'waiting',sampledAt:Date.now()}}});
  assert.equal(vibrations.length,0);
  assert.equal(p.showExpression,true);
  p.receiveBandSettings({vibrationEnabled:'true',revision:9});
  p.vibrate('long');
  assert.equal(vibrations.length,0);
  p.onHide();
});

test('vibration API failure preserves the task display and declarations include the capability', () => {
  const {page: p} = page(undefined, () => {throw new Error('unavailable');});
  p.onShow();
  assert.doesNotThrow(() => p.receiveTraffic({state: 'done', sampledAt: Date.now()}));
  assert.equal(p.expressionName, 'star');
  assert.equal(p.getTrafficState(), 'done');
  p.onHide();
  for (const file of ['band-app/src/manifest.json', 'band-app/manifest.json']) {
    const manifest = JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
    assert.ok(manifest.features.some(feature => feature.name === 'system.vibrator'));
  }
});


test('confirmed Codex quota pauses use the red waiting expression and resume to yellow', () => {
  const { page: p, runTimer } = page();
  p.onShow(); runTimer();
  const now = Date.now();
  const tasks = new Map();
  applyTrafficEvent(tasks,hookTrafficEvent('PostModelRequest',{session_id:'quota-task',status:'failed',error:'usage_limit_exceeded'},now));
  p.receiveTraffic(aggregateTraffic(tasks.values(),now));
  assert.equal(p.getTrafficState(),'waiting');
  assert.equal(p.expressionName,'smirk');
  assert.match(p.statusDot,/status-waiting\.png$/);
  applyTrafficEvent(tasks,hookTrafficEvent('PreModelRequest',{session_id:'quota-task'},now+1));
  p.receiveTraffic(aggregateTraffic(tasks.values(),now+1));
  assert.equal(p.getTrafficState(),'working');
  assert.equal(p.showExpression,false);
  assert.match(p.statusDot,/status-working\.png$/);
  p.onHide();
});


test('working and recent completion counts keep the band dot steadily yellow',()=>{
 const {context,page:p,vibrations}=page();
 let now=2000000;
 const time=value=>{now=value;vm.runInContext('Date.now = () => '+now,context);};
 time(now);p.onShow();
 p.receiveTraffic({state:'working',counts:{working:1,done:1,waiting:0,idle:0},sampledAt:now,expiresAt:now+10000});
 assert.match(p.statusDot,/status-working.png$/);
 for(let i=1;i<=6;i++){
  time(2000000+i*1000);p.updateTraffic();
  assert.match(p.statusDot,/status-working.png$/);
  assert.equal(p.getTrafficState(),'working');
  assert.equal(p.expressionName,'naughty');
  assert.equal(p.showExpression,false);
 }
 assert.equal(vibrations.length,0,'working state must not trigger a completion alert');
 time(2010000);p.updateTraffic();assert.match(p.statusDot,/status-working.png$/);
 p.receiveTraffic({state:'waiting',counts:{working:1,done:1,waiting:1,idle:0},sampledAt:now,expiresAt:null});
 assert.match(p.statusDot,/status-waiting.png$/);
 time(now+1000);p.updateTraffic();assert.match(p.statusDot,/status-waiting.png$/);
 p.onHide();
});

test('single-project snapshot stays yellow on the existing band page despite recent completion counts',()=>{
 const {context,page:p,vibrations}=page();
 vm.runInContext('Date.now = () => 2000000',context);
 p.onShow();
 p.receiveTraffic({state:'working',counts:{working:1,done:1,waiting:0,idle:0},sampledAt:2000000,expiresAt:0});
 for(let i=0;i<6;i++){
  vm.runInContext('Date.now = () => '+(2000000+i*1000),context);
  p.updateTraffic();
  assert.match(p.statusDot,/status-working.png$/);
  assert.equal(p.expressionName,'naughty');
 }
 assert.equal(vibrations.length,0);
 p.onHide();
});
