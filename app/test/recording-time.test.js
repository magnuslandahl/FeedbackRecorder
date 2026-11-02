'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePauses, recordingElapsed, recordingTime } = require('../src/shared/recording-time');

test('active recording time freezes during each pause and excludes every interruption', () => {
  const pauses = [{ start: 2, end: 5 }, { start: 7, end: 9 }, { start: 10, end: null }];
  validatePauses(pauses);
  for (const [wall, active] of [[0, 0], [1, 1], [2, 2], [4, 2], [5, 2], [6, 3],
    [7, 4], [8, 4], [9, 4], [10, 5], [100, 5]]) {
    assert.equal(recordingElapsed(wall, pauses), active);
  }
});

test('input in pauses is omitted, with precise inclusive start and exclusive end boundaries', () => {
  const pauses = [{ start: 1.25, end: 4.5 }, { start: 7, end: null }];
  for (const wall of [1.25, 2, 4.499, 7, 100]) assert.equal(recordingTime(wall, pauses), null);
  assert.equal(recordingTime(1, pauses), 1);
  assert.equal(recordingTime(4.5, pauses), 1.25);
  assert.equal(recordingTime(6, pauses), 2.75);
  assert.equal(recordingTime(10, []), 10);
});

test('invalid pause intervals cannot silently corrupt the input timeline', () => {
  for (const pauses of [null, {}, [{ start: -1, end: 2 }], [{ start: NaN, end: 2 }],
    [{ start: 1, end: Infinity }], [{ start: 2, end: 1 }], [{ start: 1 }],
    [{ start: 1, end: 4 }, { start: 3, end: 5 }],
    [{ start: 1, end: null }, { start: 3, end: 5 }]]) {
    assert.throws(() => validatePauses(pauses), /Recording pauses/);
  }
  validatePauses([]);
  validatePauses([{ start: 0, end: 0 }, { start: 0, end: null }]);
});
