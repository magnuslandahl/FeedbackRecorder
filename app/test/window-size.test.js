'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const size = require('../src/main/window-size');

test('a new window uses the compact default size', () => {
  assert.deepEqual(size.restore(undefined, { width: 1920, height: 1080 }), {
    width: 540, height: 700
  });
});

test('a resized window reopens at its last normal size', () => {
  const window = new EventEmitter();
  window.getNormalBounds = () => ({ x: 40, y: 60, width: 870, height: 910 });
  let settings;
  size.remember(window, (patch) => { settings = patch; });
  window.emit('close');
  assert.deepEqual(settings, { windowSize: { width: 870, height: 910 } });
  assert.deepEqual(size.restore(settings.windowSize, { width: 1920, height: 1080 }), {
    width: 870, height: 910
  });
});

test('a smaller display fits the remembered window without preserving stale position', () => {
  assert.deepEqual(
    size.restore({ width: 1600, height: 1200 }, { width: 1200, height: 800 }),
    { width: 1200, height: 800 }
  );
});

test('invalid saved sizes fall back to the default', () => {
  for (const saved of [null, { width: 0, height: 900 }, { width: '870', height: 910 }]) {
    assert.deepEqual(size.restore(saved, { width: 1920, height: 1080 }), {
      width: 540, height: 700
    });
  }
});
