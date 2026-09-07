'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Drives the real import pipeline with a video whose content is known second by
// second, and checks that the frames which come out are the ones a person would
// have picked.
//
// The unit tests decide this from synthetic signatures, which proves the rules
// but not that the renderer feeds them the right pictures. Everything between a
// real encoded video and the frames on disk — seeking, downsampling, cropping,
// codec noise — only exists here.
//
// The scripted walkthrough is the one the selector was rewritten for:
//
//   0s   a dashboard
//   5s   a different page
//   10s  back to the dashboard, unchanged
//   15s  a dialog covering about a twenty-fifth of the dashboard
//   20s  the dialog dismissed
//
// Which should produce three pictures and two returns: the dialog is small
// enough that averaging the difference across the whole screen misses it, and
// the two returns are the same screen as the opening frame.

const ROOT = path.join(__dirname, '..', '..');
const TIMEOUT_MS = 300000;
const RECORD_MS = 24000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-keyframes-e2e-'));
app.setPath('userData', path.join(sandbox, 'userData'));

function finish(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);

  try {
    fs.rmSync(path.join(sandbox, 'recordings'), { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    /* userData is held by this process until it exits; it is under TEMP */
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

// Two pages that look like software rather than two flat colours, so the
// downsampled signatures have structure in them the way a real screen does.
const MAKE_AND_DROP = `(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');

  const dashboard = () => {
    context.fillStyle = '#1b2130';
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = '#2b3550';
    context.fillRect(0, 0, 1280, 64);
    context.fillRect(0, 64, 220, 656);
    context.fillStyle = '#8fa4d4';
    for (let i = 0; i < 6; i += 1) context.fillRect(24, 100 + i * 48, 170, 20);
    context.fillStyle = '#39466b';
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        context.fillRect(260 + col * 330, 110 + row * 260, 300, 220);
      }
    }
  };

  const settings = () => {
    context.fillStyle = '#f2f3f7';
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = '#ffffff';
    context.fillRect(120, 80, 1040, 560);
    context.fillStyle = '#c9cede';
    for (let i = 0; i < 8; i += 1) context.fillRect(160, 130 + i * 62, 960, 34);
    context.fillStyle = '#2f6fdb';
    context.fillRect(960, 570, 160, 44);
  };

  // About four percent of the screen: too little to move the average across the
  // whole picture, which is exactly the change that used to be lost.
  const dialog = () => {
    dashboard();
    context.fillStyle = '#e8ecf5';
    context.fillRect(700, 300, 260, 150);
    context.fillStyle = '#1b2130';
    context.fillRect(720, 330, 200, 16);
    context.fillRect(720, 360, 150, 12);
  };

  const scenes = { dashboard, settings, dialog };
  const sceneAt = (seconds) => {
    if (seconds >= 20) return 'dashboard';
    if (seconds >= 15) return 'dialog';
    if (seconds >= 10) return 'dashboard';
    if (seconds >= 5) return 'settings';
    return 'dashboard';
  };

  const started = performance.now();
  const changes = [];
  let showing = null;
  const paint = () => {
    const seconds = (performance.now() - started) / 1000;
    const wanted = sceneAt(seconds);
    if (wanted !== showing) {
      showing = wanted;
      changes.push({ scene: wanted, at: Math.round(seconds * 100) / 100 });
    }
    scenes[showing]();
  };
  paint();
  // Repainting keeps frames flowing into the stream; the content only moves at
  // the scripted moments.
  const painter = setInterval(paint, 50);

  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.063;
  oscillator.frequency.value = 220;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();

  const stream = new MediaStream([
    canvas.captureStream(30).getVideoTracks()[0],
    destination.stream.getAudioTracks()[0]
  ]);

  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6e6 });
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };

  await new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.start(500);
    setTimeout(() => recorder.stop(), ${RECORD_MS});
  });

  clearInterval(painter);
  oscillator.stop();
  audio.close();
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: 'video/webm' });
  const file = new File([blob], 'walkthrough.webm', { type: 'video/webm' });

  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

  return { size: blob.size, changes };
})()`;

// Was a frame taken within a second and a half of this moment?
function near(times, moment, tolerance) {
  return times.some((time) => Math.abs(time - moment) <= (tolerance || 1.5));
}

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));

  const recordingsDir = path.join(sandbox, 'recordings');
  settings.save({ recordingsDir, language: 'en' });

  const windows = {
    hideMain() {},
    showMain() {},
    openBar() {
      return { onRecordedDisplay: false };
    },
    closeBar() {},
    sendToBar() {},
    sendToMain() {}
  };

  const runtime = createRuntime({ appRoot: ROOT, windows });
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
    await poll(window, "!document.getElementById('state-ready').hidden", 30000, 'the Ready state');

    const made = await window.webContents.executeJavaScript(MAKE_AND_DROP);
    check('a scripted walkthrough was produced', made.size > 20000, `${made.size} bytes`);
    check(
      'the scenes changed when the script said they would',
      made.changes.length === 5,
      made.changes.map((item) => `${item.scene}@${item.at}s`).join(' ')
    );

    await poll(window, "!document.getElementById('state-framing').hidden", 120000, 'the Framing state');
    // Whole frame: the scenes were designed against the full picture.
    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");

    // Scanning is a seek and a decode per sample, measured at about 40 ms, so a
    // long recording spends the better part of a minute here. Watching the
    // progress line move is the only way to tell a working app from a hung one,
    // so it is checked rather than assumed.
    const seen = new Set();
    const watcher = setInterval(async () => {
      try {
        const text = await window.webContents.executeJavaScript(
          "(document.getElementById('progress').textContent || '')"
        );
        const percent = /changed…\s*(\d+)%/.exec(text);
        if (percent) seen.add(percent[1]);
      } catch (error) {
        /* the page is busy decoding; the next tick will do */
      }
    }, 120);

    await poll(window, "!document.getElementById('state-done').hidden", 180000, 'processing to finish');
    clearInterval(watcher);
    check(
      'the scan reported progress rather than sitting silent',
      seen.size >= 2,
      `${seen.size} distinct percentage(s) seen`
    );

    const runIds = Array.from(runtime.runs.keys());
    const dir = runtime.runs.get(runIds[0]).dir;
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));

    const pngs = fs.readdirSync(path.join(dir, 'frames')).filter((name) => name.endsWith('.png'));
    const frameTimes = run.keyframes.map((frame) => Math.round(frame.time * 100) / 100);
    const revisits = run.revisits || [];
    const revisitTimes = revisits.map((entry) => Math.round(entry.time * 100) / 100);

    console.log(`    frames at ${frameTimes.join('s, ')}s`);
    console.log(`    returns at ${revisitTimes.join('s, ')}s`);

    check('the opening screen was captured', near(frameTimes, 0, 1), frameTimes.join(', '));
    check('the change of page was captured', near(frameTimes, 5), frameTimes.join(', '));

    // The point of the rewrite. A dialog this size moves the average across the
    // whole screen by less than the threshold, so before tiles were scored it
    // was invisible.
    check('the small dialog was captured', near(frameTimes, 15), frameTimes.join(', '));

    check(
      'going back to a screen did not save it again',
      run.keyframes.length === 3,
      `${run.keyframes.length} frame(s) at ${frameTimes.join('s, ')}s`
    );
    check(
      'both returns to the dashboard were recorded',
      revisits.length === 2 && near(revisitTimes, 10) && near(revisitTimes, 20),
      revisitTimes.join('s, ') + 's'
    );
    check(
      'every return points at the frame it repeats',
      revisits.length > 0 && revisits.every((entry) => run.keyframes.some((frame) => frame.file === entry.file)),
      revisits.map((entry) => entry.file).join(' ')
    );
    check(
      'the returns point at the opening frame, not at some other one',
      revisits.every((entry) => entry.file === run.keyframes[0].file),
      revisits.map((entry) => entry.file).join(' ')
    );

    check(
      'there is exactly one PNG per keyframe and none for the returns',
      pngs.length === run.keyframes.length,
      `${pngs.length} PNG(s), ${run.keyframes.length} keyframe(s)`
    );

    const brief = fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8');
    check('the brief says the opening frame came back', /back on screen at/.test(brief));
    check(
      'the package was not marked as missing anything',
      (run.degraded || []).filter((line) => /keyframe/i.test(line)).length === 0,
      (run.degraded || []).join(' | ')
    );

    clearTimeout(failsafe);
    finish(checks.every((item) => item.passed) ? 0 : 1);
  } catch (error) {
    clearTimeout(failsafe);
    check('the run completed without throwing', false, error.message);
    finish(1);
  }
});
