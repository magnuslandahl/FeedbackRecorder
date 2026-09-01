'use strict';

// Transcribes a WAV with the bundled whisper.cpp and prints what came back.
//
//   node test/whisper-check.js <path-to-16k-mono.wav> [language]
//
// This is the one step that cannot be proved with a synthetic fixture: the
// binary either exists and produces Swedish segments, or it does not. Everything
// around it already degrades gracefully, so this answers whether it degraded for
// a real reason.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const whisper = require('../src/main/whisper');

const APP_ROOT = path.join(__dirname, '..');

async function main() {
  const wavPath = process.argv[2];
  const language = process.argv[3] || 'sv';

  const located = whisper.locate(APP_ROOT);
  if (!located.ready) {
    console.log(`not ready: ${located.reason}`);
    process.exit(1);
  }

  console.log(`binary: ${located.binary}`);
  console.log(`model:  ${located.modelName}`);
  console.log(`vad:    ${located.vadModel ? path.basename(located.vadModel) : 'none'}`);
  console.log('');

  if (!wavPath || !fs.existsSync(wavPath)) {
    console.log('Pass the path to a 16 kHz mono WAV to transcribe.');
    process.exit(1);
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-check-'));
  const started = Date.now();
  const result = await whisper.transcribe({ appRoot: APP_ROOT, wavPath, language, outputDir });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.available) {
    console.log(`FAIL ${result.reason}`);
    process.exit(1);
  }

  console.log(`${result.segments.length} segment(s) in ${elapsed}s, engine ${result.engine}, vad ${result.vad}`);
  result.segments.forEach((segment) => {
    console.log(`  [${segment.start.toFixed(2)} - ${segment.end.toFixed(2)}] ${segment.text}`);
  });

  fs.rmSync(outputDir, { recursive: true, force: true });
  process.exit(result.segments.length > 0 ? 0 : 2);
}

main().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
