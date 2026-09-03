'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const languages = require('../shared/languages');

// Transcription runs locally through whisper.cpp. Nothing leaves the machine,
// and nothing has to be installed by the user once a build bundles the binary
// and a model under vendor/.

const BINARY_NAMES =
  process.platform === 'win32'
    ? ['whisper-cli.exe', 'main.exe', 'whisper.exe']
    : ['whisper-cli', 'main', 'whisper'];

const MODEL_PREFERENCE = ['ggml-small.bin', 'ggml-base.bin', 'ggml-medium.bin', 'ggml-tiny.bin'];

// Prebuilt whisper.cpp archives do not agree on a layout: the Windows release
// zip nests everything under Release\, and CMake builds put binaries in
// build/bin. Rather than require a particular unpacking ritual, look in the
// handful of places they actually land.
const BINARY_SUBDIRS = ['', 'Release', 'bin', 'build/bin', 'build/bin/Release'];

function vendorRoots(appRoot) {
  const roots = [path.join(appRoot, 'vendor')];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'vendor'));
  return roots;
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (error) {
      // An unreadable candidate is simply not the one.
    }
  }
  return null;
}

function binaryCandidates(appRoot) {
  const candidates = [];
  for (const root of vendorRoots(appRoot)) {
    for (const subdir of BINARY_SUBDIRS) {
      for (const name of BINARY_NAMES) {
        candidates.push(path.join(root, 'whisper', subdir, name));
      }
    }
  }
  return candidates;
}

function locate(appRoot) {
  const roots = vendorRoots(appRoot);

  const binary = firstExisting(binaryCandidates(appRoot));

  const model = firstExisting(
    roots.flatMap((root) => MODEL_PREFERENCE.map((name) => path.join(root, 'models', name)))
  );

  const vadModel = firstExisting(
    roots.map((root) => path.join(root, 'models', 'ggml-silero-v5.1.2.bin'))
  );

  if (!binary) {
    return {
      ready: false,
      reason: `whisper.cpp was not found. Put a build in ${path.join(appRoot, 'vendor', 'whisper')}.`
    };
  }
  if (!model) {
    return {
      ready: false,
      reason: `No Whisper model was found. Put a GGML model in ${path.join(appRoot, 'vendor', 'models')}.`
    };
  }
  return { ready: true, binary, model, vadModel, modelName: path.basename(model) };
}

// whisper.cpp -oj writes { transcription: [ { offsets: { from, to }, text } ] }
// with offsets in milliseconds.
function parseWhisperJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { segments: [], language: null, error: 'The transcript output was not valid JSON.' };
  }

  const raw = Array.isArray(parsed.transcription) ? parsed.transcription : [];
  const segments = raw
    .map((item) => {
      const offsets = item.offsets || {};
      return {
        start: Number(offsets.from || 0) / 1000,
        end: Number(offsets.to || 0) / 1000,
        text: String(item.text || '').trim()
      };
    })
    .filter((segment) => segment.text.length > 0);

  const language =
    (parsed.result && parsed.result.language) || (parsed.params && parsed.params.language) || null;

  return { segments, language, error: null };
}

function runBinary(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Split out so the language handling can be tested without running the binary.
//
// The language flag is always passed, including "auto". whisper.cpp documents
// `-l LANG [en]`, so leaving it out does not mean "detect" — it means English.
// Omitting it for auto is what this used to do, which quietly transcribed every
// other language as if it were English.
function buildArgs(options) {
  const { model, wavPath, stem, language, vadModel } = options;
  const args = [
    '-m',
    model,
    '-f',
    wavPath,
    '-oj',
    '-of',
    stem,
    '-t',
    String(Math.max(1, Math.min(os.cpus().length - 1, 8))),
    '-l',
    languages.normalize(language)
  ];

  // Silence is where Whisper invents text. This project measured two runs over
  // the same quiet file returning entirely different transcripts, so voice
  // activity detection is used whenever a VAD model is available.
  if (vadModel) args.push('--vad', '--vad-model', vadModel);

  return args;
}

// What the transcriber actually used. With auto-detect, whisper.cpp reports the
// detected language in result.language and echoes the request in params.language,
// so "auto" must never be reported back as if it were a detected language.
function resolveLanguage(parsedLanguage, requested) {
  const detected = String(parsedLanguage || '').trim().toLowerCase();
  if (detected && detected !== languages.AUTO) return detected;
  const asked = languages.normalize(requested);
  return asked === languages.AUTO ? null : asked;
}

async function transcribe(options) {
  const { appRoot, wavPath, language, outputDir } = options;
  const located = locate(appRoot);
  if (!located.ready) {
    return { available: false, segments: [], reason: located.reason };
  }

  const stem = path.join(outputDir || os.tmpdir(), 'transcript');
  const args = buildArgs({
    model: located.model,
    wavPath,
    stem,
    language,
    vadModel: located.vadModel
  });

  const result = await runBinary(located.binary, args, 30 * 60 * 1000);
  const jsonPath = `${stem}.json`;

  if (!fs.existsSync(jsonPath)) {
    const output = `${result.stderr || ''}\n${result.stdout || ''}`;

    // Met for real while a model was still downloading. The raw error talks
    // about tensor counts, which tells the user nothing about what to do.
    if (/not all tensors loaded|failed to load model/i.test(output)) {
      return {
        available: false,
        segments: [],
        reason: `The model file ${located.modelName} is incomplete or corrupt. Download it again.`
      };
    }

    const detail = output.trim().split('\n').slice(-3).join(' ');
    return {
      available: false,
      segments: [],
      reason: `whisper.cpp produced no transcript${detail ? `: ${detail}` : '.'}`
    };
  }

  const parsed = parseWhisperJson(fs.readFileSync(jsonPath, 'utf8'));
  if (parsed.error) {
    return { available: false, segments: [], reason: parsed.error };
  }

  return {
    available: true,
    segments: parsed.segments,
    language: resolveLanguage(parsed.language, language),
    requestedLanguage: languages.normalize(language),
    engine: `whisper.cpp (${located.modelName})`,
    vad: Boolean(located.vadModel),
    reason: ''
  };
}

module.exports = { locate, parseWhisperJson, transcribe, buildArgs, resolveLanguage };
