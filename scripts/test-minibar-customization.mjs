import { quotaUsageColor } from '../src/common/quota-colors.ts';
import { getMiniBarRenderScale } from '../src/common/minibar-settings.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { resolveMiniBarSettings } from '../src/common/minibar-settings.ts';
import {
  getMiniBarCollapsedSize,
  calculateWindowBoundsForState,
  calculateCollapsedBounds,
  calculateEdgeTabBounds,
  restoreAnchorFromEdgeTab,
  configureMiniBarGeometry,
  calculateStartupPosition,
} from '../src/main/services/minibar-geometry.ts';

const require = createRequire(import.meta.url);
const compiled = buildSync({
  entryPoints: ['src/main/minibar-window.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  define: {
    'import.meta.dirname': JSON.stringify(path.resolve('dist-electron/main')),
  },
}).outputFiles[0].text;

function runtime(initialPreferences = {}, nativeMinimum = { width: 0, height: 0 }) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nexo-minibar-test-'),
  );
  fs.writeFileSync(
    path.join(directory, 'minibar-preferences.json'),
    JSON.stringify(initialPreferences),
  );
  const windows = [];
  const timers = new Map();
  const handlers = new Map();
  const ipc = new EventEmitter();
  ipc.handle = (name, handler) => handlers.set(name, handler);
  ipc.removeHandler = (name) => handlers.delete(name);
  let cursor = { x: 960, y: 0 };
  let nextTimer = 0;
  let failSave = false;
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  class Window extends EventEmitter {
    constructor(bounds) {
      super();
      this.bounds = { ...bounds };
      this.zoomFactor = bounds.webPreferences?.zoomFactor ?? 1;
      this.messages = [];
      this.webContents = Object.assign(new EventEmitter(), {
        setZoomFactor: factor => { this.zoomFactor = factor; },
        send: (channel, payload) => this.messages.push({ channel, payload }),
      });
      this.visible = false;
      windows.push(this);
    }
    static getAllWindows() {
      return windows;
    }
    getBounds() {
      return { ...this.bounds };
    }
    setBounds(bounds) {
      this.bounds = { ...this.bounds, ...bounds };
      this.bounds.width = Math.max(nativeMinimum.width, this.bounds.width);
      this.bounds.height = Math.max(nativeMinimum.height, this.bounds.height);
    }
    setPosition(x, y) {
      this.setBounds({ x, y });
    }
    isDestroyed() {
      return false;
    }
    isVisible() {
      return this.visible;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {}
    loadFile() {}
    loadURL() {}
    destroy() {}
  }
  const main = new Window({ x: 0, y: 0, width: 1120, height: 760 });
  const electron = {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from('test-encrypted:' + value),
      decryptString: (value) =>
        value.toString().slice('test-encrypted:'.length),
    },
    app: { getPath: () => directory },
    BrowserWindow: Window,
    ipcMain: ipc,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: () => ({ workArea }),
      getPrimaryDisplay: () => ({ workArea }),
      getAllDisplays: () => [{ workArea }],
    },
    Menu: { buildFromTemplate: (template) => ({ popup() {}, template }) },
  };
  const mockFs = {
    ...fs,
    renameSync: (...args) => {
      if (failSave) throw new Error('save rejected');
      return fs.renameSync(...args);
    },
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    process,
    console,
    fetch: async () => new Response('{"balance":42}'),
    Buffer,
    AbortSignal,
    URL,
    require: (name) =>
      name === 'electron'
        ? electron
        : name === 'node:fs'
          ? mockFs
          : require(name),
    setInterval: (callback, delay) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(compiled, context);
  const service = module.exports;
  const sessions = new EventEmitter();
  sessions.getAllSessions = () => [];
  const window = service.createMiniBarWindow(sessions, {
    getQuotas: () => ({}),
    getTrafficLight: () => ({state:'idle',sampledAt:Date.now(),counts:{idle:0,working:0,waiting:0,done:0},expiresAt:null}),
  });
  return {
    service,
    window,
    main,
    ipc,
    invoke: (name, argument) => handlers.get(name)({}, argument),
    preferences: () =>
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'minibar-preferences.json'),
          'utf8',
        ),
      ),
    setCursor: (point) => {
      cursor = point;
    },
    tickDrag: () => {
      const timer = [...timers.values()].find(({ delay }) => delay === 16);
      assert.ok(timer, 'drag loop must be active');
      timer.callback();
    },
    failSave: (value) => {
      failSave = value;
    },
    cleanup: () => {
      service.disposeMiniBar();
      assert.ok(
        path
          .resolve(directory)
          .startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('startup floating visibility follows the saved user switch', () => {
  for (const visible of [true, false]) {
    const state = runtime({visible});
    try {
      assert.equal(state.window.visible,false);
      state.window.emit('ready-to-show');
      assert.equal(state.window.visible,visible);
      assert.equal(state.preferences().visible,visible);
    } finally {state.cleanup();}
  }
});

test('one to three agents keep stable anchors through all dock transitions', () => {
  for (let count = 1; count <= 3; count++) {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const size = getMiniBarCollapsedSize(side, count);
      let anchor = { x: 400, y: 200 };
      for (let repetition = 0; repetition < 100; repetition++) {
        const expanded = calculateWindowBoundsForState(
          anchor,
          true,
          side,
          count,
        );
        anchor = calculateCollapsedBounds(expanded, true, side, count);
        const tag = calculateEdgeTabBounds(anchor, side, size.height, count);
        anchor = restoreAnchorFromEdgeTab(tag, side, size.height, count);
        assert.deepEqual(anchor, { x: 400, y: 200 });
      }
    }
  }
});

test('manual API configuration uses the normal IPC path and removes credentials with the Agent', async () => {
  const app = runtime();
  try {
    app.invoke('minibar:set-settings', {
      customAgents: [
        {
          id: 'custom-api',
          name: 'API',
          icon: 'custom',
          color: '#BE9AF0',
          source: 'api',
        },
      ],
      visibleAgents: ['custom-api'],
    });
    app.invoke('minibar:configure-api', {
      id: 'custom-api',
      endpoint: 'https://quota.example/balance',
      apiKey: 'test-private-key',
      template: 'json',
      remainingPath: 'balance',
      unit: 'USD',
      confirmedOrigin: 'https://quota.example',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      app.invoke('minibar:get-state').customQuotas['custom-api'].plans[0]
        .remaining,
      42,
    );
    assert.equal(
      app.invoke('minibar:get-settings').customAgents[0].apiOrigin,
      'https://quota.example',
    );
    assert.ok(!JSON.stringify(app.preferences()).includes('test-private-key'));
    app.invoke('minibar:set-settings', { customAgents: [], visibleAgents: [] });
    assert.equal(
      app.invoke('minibar:get-state').customQuotas['custom-api'],
      undefined,
    );
    assert.ok(
      !Buffer.from(app.preferences().manualApiSources, 'base64')
        .toString()
        .includes('test-private-key'),
    );
  } finally {
    app.cleanup();
  }
});

test('long dragging restores canonical dimensions and rejects hover expansion', () => {
  const app = runtime();
  try {
    app.ipc.emit('minibar:drag-start', {});
    app.ipc.emit('minibar:drag-end', {});
    app.ipc.emit('minibar:drag-start', {});
    for (let frame = 0; frame < 1000; frame++) {
      app.window.bounds.width += 2;
      app.window.bounds.height += 1;
      app.tickDrag();
      app.ipc.emit('minibar:set-expanded', {}, true);
      assert.equal(app.window.bounds.width, 129);
      assert.equal(app.window.bounds.height, 66);
    }
    app.ipc.emit('minibar:drag-end', {});
    app.invoke('minibar:set-settings', { visibleAgents: ['codex'] });
    assert.equal(app.window.bounds.width, 129);
    assert.equal(app.window.bounds.height, 66);
  } finally {
    app.cleanup();
  }
});

test('hover reveal stays temporary and repeated enter/leave preserves the edge label', () => {
  const app = runtime();
  try {
    app.invoke('minibar:set-settings', {
      visibleAgents: ['codex'],
      displayMode: 'edge-tab',
    });
    const original = app.window.getBounds();
    for (let repetition = 0; repetition < 100; repetition++) {
      app.ipc.emit('minibar:edge-peek', {}, true);
      assert.equal(app.invoke('minibar:get-state').edgePeekActive, true);
      assert.equal(app.preferences().displayMode, 'edge-tab');
      app.ipc.emit('minibar:edge-peek', {}, false);
      assert.deepEqual(app.window.getBounds(), original);
    }
    app.invoke('minibar:set-settings', { hoverReveal: false });
    app.ipc.emit('minibar:edge-peek', {}, true);
    assert.deepEqual(app.window.getBounds(), original);
  } finally {
    app.cleanup();
  }
});

test('preferences migrate opacity, preserve legacy visibility and allow empty selection', () => {
  const app = runtime({ visible: false, dockPreference: 'left' });
  try {
    assert.equal(
      app.invoke('minibar:get-settings', 0.5).backgroundOpacity,
      0.5,
    );
    app.invoke('minibar:set-settings', { visibleAgents: ['codex'] });
    assert.equal(app.preferences().visible, false);
    assert.equal(app.preferences().dockPreference, 'left');
    assert.equal(app.preferences().backgroundOpacity, 0.5);
    app.invoke('minibar:set-settings', { visibleAgents: [] });
    assert.deepEqual(app.preferences().visibleAgents, []);
    assert.equal(
      resolveMiniBarSettings({ backgroundOpacity: Infinity }).backgroundOpacity,
      0.94,
    );
  } finally {
    app.cleanup();
  }
});

test('a failed preference write preserves both persisted and active values', () => {
  const app = runtime();
  try {
    app.invoke('minibar:set-settings', { backgroundOpacity: 0.6 });
    app.failSave(true);
    assert.throws(
      () => app.invoke('minibar:set-settings', { backgroundOpacity: 0.4 }),
      /save rejected/,
    );
    assert.equal(app.preferences().backgroundOpacity, 0.6);
    assert.equal(app.invoke('minibar:get-settings').backgroundOpacity, 0.6);
    app.invoke('minibar:open-settings');
    assert.ok(
      app.main.messages.some(
        ({ channel }) => channel === 'nexo:open-minibar-settings',
      ),
    );
  } finally {
    app.cleanup();
  }
});

test('agent changes near the screen bottom preserve the capsule position while details fit', () => {
  const app = runtime();
  try {
    app.invoke('minibar:set-settings', { visibleAgents: ['codex'] });
    app.setCursor({ x: 1910, y: 1000 });
    app.ipc.emit('minibar:drag-start', {});
    app.ipc.emit('minibar:drag-end', {});
    const initial = app.window.getBounds();
    app.ipc.emit('minibar:set-expanded', {}, true);
    let state = app.invoke('minibar:get-state');
    assert.equal(app.window.bounds.y + state.dockOffset.y, initial.y);
    assert.ok(app.window.bounds.y + app.window.bounds.height <= 1040);
    app.invoke('minibar:set-settings', { visibleAgents: ['claude', 'codex'] });
    state = app.invoke('minibar:get-state');
    const logicalY = app.window.bounds.y + state.dockOffset.y;
    assert.ok(logicalY + getMiniBarCollapsedSize('right', 2).height <= 1040);
    app.ipc.emit('minibar:set-expanded', {}, false);
    assert.equal(app.window.bounds.y, logicalY);
    assert.equal(app.window.bounds.height, 248);
  } finally {
    app.cleanup();
  }
});

test('unlimited custom agents persist and native viewports stay inside the display', () => {
  const app = runtime();
  try {
    const customAgents = Array.from({ length: 100 }, (_, index) => ({
      id: 'custom-' + index,
      name: 'Agent ' + index,
      icon: 'custom',
      color: '#BE9AF0',
      source: 'api',
    }));
    const visibleAgents = customAgents.map((agent) => agent.id);
    app.invoke('minibar:set-settings', { customAgents, visibleAgents });
    assert.equal(app.preferences().visibleAgents.length, 100);
    assert.equal(app.preferences().customAgents.length, 100);
    let state = app.invoke('minibar:get-state');
    assert.ok(state.dockViewportCount > 3);
    assert.ok(app.window.bounds.height <= 1040);
    app.ipc.emit('minibar:drag-start', {});
    app.ipc.emit('minibar:drag-end', {});
    state = app.invoke('minibar:get-state');
    assert.ok(state.dockViewportCount > 3);
    assert.ok(app.window.bounds.width <= 1920);
    assert.ok(app.window.bounds.x >= 0);
    assert.ok(app.window.bounds.x + app.window.bounds.width <= 1920);
    app.ipc.emit('minibar:set-expanded', {}, true);
    assert.ok(app.window.bounds.width <= 1920);
    app.ipc.emit('minibar:set-expanded', {}, false);
    app.invoke('minibar:set-settings', { visibleAgents: [] });
    assert.deepEqual(app.preferences().visibleAgents, []);
  } finally {
    app.cleanup();
  }
});

test('resizing synchronizes native bounds with the compact 100 percent baseline', () => {
  const app = runtime({visibleAgents:['codex']});
  try {
    assert.equal(app.invoke('minibar:get-settings').capsuleScale, 1);
    assert.equal(app.window.zoomFactor, 0.75);
    assert.equal(app.window.bounds.width, 84);
    for (const scale of [1.5, 0.75, 1, 1.5]) {
      app.invoke('minibar:set-settings', {capsuleScale:scale});
      const zoom = getMiniBarRenderScale(scale);
      assert.equal(app.window.zoomFactor, zoom);
      assert.ok(app.window.bounds.width / zoom >= 112);
      assert.ok(app.window.bounds.height / zoom >= 132);
      app.ipc.emit('minibar:set-expanded', {}, true);
      assert.ok(app.window.bounds.width / zoom >= 410);
      assert.ok(app.window.bounds.height / zoom >= 380);
      app.ipc.emit('minibar:set-expanded', {}, false);
    }
    app.setCursor({x:960,y:0});
    app.ipc.emit('minibar:drag-start', {});
    app.ipc.emit('minibar:drag-end', {});
    for (const scale of [0.75, 1, 1.5]) {
      app.invoke('minibar:set-settings', {capsuleScale:scale});
      const zoom = getMiniBarRenderScale(scale);
      assert.ok(app.window.bounds.width / zoom >= 172);
      assert.ok(app.window.bounds.height / zoom >= 88);
    }
  } finally { app.cleanup(); }
});

test('floating quota colors follow consumed percentages at every threshold', () => {
  assert.equal(quotaUsageColor(0), '#00CC96');
  assert.equal(quotaUsageColor(49.99), '#00CC96');
  assert.equal(quotaUsageColor(50), '#EBCB4B');
  assert.equal(quotaUsageColor(74.99), '#EBCB4B');
  assert.equal(quotaUsageColor(75), '#F59A38');
  assert.equal(quotaUsageColor(99.99), '#F59A38');
  assert.equal(quotaUsageColor(100), '#F04452');
  assert.equal(quotaUsageColor(120), '#F04452');
  assert.equal(quotaUsageColor(null), '#6B7280');
});

test('edge gap settings preserve legacy defaults and normalize numeric input', () => {
  assert.equal(resolveMiniBarSettings().edgeGap, 12);
  for (const [input, expected] of [[-1,0],[0,0],[12.4,12],[24,24],[80,64],[NaN,12],[Infinity,12]]) {
    assert.equal(resolveMiniBarSettings({edgeGap:input}).edgeGap,expected);
  }
});

test('edge gap moves the visible capsule through normal IPC and keeps tabs on all four edges', () => {
  const app = runtime();
  try {
    const sides = {left:{x:0,y:520},right:{x:1920,y:520},top:{x:960,y:0},bottom:{x:960,y:1040}};
    function visibleGap(side) {
      const state=app.invoke('minibar:get-state');
      const b=app.window.bounds;
      const zoom=app.window.zoomFactor;
      const x=b.x+state.dockOffset.x*zoom;
      const y=b.y+state.dockOffset.y*zoom;
      if(side==='left') return x+16*zoom;
      if(side==='right') return 1920-x-96*zoom;
      if(side==='top') return y+16*zoom;
      return 1040-y-96*zoom;
    }
    function checkTab(side) {
      const b=app.window.bounds;
      if(side==='left') assert.equal(b.x,0);
      if(side==='right') assert.equal(b.x+b.width,1920);
      if(side==='top') assert.equal(b.y,0);
      if(side==='bottom') assert.equal(b.y+b.height,1040);
    }
    for(const [side,cursor] of Object.entries(sides)) {
      app.setCursor(cursor);
      app.ipc.emit('minibar:drag-start',{});
      app.ipc.emit('minibar:drag-end',{});
      for(const scale of [.75,1,1.5]) for(const gap of [0,12,24,64]) {
        app.invoke('minibar:set-settings',{edgeGap:gap,capsuleScale:scale});
        assert.equal(app.preferences().edgeGap,gap);
        assert.ok(Math.abs(visibleGap(side)-gap)<=1,`${side} scale=${scale} gap=${gap} actual=${visibleGap(side)}`);
        app.ipc.emit('minibar:set-expanded',{},true);
        assert.ok(Math.abs(visibleGap(side)-gap)<=1);
        app.ipc.emit('minibar:set-expanded',{},false);
        app.service.setDisplayMode('edge-tab');
        checkTab(side);
        app.invoke('minibar:set-settings',{edgeGap:gap===64?0:gap+1});
        checkTab(side);
        app.service.setDisplayMode('full');
        assert.ok(Math.abs(visibleGap(side)-app.preferences().edgeGap)<=1);
        app.ipc.emit('minibar:edge-peek',{},false);
      }
    }
    app.invoke('minibar:set-settings',{edgeGap:24});
    app.service.resetMiniBarDock();
    assert.ok(Math.abs(visibleGap('right')-24)<=1);
    app.invoke('minibar:set-settings',{edgeGap:0});
    app.service.toggleMiniBar();
    app.service.toggleMiniBar();
    assert.ok(Math.abs(visibleGap('right'))<=1);
  } finally {app.cleanup();}
});

test('larger context menu has independent window space and preserves every dock anchor',()=>{
 const app=runtime();
 try{
   for(const cursor of [{x:0,y:800},{x:1920,y:800},{x:960,y:0},{x:960,y:1040}]){
     app.setCursor(cursor);app.ipc.emit('minibar:drag-start',{});app.ipc.emit('minibar:drag-end',{});
     const collapsed={...app.window.bounds};
     app.ipc.emit('minibar:set-expanded',{},true,'details');
     const detailHeight=app.window.bounds.height;
     app.ipc.emit('minibar:set-expanded',{},true,'menu');
     assert.ok(app.window.bounds.height>detailHeight);
     assert.ok(app.window.bounds.height<=1040);
     const state=app.invoke('minibar:get-state');
     assert.ok(Math.abs(app.window.bounds.x+state.dockOffset.x*app.window.zoomFactor-collapsed.x)<1);
     assert.ok(Math.abs(app.window.bounds.y+state.dockOffset.y*app.window.zoomFactor-collapsed.y)<1);
     app.ipc.emit('minibar:set-expanded',{},false,'menu');
     assert.equal(app.window.bounds.x,collapsed.x);assert.equal(app.window.bounds.y,collapsed.y);
   }
 }finally{app.cleanup();}
});

test('edge labels retain complete SVG space and touch every edge while resizing', () => {
  const app = runtime({}, {width:40, height:47});
  const cursors = {left:{x:0,y:520},right:{x:1920,y:520},top:{x:960,y:0},bottom:{x:960,y:1040}};
  try {
    for (const [side, cursor] of Object.entries(cursors)) {
      app.service.setDisplayMode('full');
      app.setCursor(cursor);
      app.ipc.emit('minibar:drag-start', {});
      app.ipc.emit('minibar:drag-end', {});
      app.service.setDisplayMode('edge-tab');
      for (const scale of [.75, 1, 1.5, 1]) {
        app.invoke('minibar:set-settings', {capsuleScale:scale, edgeGap:64});
        const bounds = app.window.bounds;
        const zoom = app.window.zoomFactor;
        const horizontal = side === 'top' || side === 'bottom';
        assert.ok(bounds.width / zoom >= (horizontal ? 132 : 34));
        assert.ok(bounds.height / zoom >= (horizontal ? 34 : 132));
        if (side === 'left') assert.equal(bounds.x, 0);
        if (side === 'right') assert.equal(bounds.x + bounds.width, 1920);
        if (side === 'top') assert.equal(bounds.y, 0);
        if (side === 'bottom') assert.equal(bounds.y + bounds.height, 1040);
        app.service.toggleMiniBar(); app.service.toggleMiniBar();
        assert.deepEqual(app.window.bounds, bounds);
      }
    }
  } finally { app.cleanup(); }
});

test('four-way startup preferences restore all saved edges and along-edge positions', () => {
  const area = {x:-1920,y:0,width:1920,height:1040};
  for (const scale of [.45, .6, .9]) {
    configureMiniBarGeometry(scale, true, 12);
    for (const side of ['left','right','top','bottom']) {
      assert.equal(resolveMiniBarSettings({dockPreference:side}).dockPreference, side);
      for (const displayMode of ['full','edge-tab']) {
        const result = calculateStartupPosition({preference:'remember',saved:{x:-800,y:300,dockSide:side},primaryWorkArea:{...area,x:0},allWorkAreas:[area],displayMode});
        assert.equal(result.dockSide, side);
        if (displayMode === 'edge-tab') {
          if (side === 'left') assert.equal(result.x, area.x);
          if (side === 'right') assert.equal(result.x+result.width, 0);
          if (side === 'top') assert.equal(result.y, 0);
          if (side === 'bottom') assert.equal(result.y+result.height, area.height);
        }
        const fixed = calculateStartupPosition({preference:side,primaryWorkArea:{...area,x:0},allWorkAreas:[area]});
        assert.equal(fixed.dockSide, side);
        assert.ok(fixed.x >= -16 && fixed.x <1920);
      }
    }
  }
  configureMiniBarGeometry(1);
});

test('navigation restores isolated minibar zoom and manual font preferences persist', () => {
  const app = runtime({capsuleScale:.75});
  try {
    assert.equal(app.window.bounds.webPreferences.partition,'nexo-minibar');
    assert.equal(app.window.bounds.webPreferences.zoomFactor,getMiniBarRenderScale(.75));
    for (const scale of [.75,1,1.5]) {
      app.invoke('minibar:set-settings',{capsuleScale:scale});
      app.window.webContents.setZoomFactor(1);
      app.window.webContents.emit('did-finish-load');
      assert.equal(app.window.zoomFactor,getMiniBarRenderScale(scale));
      assert.equal(app.window.bounds.height, Math.ceil((537 * 80 / 132 + 32) * app.window.zoomFactor));
    }
    assert.equal(resolveMiniBarSettings().detailTextTheme,'light');
    assert.equal(resolveMiniBarSettings({detailTextTheme:'auto'}).detailTextTheme,'light');
    for (const detailTextTheme of ['dark','light']) {
      app.invoke('minibar:set-settings',{detailTextTheme});
      assert.equal(app.preferences().detailTextTheme,detailTextTheme);
      assert.equal(app.invoke('minibar:get-settings').detailTextTheme,detailTextTheme);
    }
  } finally { app.cleanup(); }
});

test('floating appearance persists through IPC without changing native dimensions', () => {
  const app = runtime();
  try {
    assert.equal(resolveMiniBarSettings().appearance, 'dark');
    assert.equal(resolveMiniBarSettings().showStatusText, false);
    assert.equal(resolveMiniBarSettings({appearance:'invalid'}).appearance, 'dark');
    const original = { ...app.window.bounds };
    for (const appearance of ['light', 'dark']) {
      app.invoke('minibar:set-settings', {appearance});
      assert.equal(app.preferences().appearance, appearance);
      assert.equal(app.invoke('minibar:get-settings').appearance, appearance);
      assert.equal(app.window.bounds.width, original.width);
      assert.equal(app.window.bounds.height, original.height);
      assert.equal(app.window.bounds.x, original.x);
      assert.equal(app.window.bounds.y, original.y);
    }
  } finally { app.cleanup(); }
});

