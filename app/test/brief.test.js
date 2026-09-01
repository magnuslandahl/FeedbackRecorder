'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { correlateSegments, buildBrief, buildPrompt } = require('../src/shared/brief');
const { encodeWav, mixToMono } = require('../src/shared/wav');
const { runFolderName, formatTimecode } = require('../src/shared/naming');

const keyframes = [
  { file: 'frames/frame-01.png', time: 0 },
  { file: 'frames/frame-02.png', time: 12 },
  { file: 'frames/frame-03.png', time: 30 }
];

function run(overrides) {
  return Object.assign(
    {
      id: '2026-09-01-113000',
      packagePath: 'C:\\ExampleUser\\Recordings\\2026-09-01-113000',
      startedAt: '2026-09-01T11:30:00.000Z',
      durationSeconds: 42.5,
      display: { name: 'Display 1', actualWidth: 2560, actualHeight: 1440 },
      frameSize: { width: 2560, height: 1440 },
      region: null,
      keyframes,
      narration: { level: 'ok', summary: 'Narration averaged -27.0 dBFS.', advice: '' },
      transcript: {
        available: true,
        language: 'sv',
        segments: [
          { start: 2, end: 5, text: 'Den h\u00e4r knappen hamnar fel.' },
          { start: 14, end: 18, text: 'Och listan laddar om hela tiden.' }
        ]
      },
      degraded: []
    },
    overrides || {}
  );
}

test('a spoken moment is tied to the frame that was on screen then', () => {
  const correlated = correlateSegments(run().transcript.segments, keyframes);
  assert.strictEqual(correlated[0].frame, 'frames/frame-01.png');
  assert.strictEqual(correlated[1].frame, 'frames/frame-02.png');
});

test('speech before the first keyframe still gets a frame', () => {
  const correlated = correlateSegments([{ start: 0, end: 1, text: 'hej' }], [
    { file: 'frames/frame-01.png', time: 5 }
  ]);
  assert.strictEqual(correlated[0].frame, 'frames/frame-01.png');
});

test('no keyframes means no frame reference rather than a broken link', () => {
  const correlated = correlateSegments([{ start: 1, end: 2, text: 'hej' }], []);
  assert.strictEqual(correlated[0].frame, null);
});

test('the brief carries the package path, the frames and the narration', () => {
  const brief = buildBrief(run());
  assert.match(brief, /C:\\ExampleUser\\Recordings\\2026-09-01-113000/);
  assert.match(brief, /frames\/frame-02\.png/);
  assert.match(brief, /Den h\u00e4r knappen hamnar fel\./);
  assert.match(brief, /whole screen \(2560x1440\)/);
  assert.match(brief, /## Coding-agent prompt/);
});

test('an empty transcript reports the measured cause instead of nothing', () => {
  const brief = buildBrief(
    run({
      transcript: { available: true, segments: [] },
      narration: {
        level: 'quiet',
        summary: 'Narration averaged -48.9 dBFS, which is too quiet to transcribe reliably.',
        advice: 'Speech normally measures around -27 dBFS.'
      }
    })
  );
  assert.match(brief, /no speech segments/);
  assert.match(brief, /-48\.9 dBFS/);
});

test('a degraded package says what is missing from it', () => {
  const brief = buildBrief(run({ degraded: ['Transcription was skipped: no model is installed.'] }));
  assert.match(brief, /What is missing from this package/);
  assert.match(brief, /no model is installed/);
});

test('the clipboard prompt carries the content, not a pointer to it', () => {
  const prompt = buildPrompt(run());
  assert.match(prompt, /Och listan laddar om hela tiden\./);
  assert.match(prompt, /\[frames\/frame-02\.png\]/);
  assert.match(prompt, /screenshots cannot travel/);
  assert.ok(!prompt.includes('```'), 'the prompt is pasted as-is, so it must not nest a code fence');
});

test('a prompt with no narration says so instead of pretending', () => {
  const prompt = buildPrompt(
    run({
      transcript: { available: false, reason: 'whisper.cpp was not found', segments: [] },
      narration: { level: 'silent', summary: 'The audio track is digital silence.', advice: 'The microphone was muted.' }
    })
  );
  assert.match(prompt, /Narration: none was transcribed/);
  assert.match(prompt, /digital silence/);
});

test('a WAV header describes the data that follows it', () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWav(samples, 16000);
  assert.strictEqual(wav.length, 44 + samples.length * 2);
  assert.strictEqual(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.strictEqual(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.strictEqual(view.getUint32(24, true), 16000, 'sample rate');
  assert.strictEqual(view.getUint16(22, true), 1, 'mono');
  assert.strictEqual(view.getInt16(44 + 6, true), 32767, 'full scale is not clipped to silence');
});

test('stereo is mixed down rather than truncated to one side', () => {
  const mono = mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
  assert.deepStrictEqual(Array.from(mono), [0.5, 0.5]);
});

test('run folders are named in local time and sort chronologically', () => {
  const name = runFolderName(new Date(2026, 8, 1, 9, 5, 3));
  assert.strictEqual(name, '2026-09-01-090503');
});

test('timecodes grow an hours field only when they need one', () => {
  assert.strictEqual(formatTimecode(65), '01:05');
  assert.strictEqual(formatTimecode(3725), '1:02:05');
});
