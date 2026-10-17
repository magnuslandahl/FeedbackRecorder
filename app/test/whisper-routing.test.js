'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const whisper = require('../src/main/whisper');
const vendor = require('../scripts/fetch-vendor');

const BINARY = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-whisper-routing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'vendor', 'whisper', BINARY);
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'fixture');
  const models = options.models || [vendor.MODELS.small.file, vendor.MODELS.swedish.file, vendor.MODELS.vad.file];
  const modelDir = path.join(root, 'vendor', 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  models.forEach((name) => fs.writeFileSync(path.join(modelDir, name), 'fixture'));

  const calls = [];
  t.mock.method(childProcess, 'execFile', (executable, args, _options, callback) => {
    const index = calls.length;
    calls.push({ executable, args });
    const detection = args.includes('-dl');
    const response = (options.responses || [])[index] || {};
    const language = detection ? (options.detected || 'sv') : valueAfter(args, '-l');
    const output = {
      params: { language: valueAfter(args, '-l') },
      result: { language },
      transcription: detection ? [] : [
        { offsets: { from: 1200, to: 2500 }, text: 'Fixture narration.' }
      ]
    };
    if (response.write !== false) {
      fs.writeFileSync(
        `${valueAfter(args, '-of')}.json`,
        response.json === undefined ? JSON.stringify(output) : response.json
      );
    }
    callback(response.error || null, '', response.stderr || '');
  });

  return {
    root, modelDir, calls,
    options: { appRoot: root, wavPath: path.join(root, 'narration.wav'), outputDir: root }
  };
}

for (const [language, normalized] of [
  ['sv', 'sv'], ['en', 'en'], ['de', 'de'], ['  SV  ', 'sv'], ['not-a-language', 'en']
]) {
  test(`explicit ${language} selects its model without a detection pass`, async (t) => {
    const f = fixture(t);
    const expectedModel = normalized === 'sv' ? vendor.MODELS.swedish.file : vendor.MODELS.small.file;
    const result = await whisper.transcribe({ ...f.options, language });

    assert.ok(result.available, result.reason);
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(path.basename(valueAfter(f.calls[0].args, '-m')), expectedModel);
    assert.strictEqual(valueAfter(f.calls[0].args, '-l'), normalized);
    assert.ok(!f.calls[0].args.includes('-dl'));
    assert.strictEqual(result.language, normalized);
    assert.strictEqual(result.requestedLanguage, normalized);
    assert.strictEqual(result.engine, `whisper.cpp (${expectedModel})`);
    assert.strictEqual(result.vad, true);
    assert.deepStrictEqual(result.segments, [
      { start: 1.2, end: 2.5, text: 'Fixture narration.' }
    ]);
  });
}

for (const language of ['sv', 'en', 'de', 'haw']) {
  test(`auto detects ${language} with the generic model before selecting the transcription model`, async (t) => {
    const f = fixture(t, { detected: language });
    const expectedModel = language === 'sv' ? vendor.MODELS.swedish.file : vendor.MODELS.small.file;
    const result = await whisper.transcribe({ ...f.options, language: 'auto' });

    assert.ok(result.available, result.reason);
    assert.strictEqual(f.calls.length, 2);
    const [detection, transcription] = f.calls.map((call) => call.args);
    assert.strictEqual(path.basename(valueAfter(detection, '-m')), vendor.MODELS.small.file);
    assert.strictEqual(valueAfter(detection, '-l'), 'auto');
    assert.ok(detection.includes('-dl'), 'detection must not transcribe the whole recording first');
    assert.strictEqual(path.basename(valueAfter(transcription, '-m')), expectedModel);
    assert.strictEqual(valueAfter(transcription, '-l'), language);
    assert.ok(!transcription.includes('-dl'));
    assert.ok(detection.includes('--vad'));
    assert.ok(transcription.includes('--vad'));
    assert.strictEqual(result.language, language);
    assert.strictEqual(result.requestedLanguage, 'auto');
    assert.strictEqual(result.engine, `whisper.cpp (${expectedModel})`);
    assert.strictEqual(result.segments.length, 1);
    assert.strictEqual(fs.existsSync(path.join(f.root, 'transcript-language.json')), false);
    assert.ok(fs.existsSync(path.join(f.root, 'transcript.json')));
  });
}

test('a Swedish-only installation cannot masquerade as a multilingual detector', (t) => {
  const f = fixture(t, { models: [vendor.MODELS.swedish.file] });
  assert.strictEqual(whisper.locate(f.root).ready, false);
});

test('model lookup finds both models in packaged resources', (t) => {
  const f = fixture(t);
  const appRoot = path.join(f.root, 'app.asar');
  const previous = process.resourcesPath;
  process.resourcesPath = f.root;
  t.after(() => {
    if (previous === undefined) delete process.resourcesPath;
    else process.resourcesPath = previous;
  });
  const found = whisper.locate(appRoot);
  assert.ok(found.ready, found.reason);
  assert.strictEqual(found.model, path.join(f.modelDir, vendor.MODELS.small.file));
  assert.strictEqual(found.swedishModel, path.join(f.modelDir, vendor.MODELS.swedish.file));
});

for (const language of ['sv', 'auto']) {
  test(`missing Swedish weights are reported for ${language}, not silently replaced`, async (t) => {
    const f = fixture(t, { models: [vendor.MODELS.small.file] });
    const result = await whisper.transcribe({ ...f.options, language });
    assert.strictEqual(result.available, false);
    assert.deepStrictEqual(result.segments, []);
    assert.match(result.reason, /Swedish model ggml-kb-whisper-small\.bin was not found/);
    assert.strictEqual(f.calls.length, language === 'auto' ? 1 : 0);
  });
}

test('English remains available without Swedish weights', async (t) => {
  const f = fixture(t, { models: [vendor.MODELS.small.file] });
  const result = await whisper.transcribe({ ...f.options, language: 'en' });
  assert.ok(result.available, result.reason);
  assert.strictEqual(result.vad, false);
});

test('a failed detection never proceeds with an assumed language', async (t) => {
  const f = fixture(t, {
    responses: [{ write: false, error: new Error('detection failed') }]
  });
  const result = await whisper.transcribe({ ...f.options, language: 'auto' });
  assert.strictEqual(result.available, false);
  assert.match(result.reason, /could not detect the language.*detection failed/);
  assert.strictEqual(f.calls.length, 1);
});

for (const json of ['invalid JSON', 'null', '{"params":{"language":"auto"}}']) {
  test(`invalid or missing detection metadata is reported: ${json}`, async (t) => {
    const f = fixture(t, { responses: [{ json }] });
    const result = await whisper.transcribe({ ...f.options, language: 'auto' });
    assert.strictEqual(result.available, false);
    assert.deepStrictEqual(result.segments, []);
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(fs.existsSync(path.join(f.root, 'transcript-language.json')), false);
  });
}

test('a failed Swedish model names the selected model rather than the detector', async (t) => {
  const f = fixture(t, {
    responses: [{}, { write: false, error: new Error('failed to load model') }]
  });
  const result = await whisper.transcribe({ ...f.options, language: 'auto' });
  assert.strictEqual(result.available, false);
  assert.match(result.reason, /model file ggml-kb-whisper-small\.bin is incomplete or corrupt/);
});

test('a failed retry cannot return a stale transcript from a different model', async (t) => {
  const f = fixture(t, { responses: [{ write: false }] });
  const jsonPath = path.join(f.root, 'transcript.json');
  fs.writeFileSync(jsonPath, '{"result":{"language":"en"},"transcription":[]}');
  const result = await whisper.transcribe({ ...f.options, language: 'sv' });
  assert.strictEqual(result.available, false);
  assert.strictEqual(fs.existsSync(jsonPath), false);
});

test('a failed process cannot turn its partial JSON output into success', async (t) => {
  const f = fixture(t, { responses: [{ error: new Error('process timed out') }] });
  const result = await whisper.transcribe({ ...f.options, language: 'sv' });
  assert.strictEqual(result.available, false);
  assert.match(result.reason, /process timed out/);
});
