'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { measureLevels, classifyNarration, TOO_QUIET_DBFS } = require('../src/shared/narration');

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
