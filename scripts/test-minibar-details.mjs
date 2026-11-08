import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = buildSync({
  entryPoints: ['src/renderer/components/minibar/MiniBarDetails.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['react', 'react/*'],
}).outputFiles[0].text;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require });
const { MiniBarDetails } = module.exports;

for (const [remaining, color] of [
  [100, '#45E459'],
  [51, '#45E459'],
  [50, '#FDCC03'],
  [26, '#FDCC03'],
  [25, '#F59A38'],
  [5, '#F59A38'],
  [1, '#F59A38'],
  [0, '#FF4545'],
]) {
  test(`weekly remaining ${remaining}% uses ${color} in the actual detail component`, () => {
    const html = renderToStaticMarkup(React.createElement(MiniBarDetails, {
      quotas: { codex: { pct5h: 100, pct7d: 100 - remaining } },
    }));
    const values = [...html.matchAll(/<strong style="color:([^";]+)">([^<]+)<\/strong>/g)];
    assert.equal(values.length, 2);
    assert.equal(values[0][1], '#FF4545');
    assert.equal(values[0][2], '0%');
    assert.equal(values[1][1], color);
    assert.equal(values[1][2], remaining + '%');
  });
}

test('weekly colors use the displayed rounded percentage at the boundaries', () => {
  for (const [used, remaining, color] of [[49.6,50,'#FDCC03'],[74.6,25,'#F59A38'],[99.6,0,'#FF4545']]) {
    const html = renderToStaticMarkup(React.createElement(MiniBarDetails, {
      quotas: { codex: { pct5h: 0, pct7d: used } },
    }));
    const values = [...html.matchAll(/<strong style="color:([^";]+)">([^<]+)<\/strong>/g)];
    assert.equal(values[1][1], color);
    assert.equal(values[1][2], remaining + '%');
  }
});

test('missing weekly quota keeps the unknown indicator', () => {
  const html = renderToStaticMarkup(React.createElement(MiniBarDetails, {}));
  assert.equal([...html.matchAll(/<strong style="color:#6B7280">—<\/strong>/g)].length, 2);
});
