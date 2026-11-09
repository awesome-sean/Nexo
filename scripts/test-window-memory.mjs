import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {releaseHiddenWindow} from '../src/main/services/release-hidden-window.ts';

class Window extends EventEmitter {
  visible = false;
  destroyed = false;
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('hidden window releases its renderer, while showing cancels release', async () => {
  const window = new Window();
  releaseHiddenWindow(window, () => false, 10);
  window.emit('hide');
  window.visible = true;
  window.emit('show');
  await pause(25);
  assert.equal(window.destroyed, false);
  window.visible = false;
  window.emit('hide');
  await pause(25);
  assert.equal(window.destroyed, true);
});
test('active installation defers release until it finishes', async () => {
  const window = new Window();
  let busy = true;
  releaseHiddenWindow(window, () => busy, 10);
  window.emit('hide');
  await pause(25);
  assert.equal(window.destroyed, false);
  busy = false;
  await pause(25);
  assert.equal(window.destroyed, true);
});
