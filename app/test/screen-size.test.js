'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { floorToEven, nativePixelSize } = require('../src/shared/screen-size');

// The three cases below were measured on a real four-monitor machine, where the
// naive multiplication reported a 4K panel as 3841x2161.
test('a 4K panel at 175% resolves to 3840x2160, not 3841x2161', () => {
  assert.deepStrictEqual(nativePixelSize({ width: 2195, height: 1235 }, 1.75), {
    width: 3840,
    height: 2160
  });
});

test('a laptop panel at 150% resolves to 1920x1200', () => {
  assert.deepStrictEqual(nativePixelSize({ width: 1281, height: 800 }, 1.5), {
    width: 1920,
    height: 1200
  });
});

test('an unscaled display is left exactly as it is', () => {
  assert.deepStrictEqual(nativePixelSize({ width: 1920, height: 1080 }, 1), {
    width: 1920,
    height: 1080
  });
});

test('sizes are always even, because encoders subsample chroma', () => {
  assert.strictEqual(floorToEven(1921), 1920);
  assert.strictEqual(floorToEven(1920), 1920);
  assert.strictEqual(floorToEven(1921.9), 1920);
  assert.strictEqual(floorToEven(3841.25), 3840);
});

test('a nonsense scale factor does not produce a nonsense size', () => {
  assert.deepStrictEqual(nativePixelSize({ width: 1920, height: 1080 }, 0), {
    width: 1920,
    height: 1080
  });
  assert.deepStrictEqual(nativePixelSize({ width: 1920, height: 1080 }, undefined), {
    width: 1920,
    height: 1080
  });
});

test('a missing size degrades to something usable rather than zero', () => {
  const result = nativePixelSize(null, 2);
  assert.ok(result.width >= 2 && result.height >= 2);
});
