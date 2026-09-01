'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  frameDistance,
  selectKeyframes,
  sampleIntervalSeconds
} = require('../src/shared/keyframes');

function signature(value, length) {
  return Uint8Array.from({ length: length || 64 }, () => value);
}

function sample(time, value) {
  return { time, signature: signature(value) };
}

test('identical frames are zero apart and opposites are one', () => {
  assert.strictEqual(frameDistance(signature(10), signature(10)), 0);
  assert.strictEqual(frameDistance(signature(0), signature(255)), 1);
});

test('a screen that never changes still yields frames', () => {
  const samples = Array.from({ length: 30 }, (_, i) => sample(i, 100));
  const chosen = selectKeyframes(samples);
  assert.ok(chosen.length >= 4, `expected a floor of frames, got ${chosen.length}`);
  assert.strictEqual(chosen[0].time, 0);
});

test('frames are taken where the screen actually changed', () => {
  const samples = [];
  for (let i = 0; i < 30; i += 1) {
    samples.push(sample(i, i < 10 ? 0 : i < 20 ? 120 : 240));
  }
  const chosen = selectKeyframes(samples);
  const times = chosen.map((item) => item.time);
  assert.ok(times.includes(10), `expected the first change at 10s, got ${times}`);
  assert.ok(times.includes(20), `expected the second change at 20s, got ${times}`);
});

test('a change that happens too soon after the last one is not a second frame', () => {
  const samples = [sample(0, 0), sample(0.2, 255), sample(0.4, 0)];
  const chosen = selectKeyframes(samples, { minCount: 1 });
  assert.strictEqual(chosen.length, 1);
});

test('a constantly changing screen is capped, keeping the biggest changes', () => {
  const samples = Array.from({ length: 60 }, (_, i) => sample(i * 2, (i * 37) % 256));
  const chosen = selectKeyframes(samples, { maxCount: 8 });
  assert.strictEqual(chosen.length, 8);
  const times = chosen.map((item) => item.time);
  assert.deepStrictEqual(times, times.slice().sort((a, b) => a - b));
});

test('the first frame is always kept', () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i, (i * 90) % 256));
  const chosen = selectKeyframes(samples, { maxCount: 5 });
  assert.strictEqual(chosen[0].index, 0);
});

test('no samples means no keyframes rather than an error', () => {
  assert.deepStrictEqual(selectKeyframes([]), []);
  assert.deepStrictEqual(selectKeyframes(null), []);
});

test('short recordings are sampled more often than long ones', () => {
  assert.ok(sampleIntervalSeconds(10) < sampleIntervalSeconds(60));
  assert.ok(sampleIntervalSeconds(60) <= sampleIntervalSeconds(600));
  assert.ok(sampleIntervalSeconds(3600) <= 5);
});
