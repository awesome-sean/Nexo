import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

function service(directory = 'C:/Program Files/Nexo/resources/app.asar/dist-electron/main') {
  const calls = [];
  const code = buildSync({entryPoints:['src/main/services/open-codex.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['node:*'],define:{'import.meta.dirname':JSON.stringify(directory)}}).outputFiles[0].text;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,process:{platform:'win32'},require(name){
    if(name==='node:path') return path;
    if(name==='node:child_process') return {execFile:(...args)=>calls.push(args)};
    throw new Error('Unexpected module '+name);
  }});
  return {open:module.exports.openCodexWindow,calls};
}

test('double-click activation uses the unpacked script and coalesces concurrent launches', async () => {
  const app = service();
  const first=app.open(),second=app.open();
  assert.equal(first,second);assert.equal(app.calls.length,1);
  const [executable,args,options,complete]=app.calls[0];
  assert.equal(executable,'powershell.exe');
  assert.match(args.at(-1),/app\.asar\.unpacked[\\/]assets[\\/]focus-codex\.ps1$/);
  assert.equal(args.includes('-File'),true);
  assert.equal(options.windowsHide,true);assert.equal(options.timeout,25000);
  complete(null,'{"ok":true}');
  assert.equal((await first).ok,true);
  const next=app.open();assert.equal(app.calls.length,2);
  app.calls[1][3](null,'{"ok":true}');await next;
  assert.ok(JSON.parse(fs.readFileSync('package.json','utf8')).build.asarUnpack.includes('assets/focus-codex.ps1'));
});

test('launch failures and timeouts produce readable results without a rejected IPC request', async () => {
  const app=service();
  const missing=app.open();
  app.calls[0][3](new Error('exit 1'),JSON.stringify({ok:false,error:'未找到 Codex'}));
  assert.equal((await missing).error,'未找到 Codex');
  const timedOut=app.open();
  app.calls[1][3](Object.assign(new Error('timeout'),{killed:true}),'');
  assert.match((await timedOut).error,/超时/);
});

test('the helper identifies Codex packages before activating ChatGPT.exe processes', () => {
  const script=fs.readFileSync('assets/focus-codex.ps1','utf8');
  assert.match(script,/OpenAI\\\.Codex_/);
  assert.match(script,/SetForegroundWindow/);
  assert.match(script,/IsIconic\(window\) \? 9 : 5/);
  assert.match(script,/Start-Process.*-WindowStyle Hidden/);
});

test('the helper activates an existing window under Windows PowerShell 5.1', {skip:process.platform!=='win32'}, () => {
  const helper=path.resolve('assets/focus-codex.ps1').replaceAll("'","''");
  const harness=`
$ErrorActionPreference = 'Stop'
function Add-Type {
  param([string]$TypeDefinition)
  Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition @'
using System;
public static class NexoCodexWindow {
  public static IntPtr Find(UInt32[] processIds) {
    if (processIds.Length != 1 || processIds[0] != 4242) throw new Exception("Wrong process selection.");
    return new IntPtr(42);
  }
  public static bool Activate(IntPtr window) { return window.ToInt64() == 42; }
}
'@
}
function Get-Process {
  param($Name, $ErrorAction)
  [pscustomobject]@{Id=4242;Path='C:\\Program Files\\WindowsApps\\OpenAI.Codex_test\\app\\ChatGPT.exe'}
}
function Start-Process { throw 'An existing window must be activated directly.' }
& '${helper}'
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-EncodedCommand',Buffer.from(harness,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout.trim()).ok,true);
});
