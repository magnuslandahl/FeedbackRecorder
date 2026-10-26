'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan, scanBySeeking, ambiguousTime, seekTime } = require('../src/renderer/video-sampling');

test('seek time matches both Chromium microsecond conversions at floating-point boundaries', () => {
  for (const [input, expected] of [
    [0, 0], [0.51666, 0.51666], [2.5833, 2.5833],
    [32.03292000000005, 32.032919], [64.58250000000015, 64.582499],
    [128.1316800000001, 128.131679], [256.26336000000003, 256.263359]
  ]) assert.equal(seekTime(input), expected);
});

test('timing gaps and overlaps keep the seek renderer at both boundaries', () => {
  assert.equal(ambiguousTime(1.02, 1, 0.96, 0.033), false);
  assert.equal(ambiguousTime(1.033, 1, null, 0.033), true);
  assert.equal(ambiguousTime(1.01, 1, 0.99, 0.033), true);
  assert.equal(ambiguousTime(1.023, 1, 0.99, 0.033), true);
  assert.equal(ambiguousTime(0, 0.04, null, 0.033), false);
});

test('compatibility sampling preserves actual seek times, signatures and progress', async () => {
  const video = {};
  const progress = [];
  const result = await scan({
    video, times: [0, 0.51666, 1.03332],
    seek: async (source, time) => { assert.equal(source, video); video.time = time; return time - 0.000001; },
    signature: (source) => new Uint8Array([Math.round(source.time * 10)]),
    onProgress: (fraction) => progress.push(fraction)
  });
  assert.equal(result.mode, 'seek');
  assert.deepEqual(result.samples.map((sample) => sample.time), [-0.000001, 0.516659, 1.033319]);
  assert.deepEqual(result.samples.map((sample) => [...sample.signature]), [[0], [5], [10]]);
  assert.deepEqual(progress, [1 / 3, 2 / 3, 1]);
});

test('cancellation stops compatibility sampling without collecting another image', async () => {
  let cancelled = false;
  let seeks = 0;
  let signatures = 0;
  await assert.rejects(scanBySeeking({
    video: {}, times: [0, 1, 2],
    check: () => { if (cancelled) throw new Error('cancelled by user'); },
    seek: async () => { seeks += 1; cancelled = true; return 0; },
    signature: () => { signatures += 1; return new Uint8Array(); },
    onProgress() {}
  }), /cancelled by user/);
  assert.equal(seeks, 1);
  assert.equal(signatures, 0);
});

test('the packaged browser bundle is unmodified and its license and source notice travel with it', () => {
  const appRoot = path.join(__dirname, '..');
  const source = path.join(appRoot, 'node_modules', 'mediabunny');
  const target = path.join(appRoot, 'src', 'renderer', 'vendor');
  assert.equal(fs.readFileSync(path.join(target, 'mediabunny.js')).equals(
    fs.readFileSync(path.join(source, 'dist', 'bundles', 'mediabunny.min.cjs'))), true);
  assert.equal(fs.readFileSync(path.join(target, 'Mediabunny-LICENSE.txt')).equals(
    fs.readFileSync(path.join(source, 'LICENSE'))), true);
  assert.match(fs.readFileSync(path.join(target, 'Mediabunny-NOTICE.txt'), 'utf8'),
    /https:\/\/github\.com\/Vanilagy\/mediabunny\/tree\/v1\.62\.1/);
});
