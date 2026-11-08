import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

test('the updater starts a detached helper and waits for Nexo to release its files', async () => {
  const child = new EventEmitter();
  let unref = false;
  child.unref = () => { unref = true; };
  let call;
  const module = { exports: {} };
  const code = buildSync({entryPoints:['src/main/services/launch-update.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['node:*'],define:{'import.meta.dirname':JSON.stringify('C:/Program Files/Nexo/resources/app.asar/dist-electron/main')}}).outputFiles[0].text;
  vm.runInNewContext(code, {module,exports:module.exports,process:{pid:4242,execPath:'C:/Program Files/Nexo/Nexo.exe'},require(name) {
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return {spawn:(...args) => {call=args; return child;}};
    throw new Error(name);
  }});
  const pending=module.exports.launchUpdate('C:/Users/test/updates/Nexo-Setup-2.0.2.exe');
  child.emit('spawn'); await pending;
  assert.equal(unref,true);
  assert.equal(call[0],'powershell.exe');
  assert.match(call[1][call[1].indexOf('-File')+1],/app\.asar\.unpacked[\\/]assets[\\/]apply-update\.ps1$/);
  assert.equal(call[1].at(-1),'C:/Program Files/Nexo');
  assert.equal(call[2].windowsHide,true);
  assert.equal(call[2].detached,true);
  assert.ok(JSON.parse(fs.readFileSync('package.json','utf8')).build.asarUnpack.includes('assets/apply-update.ps1'));
});

test('Windows PowerShell can parse and execute the helper with a mocked installer', {skip:process.platform!=='win32'}, () => {
  const helper=path.resolve('assets/apply-update.ps1').replaceAll("'","''");
  const harness=`
$ErrorActionPreference = 'Stop'
function Test-Path { param($LiteralPath,[switch]$PathType) return $true }
function Get-Process { param($Id,$ErrorAction) return $null }
function Start-Process {
  param($FilePath,$ArgumentList,$WindowStyle,[switch]$Wait,[switch]$PassThru)
  if ($FilePath -ne 'C:\\mock.exe') { throw 'Wrong installer' }
  if ($ArgumentList[-1] -ne '/D=C:\\Nexo Folder') { throw 'Wrong installation folder' }
  if ($ArgumentList[0] -ne '/S' -or $ArgumentList[1] -ne '--updated' -or $ArgumentList[2] -ne '--force-run') { throw 'Wrong installer flags' }
  if ($WindowStyle -ne 'Hidden') { throw 'Helper window must be hidden' }
  return [pscustomobject]@{ExitCode=0}
}
& '${helper}' -Installer 'C:\\mock.exe' -ApplicationPid 4242 -InstallDirectory 'C:\\Nexo Folder'
'ok'
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(harness,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr || result.stdout);
  assert.match(result.stdout,/ok/);
});
