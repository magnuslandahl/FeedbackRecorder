'use strict';

const test = require('node:test');
const assert = require('node:assert');

const languages = require('../src/shared/languages');
const { buildArgs, resolveLanguage } = require('../src/main/whisper');
const { buildBrief, buildPrompt } = require('../src/shared/brief');

function argsFor(language) {
  return buildArgs({
    model: '/models/ggml-small.bin',
    wavPath: '/run/narration.wav',
    stem: '/run/transcript',
    language
  });
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

test('English is the default, so an untouched install transcribes English', () => {
  assert.strictEqual(languages.DEFAULT_LANGUAGE, 'en');
  assert.strictEqual(languages.normalize(undefined), 'en');
  assert.strictEqual(languages.normalize(''), 'en');
});

test('a language the app does not offer falls back rather than reaching the transcriber', () => {
  // whisper.cpp rejects an unknown code outright, and the recording it would
  // have transcribed cannot be made again.
  assert.strictEqual(languages.normalize('klingon'), 'en');
  assert.strictEqual(languages.normalize('  SV  '), 'sv');
});

test('every offered language is unique and labelled', () => {
  const codes = languages.LANGUAGES.map((item) => item.code);
  assert.strictEqual(new Set(codes).size, codes.length);
  assert.ok(languages.LANGUAGES.every((item) => item.label && item.label.trim()));
  assert.strictEqual(codes[0], 'auto', 'auto belongs first, because it is the escape hatch');
});

// The bug this pins: whisper.cpp documents `-l LANG [en]`, so leaving the flag
// out means English rather than "detect". Auto used to omit it, which
// transcribed every other language as if it were English — confidently, and
// with no error to notice.
test('auto asks the transcriber to detect, instead of leaving it on English', () => {
  const args = argsFor('auto');
  assert.ok(args.includes('-l'), 'the language flag must always be passed');
  assert.strictEqual(valueAfter(args, '-l'), 'auto');
});

test('a chosen language is passed through', () => {
  assert.strictEqual(valueAfter(argsFor('sv'), '-l'), 'sv');
});

test('a nonsense language never reaches the command line', () => {
  assert.strictEqual(valueAfter(argsFor('not-a-language'), '-l'), 'en');
});

test('voice activity detection is only requested when the model is there', () => {
  const without = argsFor('en');
  assert.ok(!without.includes('--vad'));

  const withVad = buildArgs({
    model: '/models/ggml-small.bin',
    wavPath: '/run/narration.wav',
    stem: '/run/transcript',
    language: 'en',
    vadModel: '/models/silero.bin'
  });
  assert.ok(withVad.includes('--vad'));
  assert.strictEqual(valueAfter(withVad, '--vad-model'), '/models/silero.bin');
});

test('the detected language is reported, not the request for detection', () => {
  assert.strictEqual(resolveLanguage('sv', 'auto'), 'sv');
  assert.strictEqual(resolveLanguage('en', 'en'), 'en');
});

test('"auto" is never reported back as if it were a spoken language', () => {
  // whisper echoes the request in params.language, so an output missing
  // result.language must not turn "auto" into the answer.
  assert.strictEqual(resolveLanguage('auto', 'auto'), null);
  assert.strictEqual(resolveLanguage(null, 'auto'), null);
  assert.strictEqual(resolveLanguage(null, 'sv'), 'sv');
});

test('an unknown code is still named, so a detection is never silently dropped', () => {
  assert.strictEqual(languages.describe('sv'), 'Swedish');
  assert.strictEqual(languages.describe('haw'), 'haw');
  assert.strictEqual(languages.describe(''), 'unknown');
  assert.strictEqual(languages.describe('auto'), 'unknown');
});

function runWith(transcript) {
  return {
    id: '2026-09-03-101500',
    packagePath: '/packages/2026-09-03-101500',
    durationSeconds: 30,
    frameSize: { width: 1920, height: 1080 },
    keyframes: [{ file: 'frames/frame-01.png', time: 0 }],
    transcript
  };
}

test('the brief says which language the words are in', () => {
  const brief = buildBrief(
    runWith({
      available: true,
      language: 'sv',
      requestedLanguage: 'sv',
      segments: [{ start: 1, end: 2, text: 'Knappen hamnar fel.' }]
    })
  );
  assert.match(brief, /1 segment in Swedish/);
  assert.doesNotMatch(brief, /detected automatically/);
});

test('a detected language is marked as detected, because a reader cannot tell', () => {
  const run = runWith({
    available: true,
    language: 'sv',
    requestedLanguage: 'auto',
    segments: [{ start: 1, end: 2, text: 'Knappen hamnar fel.' }]
  });
  assert.match(buildBrief(run), /1 segment in Swedish, detected automatically/);
  assert.match(buildPrompt(run), /Narration in Swedish, detected automatically:/);
});
