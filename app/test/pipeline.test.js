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

// Prebuilt whisper.cpp archives disagree about where the binary goes. The
// Windows release zip nests it under Release\, which is how this was found.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { locate } = require('../src/main/whisper');

const BINARY = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

function fakeVendor(binarySubdir, modelNames) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-vendor-'));
  const binDir = path.join(root, 'vendor', 'whisper', binarySubdir);
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, BINARY), 'stub');

  const modelDir = path.join(root, 'vendor', 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  (modelNames || []).forEach((name) => fs.writeFileSync(path.join(modelDir, name), 'stub'));
  return root;
}

test('a binary at the top of vendor/whisper is found', () => {
  const root = fakeVendor('', ['ggml-base.bin']);
  const found = locate(root);
  assert.ok(found.ready, found.reason);
  assert.strictEqual(found.modelName, 'ggml-base.bin');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a binary nested where the Windows release zip puts it is still found', () => {
  const root = fakeVendor('Release', ['ggml-base.bin']);
  const found = locate(root);
  assert.ok(found.ready, found.reason);
  assert.match(found.binary, /Release/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a binary in a CMake build tree is still found', () => {
  const root = fakeVendor(path.join('build', 'bin'), ['ggml-base.bin']);
  assert.ok(locate(root).ready);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the better model wins when several are present', () => {
  const root = fakeVendor('Release', ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin']);
  assert.strictEqual(locate(root).modelName, 'ggml-small.bin');
  fs.rmSync(root, { recursive: true, force: true });
});

test('VAD is picked up when the Silero model is there, and absent when it is not', () => {
  const without = fakeVendor('Release', ['ggml-base.bin']);
  assert.strictEqual(locate(without).vadModel, null);
  fs.rmSync(without, { recursive: true, force: true });

  const withVad = fakeVendor('Release', ['ggml-base.bin', 'ggml-silero-v5.1.2.bin']);
  assert.ok(locate(withVad).vadModel);
  fs.rmSync(withVad, { recursive: true, force: true });
});

test('a missing binary and a missing model are reported differently', () => {
  const noModel = fakeVendor('Release', []);
  const modelResult = locate(noModel);
  assert.ok(!modelResult.ready);
  assert.match(modelResult.reason, /model/i);
  fs.rmSync(noModel, { recursive: true, force: true });

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-empty-'));
  const binaryResult = locate(empty);
  assert.ok(!binaryResult.ready);
  assert.match(binaryResult.reason, /whisper\.cpp was not found/);
  fs.rmSync(empty, { recursive: true, force: true });
});
