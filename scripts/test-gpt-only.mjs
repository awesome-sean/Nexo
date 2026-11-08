import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildSync} from 'esbuild';
import {resolveMiniBarSettings} from '../src/common/minibar-settings.ts';

test('legacy multi-Agent settings migrate to one GPT without custom API sources',()=>{
 const settings=resolveMiniBarSettings({visibleAgents:['claude','antigravity','custom-api'],customAgents:[{id:'custom-api',name:'Old API',icon:'custom',color:'#000000',source:'api'}],capsuleScale:1.25,backgroundOpacity:.7});
 assert.deepEqual(settings.visibleAgents,['codex']);assert.deepEqual(settings.customAgents,[]);
 assert.equal(settings.capsuleScale,1.25);assert.equal(settings.backgroundOpacity,.7);
});
test('the shipped main bundle has no other AI collectors or third-party source handlers',()=>{
 const bundle=buildSync({entryPoints:['src/main/index.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['electron'],define:{'import.meta.dirname':JSON.stringify(path.resolve('dist-electron/main'))}}).outputFiles[0].text;
 assert.ok(!bundle.includes('platform.claude.com'));
 assert.ok(!bundle.includes('minibar:configure-api'));
 assert.ok(!bundle.includes('minibar:test-api'));
 assert.ok(!bundle.includes('AntigravitySessionPoller'));
 assert.ok(bundle.includes('PermissionRequest'));
});
