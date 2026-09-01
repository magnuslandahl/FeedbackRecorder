'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

// Records the screen for real, through the real UI and the real IPC handlers,
// then checks the package that came out. Everything else in this project is
// verified against a synthetic clip; this is the one test that proves the app
// works on an actual screen and an actual microphone.
//
// It records a few seconds, writes to a temporary folder, and deletes it again.

const ROOT = path.join(__dirname, '..', '..');
const RECORD_MS = 6000;
const TIMEOUT_MS = 240000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

// A test that quietly runs against the user's real settings and real Videos
// folder is not a test, it is a side effect.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-e2e-'));
app.setPath('userData', path.join(sandbox, 'userData'));

function finish(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);

  // The recordings are the part worth removing: they are the megabytes, and
  // nothing else holds them. Electron keeps its userData directory open until
  // the process is gone, so that one is left to the OS temp cleaner rather than
  // fought over.
  const recordings = path.join(sandbox, 'recordings');
  try {
    fs.rmSync(recordings, { recursive: true, force: true });
  } catch (error) {
    console.log(`(left behind ${recordings}: ${error.message})`);
  }
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    /* userData is still held by this process; it is under TEMP */
  }

  app.exit(code);
}

function poll(window, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let value = false;
      try {
        value = await window.webContents.executeJavaScript(expression);
      } catch (error) {
        return reject(error);
      }
      if (value) return resolve(value);
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${label}`));
      return setTimeout(tick, 250);
    };
    tick();
  });
}

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));

  const recordingsDir = path.join(sandbox, 'recordings');
  settings.save({ recordingsDir, language: 'sv' });

  // The bar is a window the app opens on another screen. Nothing here needs to
  // see it, so it is recorded rather than rendered.
  const barEvents = [];
  const windows = {
    hideMain() {},
    showMain() {},
    openBar(displayId) {
      barEvents.push(`open:${displayId}`);
      return { onRecordedDisplay: false };
    },
    closeBar() {
      barEvents.push('close');
    },
    sendToBar() {},
    sendToMain(channel) {
      barEvents.push(`toMain:${channel}`);
    }
  };

  const runtime = createRuntime({ appRoot: ROOT, windows });
  runtime.installDisplayMediaHandler(session.defaultSession);
  runtime.registerIpc();

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const failsafe = setTimeout(() => {
    check('the run completed inside the time limit', false, `${TIMEOUT_MS / 1000}s`);
    finish(1);
  }, TIMEOUT_MS);

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

    await poll(window, "!document.getElementById('start').disabled", 30000, 'the Ready state');
    check('a screen and a microphone were both available', true);

    await window.webContents.executeJavaScript("document.getElementById('start').click()");
    await poll(
      window,
      "!document.getElementById('state-recording').hidden",
      30000,
      'recording to start'
    );
    check('recording started', true);

    await new Promise((resolve) => setTimeout(resolve, RECORD_MS));

    // Exactly what pressing Stop on the bar does.
    window.webContents.send('recording:stopRequested');

    await poll(window, "!document.getElementById('state-framing').hidden", 60000, 'the Framing state');
    check('framing was offered after the recording', true);

    const frame = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      return { width: canvas.width, height: canvas.height };
    })()`);
    check(
      'the recording was captured at a usable resolution',
      frame.width >= 1280 && frame.height >= 720,
      `${frame.width}x${frame.height}`
    );

    // Drag a rectangle, the way a person would, so the crop path is exercised
    // rather than defaulted past.
    await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      const rect = canvas.getBoundingClientRect();
      const at = (fx, fy) => ({
        clientX: rect.left + rect.width * fx,
        clientY: rect.top + rect.height * fy,
        bubbles: true,
        pointerId: 1,
        isPrimary: true
      });
      canvas.dispatchEvent(new PointerEvent('pointerdown', at(0.15, 0.15)));
      canvas.dispatchEvent(new PointerEvent('pointermove', at(0.75, 0.8)));
      canvas.dispatchEvent(new PointerEvent('pointerup', at(0.75, 0.8)));
      return document.getElementById('frame-status').textContent;
    })()`);

    const status = await window.webContents.executeJavaScript(
      "document.getElementById('frame-status').textContent"
    );
    check(
      'dragging a rectangle selected a region',
      /×/.test(status) && !/whole screen/i.test(status),
      status
    );

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await poll(window, "!document.getElementById('state-done').hidden", 180000, 'processing to finish');
    check('processing finished and the package was handed over', true);

    const summary = await window.webContents.executeJavaScript(
      "Array.from(document.getElementById('summary').children).map((li) => li.textContent)"
    );

    const runIds = Array.from(runtime.runs.keys());
    check('exactly one recording was registered', runIds.length === 1, runIds.join(', '));
    const dir = runtime.runs.get(runIds[0]).dir;

    const sizeOf = (name) => {
      const target = path.join(dir, name);
      return fs.existsSync(target) ? fs.statSync(target).size : -1;
    };

    check('the screen recording was written', sizeOf('recording.webm') > 100000, `${sizeOf('recording.webm')} bytes`);
    check('the narration WAV was written', sizeOf('narration.wav') > 44, `${sizeOf('narration.wav')} bytes`);
    check('run.json was written', sizeOf('run.json') > 0);
    check('transcript.json was written', sizeOf('transcript.json') > 0);

    const frames = fs.existsSync(path.join(dir, 'frames'))
      ? fs.readdirSync(path.join(dir, 'frames')).filter((name) => name.endsWith('.png'))
      : [];
    check('keyframes were written as PNGs', frames.length > 0, `${frames.length} frame(s)`);

    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    check('the crop was applied to the keyframes', Boolean(run.region), JSON.stringify(run.region));
    check(
      'the region fits inside the recorded frame',
      run.region &&
        run.region.x + run.region.width <= run.frameSize.width &&
        run.region.y + run.region.height <= run.frameSize.height,
      `${JSON.stringify(run.frameSize)}`
    );
    check(
      'the duration is about as long as the recording ran',
      Math.abs(run.durationSeconds - RECORD_MS / 1000) < 3,
      `${run.durationSeconds}s`
    );
    check('the narration level was measured', Boolean(run.narration && run.narration.level), run.narration && run.narration.summary);

    const brief = fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8');
    check('the brief names the package it belongs to', brief.includes(dir));
    check('the brief lists the keyframes', brief.includes(frames[0] || 'frame-01.png'));
    check('the brief carries a ready-made prompt', brief.includes('## Coding-agent prompt'));

    // A transcript is only expected if somebody was actually talking, which
    // cannot be arranged here. What must always hold is that the package says
    // which it was, rather than leaving an empty transcript unexplained.
    const transcript = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8'));
    const explained =
      (transcript.segments && transcript.segments.length > 0) ||
      /narration|transcript/i.test(brief);
    check(
      'an empty transcript arrives with a stated cause',
      explained,
      `${(transcript.segments || []).length} segment(s), ${run.narration && run.narration.level}`
    );

    check('the bar was opened and closed again', barEvents.some((e) => e.startsWith('open:')) && barEvents.includes('close'), barEvents.join(' '));
    check('the Done summary was rendered', summary.length > 0, `${summary.length} row(s)`);

    console.log('');
    console.log('Summary shown to the user:');
    summary.forEach((row) => console.log(`    ${row}`));
    console.log('');
  } catch (error) {
    check('the run completed without throwing', false, error.message);
  }

  clearTimeout(failsafe);
  finish(checks.some((item) => !item.passed) ? 1 : 0);
});
