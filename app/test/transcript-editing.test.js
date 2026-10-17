'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../src/main/package-writer');
const { buildBrief, buildPrompt, correlateSegments } = require('../src/shared/brief');

function transcript() {
  return {
    available: true, language: 'sv', requestedLanguage: 'auto',
    engine: 'whisper.cpp (ggml-kb-whisper-small.bin)', vad: true,
    segments: [
      { start: 0.5, end: 2.1, text: 'The say button is missing.' },
      { start: 4.2, end: 5, text: 'The page jumped.' }
    ]
  };
}

test('corrections change only words while preserving timing and model metadata', () => {
  const original = transcript();
  const corrected = pkg.correctTranscript(original, ['The Save button is missing.', 'The page jumps.']);
  assert.deepEqual(corrected, {
    ...original, edited: true,
    segments: [
      { start: 0.5, end: 2.1, text: 'The Save button is missing.' },
      { start: 4.2, end: 5, text: 'The page jumps.' }
    ]
  });
  assert.equal(original.segments[0].text, 'The say button is missing.');
  assert.equal(original.edited, undefined);
});

test('unchanged words are not labelled as a correction', () => {
  const original = transcript();
  assert.equal(pkg.correctTranscript(original, original.segments.map((s) => s.text)).edited, false);
});

test('corrections normalize line endings and nulls without silently truncating text', () => {
  const text = ` A\r\nB\0\rC ${'word '.repeat(6000)}`;
  const result = pkg.correctTranscript(transcript(), [text, 'The page jumps.']);
  assert.equal(result.segments[0].text, text.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim());
});

for (const texts of [null, [], ['one'], ['one', 'two', 'three'], [1, 'two'], [null, 'two'], new Array(2)]) {
  test(`malformed or mismatched corrections are refused: ${JSON.stringify(texts)}`, () => {
    assert.throws(() => pkg.correctTranscript(transcript(), texts), /segments have changed|only text/);
  });
}

test('an unavailable or empty transcript cannot be replaced with invented timed speech', () => {
  assert.throws(() => pkg.correctTranscript({ available: false }, ['text']), /no transcript to correct/);
  assert.throws(() => pkg.correctTranscript({ available: true, segments: [] }, []), /no transcript to correct/);
});

test('clearing a segment keeps its time slot but removes its text from handoffs', () => {
  const corrected = pkg.correctTranscript(transcript(), ['', 'The page jumps.']);
  assert.equal(corrected.segments.length, 2);
  assert.equal(corrected.segments[0].start, 0.5);
  assert.equal(pkg.transcriptText(corrected.segments), '[00:04] The page jumps.\n');
  assert.equal(correlateSegments(corrected.segments, []).length, 1);
});

test('a saved correction reaches every package representation and keeps its keyframe association', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-transcript-edit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = {
    id: '2026-10-17-100000', durationSeconds: 8,
    keyframes: [{ file: 'frames/frame-01.png', time: 0 }, { file: 'frames/frame-02.png', time: 4 }],
    frameSize: { width: 320, height: 200 }, packagePath: dir,
    transcript: pkg.correctTranscript(transcript(), ['The Save button is missing.', 'The page jumps.']),
    notes: { general: 'Keep keyboard navigation.', frames: [] }
  };
  const result = pkg.finalize(dir, run);
  const restored = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.equal(restored.transcript.engine, run.transcript.engine);
  assert.equal(restored.transcript.edited, true);
  assert.deepEqual(restored.transcript.segments, run.transcript.segments);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8')).segments, run.transcript.segments);
  for (const text of [
    fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'),
    fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8'),
    result.prompt, buildBrief(restored), buildPrompt(restored)
  ]) {
    assert.match(text, /The Save button is missing/);
    assert.doesNotMatch(text, /The say button is missing/);
  }
  assert.match(result.brief, /corrected by the author/);
  const associated = correlateSegments(restored.transcript.segments, restored.keyframes);
  assert.deepEqual(associated.map((s) => s.frame), ['frames/frame-01.png', 'frames/frame-02.png']);
});
