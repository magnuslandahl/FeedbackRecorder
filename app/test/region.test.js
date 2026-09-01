'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeDrag,
  clampRegion,
  scaleRegion,
  isWholeFrame,
  wholeFrame,
  describeRegion
} = require('../src/shared/region');

test('a drag up and to the left is the same rectangle as a drag down and right', () => {
  const down = normalizeDrag({ x: 10, y: 20 }, { x: 110, y: 220 });
  const up = normalizeDrag({ x: 110, y: 220 }, { x: 10, y: 20 });
  assert.deepStrictEqual(down, { x: 10, y: 20, width: 100, height: 200 });
  assert.deepStrictEqual(up, down);
});

test('a region that hangs off the frame is pulled back inside it', () => {
  const clamped = clampRegion({ x: 1800, y: 1000, width: 400, height: 400 }, 1920, 1080);
  assert.deepStrictEqual(clamped, { x: 1520, y: 680, width: 400, height: 400 });
});

test('a region larger than the frame becomes the frame', () => {
  const clamped = clampRegion({ x: -50, y: -50, width: 5000, height: 5000 }, 1920, 1080);
  assert.deepStrictEqual(clamped, wholeFrame(1920, 1080));
});

test('a region too small to be useful is widened rather than accepted', () => {
  const clamped = clampRegion({ x: 10, y: 10, width: 2, height: 2 }, 1920, 1080);
  assert.strictEqual(clamped.width, 16);
  assert.strictEqual(clamped.height, 16);
});

test('a missing region means the whole frame, not a crash', () => {
  assert.deepStrictEqual(clampRegion(null, 800, 600), wholeFrame(800, 600));
});

test('a selection drawn on a preview scales up to video pixels', () => {
  const onPreview = { x: 80, y: 45, width: 160, height: 90 };
  const inVideo = scaleRegion(onPreview, { width: 640, height: 360 }, { width: 1920, height: 1080 });
  assert.deepStrictEqual(inVideo, { x: 240, y: 135, width: 480, height: 270 });
});

test('scaling never produces a region outside the target frame', () => {
  const onPreview = { x: 630, y: 350, width: 40, height: 40 };
  const inVideo = scaleRegion(onPreview, { width: 640, height: 360 }, { width: 1920, height: 1080 });
  assert.ok(inVideo.x + inVideo.width <= 1920);
  assert.ok(inVideo.y + inVideo.height <= 1080);
});

test('the whole frame is recognised as the whole frame', () => {
  assert.ok(isWholeFrame({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080));
  assert.ok(isWholeFrame(null, 1920, 1080));
  assert.ok(!isWholeFrame({ x: 0, y: 0, width: 1900, height: 1080 }, 1920, 1080));
});

test('a region describes itself in a way a reader can act on', () => {
  assert.strictEqual(describeRegion(null, 1920, 1080), 'whole screen (1920x1080)');
  assert.strictEqual(
    describeRegion({ x: 100, y: 50, width: 800, height: 600 }, 1920, 1080),
    '800x600 at 100,50 of 1920x1080'
  );
});
