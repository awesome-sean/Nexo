import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = buildSync({entryPoints:['src/main/tray.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['electron'],define:{'import.meta.dirname':JSON.stringify(process.cwd()+'/dist-electron/main')}}).outputFiles[0].text;

test('tray and preference changes share real startup state and refreshed visibility checkmarks', () => {
  let enabled = false, mainVisible = true, floatingVisible = false, packaged = true, lastMenu;
  const writes = [], notifications = [], errors = [];
  class Tray extends EventEmitter { setToolTip() {} popUpContextMenu(menu) { lastMenu=menu; } }
  const main = {isDestroyed:()=>false,isVisible:()=>mainVisible,show:()=>{mainVisible=true;},hide:()=>{mainVisible=false;},focus(){},webContents:{send:(...args)=>notifications.push(args)}};
  const electron = {
    Tray, Menu:{buildFromTemplate:items=>items}, nativeImage:{createEmpty:()=>({})},
    BrowserWindow:{getAllWindows:()=>[main]}, dialog:{showErrorBox:(...args)=>errors.push(args)},
    app:{get isPackaged(){return packaged;},getLoginItemSettings:()=>({openAtLogin:false,executableWillLaunchAtLogin:enabled,launchItems:enabled?[{name:'Nexo',scope:'user',args:[],enabled:true}]:[]}),setLoginItemSettings:options=>{writes.push(options);enabled=options.openAtLogin;}},
  };
  const module={exports:{}};
  vm.runInNewContext(bundle,{module,exports:module.exports,process:{platform:'win32',execPath:'C:/Nexo/Nexo.exe'},require:name=>name==='electron'?electron:name==='node:fs'?{existsSync:()=>false}:require(name)});
  const tray=module.exports.createTray(main,()=>{},()=>{floatingVisible=!floatingVisible;},()=>floatingVisible);
  tray.emit('right-click');
  assert.deepEqual(Array.from(lastMenu.slice(0,3),item=>[item.label,item.type,item.checked]),[['显示主界面','checkbox',true],['显示桌面悬浮窗','checkbox',false],['开机自启动','checkbox',false]]);
  lastMenu[0].click(); lastMenu[1].click();
  lastMenu[2].checked=true; lastMenu[2].click(lastMenu[2]);
  assert.equal(writes[0].path,'C:/Nexo/Nexo.exe'); assert.equal(writes[0].name,'Nexo'); assert.equal(writes[0].enabled,true);
  assert.equal(notifications[0][0],'nexo:auto-launch-changed'); assert.equal(notifications[0][1],true);
  tray.emit('right-click'); assert.equal(lastMenu[0].checked,false); assert.equal(lastMenu[1].checked,true); assert.equal(lastMenu[2].checked,true);
  lastMenu[2].checked=false; lastMenu[2].click(lastMenu[2]);
  assert.equal(writes[1].openAtLogin,false); assert.equal(notifications.at(-1)[1],false);
  enabled=false; tray.emit('right-click'); assert.equal(lastMenu[2].checked,false);
  packaged=false; lastMenu[2].checked=true; lastMenu[2].click(lastMenu[2]);
  assert.equal(errors.length,1); assert.equal(writes.length,2);
});

test('named startup entry handles spaced paths and Windows disabled entries without relying on openAtLogin', () => {
  const source = buildSync({entryPoints:['src/main/services/auto-launch.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['electron']}).outputFiles[0].text;
  const executable = 'C:\\Program Files\\Nexo\\Nexo.exe';
  let launchItems = [], lastQuery, failWrite = false;
  const notifications = [];
  const electron = {
    app: {
      isPackaged: true,
      getLoginItemSettings(options) {
        lastQuery = options;
        assert.equal(options.path, `"${executable}"`);
        return {openAtLogin:false,executableWillLaunchAtLogin:true,launchItems};
      },
      setLoginItemSettings(options) {
        assert.equal(options.name, 'Nexo'); assert.equal(options.path, executable);
        if (!failWrite) launchItems = options.openAtLogin ? [{name:'Nexo',scope:'user',args:[],enabled:options.enabled}] : [];
      },
    },
    BrowserWindow: {getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(...args)=>notifications.push(args)}}]},
  };
  const module = {exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,process:{platform:'win32',execPath:executable},require:name=>{assert.equal(name,'electron');return electron;}});
  const service = module.exports;
  assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(true),true);
  assert.deepEqual(Array.from(lastQuery.args),[]);
  launchItems[0].enabled=false; assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(true),true);
  launchItems=[{name:'AnotherApp',scope:'user',args:[],enabled:true},{name:'Nexo',scope:'machine',args:[],enabled:true},{name:'Nexo',scope:'user',args:['--other'],enabled:true}];
  assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(false),false);
  failWrite=true;
  assert.throws(()=>service.setAutoLaunch(true),/开机自启动设置未生效/);
  assert.equal(notifications.length,3);
});
