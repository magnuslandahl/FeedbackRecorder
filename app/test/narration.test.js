'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  measureLevels,
  classifyNarration,
  meterWidth,
  meterTone,
  TOO_QUIET_DBFS
} = require('../src/shared/narration');

function tone(amplitude, length) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin((i / length) * Math.PI * 2 * 50) * amplitude;
  }
  return samples;
}

test('an empty buffer is reported as no audio rather than as silence', () => {
  const result = classifyNarration(measureLevels(new Float32Array(0)));
  assert.strictEqual(result.level, 'none');
});

test('digital silence is distinguished from quiet speech', () => {
  const result = classifyNarration(measureLevels(new Float32Array(16000)));
  assert.strictEqual(result.level, 'silent');
  assert.match(result.advice, /muted or disabled/);
});

test('speech at a normal level passes', () => {
  // Around -27 dBFS, which is what real narration measured in this project.
  const result = classifyNarration(measureLevels(tone(0.063, 16000)));
  assert.strictEqual(result.level, 'ok');
  assert.ok(result.rmsDbfs > TOO_QUIET_DBFS);
});

test('narration near the level of the run that produced nothing is called quiet', () => {
  // The failed run averaged -48.9 dBFS.
  const result = classifyNarration(measureLevels(tone(0.005, 16000)));
  assert.strictEqual(result.level, 'quiet');
  assert.match(result.advice, /expected rather than a failure/);
});

test('the measured level is reported, not just a verdict', () => {
  const levels = measureLevels(tone(0.5, 16000));
  assert.ok(Number.isFinite(levels.rmsDbfs));
  assert.ok(Number.isFinite(levels.peakDbfs));
  assert.ok(levels.peakDbfs > levels.rmsDbfs);
  assert.strictEqual(levels.sampleCount, 16000);
});

// The set-up meter and the recording bar draw the same band, so they have to
// map a level to a width the same way. The bar used to draw the raw level,
// which put ordinary speech at 5% of the track while the identical voice sat
// inside the marked band on the other meter.
test('ordinary speech lands inside the band the meter marks', () => {
  // .meter-target spans 22%-67% of the track.
  const width = meterWidth(0.05);
  assert.ok(width > 0.22 && width < 0.67, `speech drew ${(width * 100).toFixed(0)}% of the track`);
  assert.strictEqual(meterTone(0.05), 'ok');
});

test('the meter never overflows its track', () => {
  assert.strictEqual(meterWidth(1), 1);
  assert.strictEqual(meterWidth(50), 1);
});

test('nothing arriving is told apart from something too quiet', () => {
  assert.strictEqual(meterTone(0), 'none');
  assert.strictEqual(meterTone(0.001), 'none');
  assert.strictEqual(meterTone(0.01), 'low');
});

test('a missing or malformed level is drawn as silence rather than as NaN', () => {
  assert.strictEqual(meterWidth(undefined), 0);
  assert.strictEqual(meterWidth(-1), 0);
  assert.strictEqual(meterTone(undefined), 'none');
});
