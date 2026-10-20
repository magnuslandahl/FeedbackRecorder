'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { screenTimeline, occurrenceKey, correlateSegment, correlateSegments } = require('../src/shared/timeline');

const keyframes = [
  { file: 'frames/frame-01.png', time: 0 },
  { file: 'frames/frame-02.png', time: 3.5 },
  { file: 'frames/frame-03.png', time: 9.25 }
];
const revisits = [
  { file: 'frames/frame-02.png', time: 11 },
  { file: 'frames/frame-03.png', time: 17 },
  { file: 'frames/frame-02.png', time: 19.25 }
];

test('the timeline includes every visit in order while retaining only three image files', () => {
  const timeline = screenTimeline({ keyframes, revisits: revisits.slice().reverse() });
  assert.deepEqual(timeline.map((frame) => frame.time), [0, 3.5, 9.25, 11, 17, 19.25]);
  assert.equal(new Set(timeline.map((frame) => frame.file)).size, 3);
  assert.equal(new Set(timeline.map(occurrenceKey)).size, 6);
  assert.equal(keyframes.length, 3);
});

test('invalid times and dangling revisit images cannot become review entries', () => {
  assert.deepEqual(screenTimeline({
    keyframes,
    revisits: [...revisits,
      { file: 'frames/missing.png', time: 21 },
      { file: keyframes[0].file, time: -1 },
      { file: keyframes[0].file, time: NaN }]
  }).map((frame) => frame.time), [0, 3.5, 9.25, 11, 17, 19.25]);
  assert.deepEqual(screenTimeline({}), []);
});

test('dictation distinguishes three visits to the same image', () => {
  const spoken = correlateSegments([
    { start: 5, end: 6, text: 'First attempt.' },
    { start: 12, end: 13, text: 'Second attempt.' },
    { start: 20, end: 21, text: 'Third attempt.' }
  ], keyframes, revisits);
  assert.deepEqual(spoken.map((segment) => segment.frame), Array(3).fill(keyframes[1].file));
  assert.deepEqual(spoken.map((segment) => segment.frameTime), [3.5, 11, 19.25]);
  assert.deepEqual(spoken.map((segment) => segment.frameOccurrence), [2, 4, 6]);
  assert.deepEqual(spoken.map((segment) => segment.frameOccurrences.length), [1, 1, 1]);
});

test('an exact transition starts the new visit and an end boundary excludes the next visit', () => {
  const spoken = correlateSegments([
    { start: 9.25, end: 11, text: 'The redirect.' },
    { start: 11, end: 17, text: 'The second attempt.' }
  ], keyframes, revisits);
  assert.deepEqual(spoken.map((segment) => segment.frameOccurrence), [3, 4]);
  assert.deepEqual(spoken.map((segment) => segment.frameOccurrences.map((frame) => frame.occurrence)), [[3], [4]]);
});

test('speech spanning a change carries each visit without duplicating or guessing words', () => {
  const segment = { start: 10, end: 20, text: 'A sentence crossing several screen changes.' };
  const [spoken] = correlateSegments([segment], keyframes, revisits);
  assert.equal(spoken.text, segment.text);
  assert.equal(spoken.start, segment.start);
  assert.equal(spoken.end, segment.end);
  assert.equal(spoken.frameOccurrence, 3);
  assert.deepEqual(spoken.frameOccurrences, [
    { file: keyframes[2].file, time: 9.25, occurrence: 3 },
    { file: keyframes[1].file, time: 11, occurrence: 4 },
    { file: keyframes[2].file, time: 17, occurrence: 5 },
    { file: keyframes[1].file, time: 19.25, occurrence: 6 }
  ]);
});

test('a zero-length segment belongs only to the visit at its timestamp', () => {
  const [spoken] = correlateSegments([{ start: 11, end: 11, text: 'Here.' }], keyframes, revisits);
  assert.equal(spoken.frameOccurrence, 4);
  assert.equal(spoken.frameOccurrences.length, 1);
});

test('removed speech retains its slot in metadata but is absent from rendered narration', () => {
  const segment = { start: 12, end: 13, text: '' };
  assert.equal(correlateSegment(segment, screenTimeline({ keyframes, revisits })).frameOccurrence, 4);
  assert.deepEqual(correlateSegments([segment], keyframes, revisits), []);
});

test('re-correlation replaces stale references after reframing without changing speech', () => {
  const [original] = correlateSegments([{ start: 12, end: 13, text: 'Here.' }], keyframes, revisits);
  const [reframed] = correlateSegments([original], [keyframes[0]], []);
  assert.equal(reframed.frame, keyframes[0].file);
  assert.equal(reframed.frameOccurrence, 1);
  assert.deepEqual(reframed.frameOccurrences, [{ file: keyframes[0].file, time: 0, occurrence: 1 }]);
  const [noFrames] = correlateSegments([original], [], []);
  assert.equal(noFrames.frame, null);
  assert.equal(noFrames.frameOccurrence, null);
  assert.deepEqual(noFrames.frameOccurrences, []);
});
