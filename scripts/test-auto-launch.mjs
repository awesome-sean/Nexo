import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildSync, transformSync } from 'esbuild';
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
  assert.deepEqual(Array.from(writes[0].args),['--autostart']);
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
        if (!failWrite) launchItems = options.openAtLogin ? [{name:'Nexo',scope:'user',args:options.args,enabled:options.enabled}] : [];
      },
    },
    BrowserWindow: {getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(...args)=>notifications.push(args)}}]},
  };
  const module = {exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,process:{platform:'win32',execPath:executable},require:name=>{assert.equal(name,'electron');return electron;}});
  const service = module.exports;
  assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(true),true);
  assert.deepEqual(Array.from(lastQuery.args),['--autostart']);
  launchItems[0].enabled=false; assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(true),true);
  launchItems=[{name:'AnotherApp',scope:'user',args:[],enabled:true},{name:'Nexo',scope:'machine',args:[],enabled:true},{name:'Nexo',scope:'user',args:['--other'],enabled:true}];
  assert.equal(service.getAutoLaunch(),false);
  assert.equal(service.setAutoLaunch(false),false);
  failWrite=true;
  assert.throws(()=>service.setAutoLaunch(true),/开机自启动设置未生效/);
  assert.equal(notifications.length,3);
});

test('legacy startup registration gains the background argument and preserves Windows disabled state', () => {
  const source = buildSync({entryPoints:['src/main/services/auto-launch.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['electron']}).outputFiles[0].text;
  for (const enabled of [true, false]) {
    let entry = {name:'Nexo',scope:'user',args:[],enabled};
    const writes = [];
    const electron = {app:{isPackaged:true,
      getLoginItemSettings:()=>({launchItems:[entry]}),
      setLoginItemSettings:options=>{writes.push(options);entry={...entry,args:options.args,enabled:options.enabled};},
    }};
    const module = {exports:{}};
    vm.runInNewContext(source,{module,exports:module.exports,process:{platform:'win32',execPath:'C:/Nexo/Nexo.exe',argv:['Nexo.exe','--autostart']},require:()=>electron});
    module.exports.migrateAutoLaunchEntry();
    assert.equal(writes.length,1);
    assert.equal(writes[0].enabled,enabled);
    assert.deepEqual(Array.from(writes[0].args),['--autostart']);
    assert.equal(module.exports.isAutoStartLaunch(),true);
    assert.equal(module.exports.isAutoStartLaunch(['Nexo.exe']),false);
    module.exports.migrateAutoLaunchEntry();
    assert.equal(writes.length,1);
  }
});

test('Windows login keeps the real main-window ready handler hidden while manual launch opens it', () => {
  const source = fs.readFileSync('src/main/index.ts','utf8');
  const launch = fs.readFileSync('src/main/services/auto-launch.ts','utf8');
  const detector = launch.slice(launch.indexOf('export function isAutoStartLaunch'),launch.indexOf('\nfunction startupEntry')).replace('export ','');
  const startup = source.slice(source.indexOf('let showMainOnReady'),source.indexOf('const sessionManager'));
  const windowFunction = source.slice(source.indexOf('function createWindow()'),source.indexOf('// IPC Handlers'));
  const code = transformSync(`const AUTO_START_ARGUMENT='--autostart';\n${detector}\n${startup}\n${windowFunction}\ncreateWindow();`,{loader:'ts',format:'cjs',define:{'import.meta.dirname':JSON.stringify(process.cwd()+'/dist-electron/main')}}).code;
  for (const automatic of [true,false]) {
    const app = new EventEmitter();
    let window, minimized = false, restored = 0;
    class Window extends EventEmitter {
      constructor(options) {super();window=this;this.visible=options.show;this.focused=false;this.webContents=new EventEmitter();}
      show(){this.visible=true;} hide(){this.visible=false;} focus(){this.focused=true;}
      isMinimized(){return minimized;} restore(){minimized=false;restored++;}
      getBounds(){return {};} loadFile(){}
    }
    vm.runInNewContext(code,{app,BrowserWindow:Window,
      process:{argv:automatic?['Nexo.exe','--autostart']:['Nexo.exe'],env:{}},
      path,fs:{existsSync:()=>false},screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1920,height:1080}})},
      INITIAL_SCREEN:'main',sessionManager:new EventEmitter(),coreBridge:{attach(){}},appInstallService:{attach(){}},
      createTray(){},quitPulse(){},toggleMiniBar(){},isMiniBarVisible(){},console:{log(){}},
    });
    assert.equal(window.visible,false);
    window.emit('ready-to-show');
    assert.equal(window.visible,!automatic);
    assert.equal(window.focused,!automatic);
    window.hide();window.focused=false;
    app.emit('second-instance',{},['Nexo.exe','--autostart']);
    assert.equal(window.visible,false);
    minimized=true;
    app.emit('second-instance',{},['Nexo.exe']);
    assert.equal(window.visible,true);
    assert.equal(window.focused,true);
    assert.equal(restored,1);
  }
});
