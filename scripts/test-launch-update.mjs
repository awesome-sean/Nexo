import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { buildSync } from 'esbuild';

function harness() {
  const child = new EventEmitter();
  let unref = false;
  child.unref = () => { unref = true; };
  let call;
  const module = { exports: {} };
  const code = buildSync({entryPoints:['src/main/services/launch-update.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['node:*']}).outputFiles[0].text;
  vm.runInNewContext(code, {module,exports:module.exports,require(name) {
    if (name === 'node:child_process') return {spawn:(...args) => {call=args; return child;}};
    throw new Error(name);
  }});
  return {child,launch:module.exports.launchUpdate,call:()=>call,unref:()=>unref};
}

test('the verified EXE opens as a visible assisted installer without automatic or silent flags', async () => {
  const app=harness();let closed=0;
  const file='C:/Users/test/updates/Nexo-Setup-1.0.2.exe';
  const pending=app.launch(file,()=>{closed++;});
  app.child.emit('spawn');await pending;
  const [executable,args,options]=app.call();
  assert.equal(executable,file);
  assert.equal(args.length,0);
  assert.equal(options.windowsHide,false);
  assert.equal(options.detached,true);
  assert.equal(app.unref(),true);
  assert.equal(closed,0);
  app.child.emit('exit',0);assert.equal(closed,1);
});

test('launch failure returns an error while Nexo stays running', async () => {
  const app=harness();
  const pending=app.launch('C:/missing.exe',()=>{});
  app.child.emit('error',new Error('ENOENT'));
  await assert.rejects(pending,/ENOENT/);
  assert.equal(app.unref(),false);
});

test('desktop update IPC keeps the app open and reports when the installer closes', () => {
  const main=fs.readFileSync('src/main/index.ts','utf8');
  const section=main.split("ipcMain.handle('pulse:install-update'")[1].split("ipcMain.handle('pulse:open-release'")[0];
  assert.match(section,/hasActiveInstallation/);
  assert.match(section,/launchUpdate\(desktopUpdate\.verifiedInstaller\(\),/);
  assert.match(section,/installer-closed/);
  assert.doesNotMatch(section,/quitPulse|app\.quit|app\.exit/);
  assert.match(section,/shell\.openExternal\(info\.installer\.url\)/);
});
