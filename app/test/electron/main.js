'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Runs the browser-side media pipeline in a real Electron renderer and checks
// the result. It needs no screen, no microphone and no whisper.cpp, so it runs
// on a locked machine, and it answers the question the design left open: whether
// Chromium alone covers what FFmpeg was doing.

const TIMEOUT_MS = 90000;
const EXPECTED_SECONDS = 6;
const REGION = { width: 640, height: 360 };

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function get(findings, name) {
  const found = findings.find((item) => item.name === name);
  return found ? found.value : undefined;
}

function evaluate(findings) {
  const duration = get(findings, 'durationAfterSeek');
  const before = get(findings, 'durationBeforeSeek');

  check(
    'MediaRecorder produced a non-trivial WebM',
    get(findings, 'videoBytes') > 50000,
    `${get(findings, 'videoBytes')} bytes, ${get(findings, 'mimeType')}`
  );

  check(
    'the WebM duration trap is real and the workaround fixes it',
    !Number.isFinite(before) && Number.isFinite(duration),
    `before seek: ${before}, after seek: ${duration}`
  );

  check(
    'the recovered duration matches how long it recorded',
    Math.abs(duration - EXPECTED_SECONDS) < 1.5,
    `${duration}s vs ${EXPECTED_SECONDS}s`
  );

  check(
    'the recording kept its full resolution',
    get(findings, 'videoWidth') === 1280 && get(findings, 'videoHeight') === 720,
    `${get(findings, 'videoWidth')}x${get(findings, 'videoHeight')}`
  );

  const times = get(findings, 'keyframeTimes') || [];
  check(
    'seeking through the recording produced distinct sample times',
    new Set(times).size === times.length && times.length > 0,
    JSON.stringify(times)
  );

  check(
    'keyframes were found where the synthetic screen changed',
    get(findings, 'keyframeCount') >= 3,
    `${get(findings, 'keyframeCount')} of ${get(findings, 'sampleCount')} samples`
  );

  check(
    'every keyframe is inside the recording',
    times.every((time) => time >= 0 && time <= duration + 0.5),
    JSON.stringify(times)
  );

  const sizes = get(findings, 'frameByteSizes') || [];
  check(
    'each keyframe was written as a real PNG',
    sizes.length > 0 && sizes.every((size) => size > 1000),
    JSON.stringify(sizes)
  );

  const signature = get(findings, 'firstFrameSignature') || [];
  check(
    'the frame bytes carry a PNG header',
    signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47,
    JSON.stringify(signature)
  );

  check(
    'the cropped frame contains image data rather than black',
    get(findings, 'croppedFrameHasContent') === true,
    `region ${REGION.width}x${REGION.height}`
  );

  check(
    'audio decoded straight to 16 kHz, so no resampling step is needed',
    get(findings, 'audioSampleRate') === 16000,
    `${get(findings, 'audioSampleRate')} Hz`
  );

  const samples = get(findings, 'audioSampleCount');
  check(
    'the decoded audio covers the recording',
    Math.abs(samples / 16000 - duration) < 1.5,
    `${samples} samples = ${(samples / 16000).toFixed(2)}s`
  );

  check(
    'narration at a normal level is classified as usable',
    get(findings, 'narrationLevel') === 'ok',
    `${get(findings, 'narrationLevel')} at ${get(findings, 'narrationRms')} dBFS`
  );

  check(
    'the WAV is a well-formed 16-bit mono file',
    get(findings, 'wavHeader') === 'RIFFWAVE' && get(findings, 'wavBytes') === 44 + samples * 2,
    `${get(findings, 'wavHeader')}, ${get(findings, 'wavBytes')} bytes`
  );
}

function report(failed) {
  checks.forEach((item) => {
    const mark = item.passed ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      offscreen: false
    }
  });

  const timer = setTimeout(() => {
    console.log('FAIL the harness did not report within the time limit');
    app.exit(1);
  }, TIMEOUT_MS);

  ipcMain.on('harness:done', (_event, result) => {
    clearTimeout(timer);
    if (!result.ok) {
      console.log(`FAIL the harness threw: ${result.error}`);
      console.log(result.stack || '');
      return report(true);
    }
    result.findings.forEach((item) => {
      // JSON turns Infinity into null, and this project does not print output
      // that misrepresents what was measured.
      const value =
        typeof item.value === 'number' && !Number.isFinite(item.value)
          ? String(item.value)
          : JSON.stringify(item.value);
      console.log(`    ${item.name}: ${value}`);
    });
    console.log('');
    evaluate(result.findings);
    return report(checks.some((item) => !item.passed));
  });

  window.webContents.on('console-message', (event) => {
    const message = (event && event.message) || '';
    if (/error|failed/i.test(message)) console.log(`    renderer: ${message}`);
  });

  window.loadFile(path.join(__dirname, 'harness.html'));
});
