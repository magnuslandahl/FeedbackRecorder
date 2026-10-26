'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan, scanBySeeking, ambiguousTime, seekTime, simpleBlockTiming } = require('../src/renderer/video-sampling');

test('only SimpleBlock timing is accepted, including streaming clusters and skipped payload bytes', async () => {
  const segment = [0x18, 0x53, 0x80, 0x67, 0xff];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0xff];
  const simple = [0xa3, 0x84, 0xa0, 0x9b, 0xff, 0x00];
  assert.equal(await simpleBlockTiming(new Blob([new Uint8Array([...segment, ...cluster, ...simple, ...cluster, ...simple])])), true);
  assert.equal(await simpleBlockTiming(new Blob([new Uint8Array([...segment, ...cluster, 0xa0, 0x80])])), false);
  assert.equal(await simpleBlockTiming(new Blob([new Uint8Array([...segment, ...cluster, 0xa3, 0xff])])), false);
  assert.equal(await simpleBlockTiming(new Blob([new Uint8Array([0xec, 0x80])])), false);
  await assert.rejects(simpleBlockTiming(new Blob([new Uint8Array([...segment, ...cluster, 0xa3, 0x85, 0])])), /webm-size/);
  await assert.rejects(simpleBlockTiming(new Blob([new Uint8Array([0])])), /webm-header/);
  await assert.rejects(simpleBlockTiming(new Blob([new Uint8Array([...segment, ...cluster, ...simple])]), undefined,
    () => { throw new Error('cancelled'); }), /cancelled/);
});

test('the WebM timing check handles a header crossing its read buffer without scanning payloads', async () => {
  const size = 1024 * 1024 - 15;
  const bytes = new Uint8Array(1024 * 1024 + 1);
  bytes.set([0x18, 0x53, 0x80, 0x67, 0xff, 0x1f, 0x43, 0xb6, 0x75, 0xff,
    0xa3, 0x20 | (size >> 16), (size >> 8) & 255, size & 255]);
  bytes.set([0xa0, 0x80], bytes.length - 2);
  let reads = 0;
  assert.equal(await simpleBlockTiming(new Blob([bytes]), (part) => { reads += 1; return part.arrayBuffer(); }), false);
  assert.equal(reads, 2);
});

test('seek time matches both Chromium microsecond conversions at floating-point boundaries', () => {
  for (const [input, expected] of [
    [0, 0], [0.51666, 0.51666], [2.5833, 2.5833],
    [32.03292000000005, 32.032919], [64.58250000000015, 64.582499],
    [128.1316800000001, 128.131679], [256.26336000000003, 256.263359]
  ]) assert.equal(seekTime(input), expected);
});

test('timing gaps and overlaps keep the seek renderer at both boundaries', () => {
  const sample = { timestamp: 1, duration: 0.033 };
  assert.equal(ambiguousTime(1.02, sample, { timestamp: 0.96, duration: 0.033 }, 0.033), false);
  assert.equal(ambiguousTime(1.033, sample, null, 0.033), true);
  assert.equal(ambiguousTime(1.01, sample, { timestamp: 0.99, duration: 0.033 }, 0.033), true);
  assert.equal(ambiguousTime(1.023, sample, { timestamp: 0.99, duration: 0.033 }, 0.033), true);
  assert.equal(ambiguousTime(0, { timestamp: 0.04, duration: 0.033 }, null, 0.033), false);
});

test('variable durations consider both the current sample and preceding packet', () => {
  assert.equal(ambiguousTime(0.08, { timestamp: 0.05, duration: 0.02 }, null, 0.05), true);
  assert.equal(ambiguousTime(0.205, { timestamp: 0.18, duration: 0.09 }, { timestamp: 0.15, duration: 0.06 }, 0.05), true);
  // Native nominal timing still matters when packet durations are longer.
  assert.equal(ambiguousTime(0.08, { timestamp: 0.05, duration: 0.05 }, null, 0.02), true);
  assert.equal(ambiguousTime(0.061, { timestamp: 0.05, duration: 0.02 }, null, 0.05), false);
  for (const duration of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(ambiguousTime(0.01, { timestamp: 0, duration }, null, 0.05), true);
    assert.equal(ambiguousTime(0.01, { timestamp: 0, duration: 0.05 }, { timestamp: -0.1, duration }, 0.05), true);
  }
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
