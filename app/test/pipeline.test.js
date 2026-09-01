'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseWhisperJson } = require('../src/main/whisper');
const { verifyPackage, transcriptText } = require('../src/main/package-writer');

test('whisper output becomes segments in seconds', () => {
  const parsed = parseWhisperJson(
    JSON.stringify({
      result: { language: 'sv' },
      transcription: [
        { offsets: { from: 0, to: 2400 }, text: ' Den h\u00e4r knappen hamnar fel.' },
        { offsets: { from: 2400, to: 5000 }, text: ' Och listan laddar om.' }
      ]
    })
  );

  assert.strictEqual(parsed.language, 'sv');
  assert.deepStrictEqual(parsed.segments, [
    { start: 0, end: 2.4, text: 'Den h\u00e4r knappen hamnar fel.' },
    { start: 2.4, end: 5, text: 'Och listan laddar om.' }
  ]);
});

test('blank segments are dropped rather than written as empty lines', () => {
  const parsed = parseWhisperJson(
    JSON.stringify({ transcription: [{ offsets: { from: 0, to: 100 }, text: '   ' }] })
  );
  assert.deepStrictEqual(parsed.segments, []);
});

test('unparsable output is reported, not thrown', () => {
  const parsed = parseWhisperJson('not json at all');
  assert.deepStrictEqual(parsed.segments, []);
  assert.match(parsed.error, /not valid JSON/);
});

test('a package with no keyframes says so', () => {
  const problems = verifyPackage({ durationSeconds: 30, keyframes: [] });
  assert.ok(problems.some((item) => /no pictures/.test(item)));
});

test('a recording with no duration is flagged as possibly unplayable', () => {
  const problems = verifyPackage({ durationSeconds: 0, keyframes: [{ file: 'a', time: 0 }] });
  assert.ok(problems.some((item) => /no measurable duration/.test(item)));
});

test('output timed past the end of the recording is caught', () => {
  const frames = verifyPackage({ durationSeconds: 10, keyframes: [{ file: 'a', time: 40 }] });
  assert.ok(frames.some((item) => /past the end/.test(item)));

  const speech = verifyPackage({
    durationSeconds: 10,
    keyframes: [{ file: 'a', time: 1 }],
    transcript: { segments: [{ start: 25, end: 27, text: 'invented' }] }
  });
  assert.ok(speech.some((item) => /not trustworthy/.test(item)));
});

test('a healthy package reports no problems', () => {
  const problems = verifyPackage({
    durationSeconds: 30,
    keyframes: [{ file: 'a', time: 0 }, { file: 'b', time: 12 }],
    transcript: { segments: [{ start: 2, end: 4, text: 'hej' }] }
  });
  assert.deepStrictEqual(problems, []);
});

test('the plain transcript is timecoded so it can be read on its own', () => {
  const text = transcriptText([{ start: 65, end: 70, text: 'hej' }]);
  assert.strictEqual(text, '[01:05] hej\n');
  assert.strictEqual(transcriptText([]), '');
});
