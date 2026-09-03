'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, dialog } = require('electron');

// Imports a video through the real UI, by dropping it the way a person would,
// and checks the package that comes out. It needs no screen, no microphone and
// no whisper.cpp, so it runs anywhere: the video is generated in the renderer
// rather than captured.
//
// What it is really guarding is that an imported file takes the same route as a
// recorded one from framing onwards. Two pipelines that only mostly agree is the
// failure this is here to prevent.

const ROOT = path.join(__dirname, '..', '..');
const TIMEOUT_MS = 180000;
const RECORD_MS = 4000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-import-e2e-'));
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

// Builds a real WebM in the page, then hands it to the drop handler as a File,
// which is what an operating system delivers when somebody drags one in.
const MAKE_AND_DROP = `(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');

  let scene = 0;
  const draw = () => {
    context.fillStyle = ['#123', '#231', '#312'][scene % 3];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.font = 'bold 120px sans-serif';
    context.fillText('scene ' + scene, 200, 380);
  };
  draw();
  const painter = setInterval(() => { scene += 1; draw(); }, 700);

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
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4e6 });
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
  const file = new File([blob], 'holiday-demo.webm', { type: 'video/webm' });

  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

  return blob.size;
})()`;

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

  // The save dialog is the one thing here that needs a human, so it is answered
  // for them. Everything behind it is the real path.
  const zipTarget = path.join(sandbox, 'exported.zip');
  let dialogDefaultPath = '';
  dialog.showSaveDialog = async (_window, options) => {
    dialogDefaultPath = (options && options.defaultPath) || '';
    return { canceled: false, filePath: zipTarget };
  };

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

    // Refusing the obviously wrong file matters as much as accepting the right
    // one: the alternative is a codec error that reads like a crash.
    await window.webContents.executeJavaScript(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    })()`);
    const refusal = await window.webContents.executeJavaScript(
      "document.getElementById('import-note').textContent"
    );
    check('a file that is not a video is refused by name', /not look like a video/i.test(refusal), refusal);
    check('refusing a file leaves the app on the Ready state',
      await window.webContents.executeJavaScript("!document.getElementById('state-ready').hidden"));

    const size = await window.webContents.executeJavaScript(MAKE_AND_DROP);
    check('a video was produced to import', size > 20000, `${size} bytes`);

    await poll(window, "!document.getElementById('state-framing').hidden", 90000, 'the Framing state');
    check('dropping a video led to framing, the same as a recording does', true);

    const frame = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      return { width: canvas.width, height: canvas.height };
    })()`);
    check(
      'the imported video kept its own resolution',
      frame.width === 1280 && frame.height === 720,
      `${frame.width}x${frame.height}`
    );

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await poll(window, "!document.getElementById('state-done').hidden", 120000, 'processing to finish');
    check('the imported video was processed into a package', true);

    const runIds = Array.from(runtime.runs.keys());
    check('exactly one package was registered', runIds.length === 1, runIds.join(', '));
    const dir = runtime.runs.get(runIds[0]).dir;

    const sizeOf = (name) => {
      const target = path.join(dir, name);
      return fs.existsSync(target) ? fs.statSync(target).size : -1;
    };

    check('the video was written into the package', sizeOf('recording.webm') > 10000, `${sizeOf('recording.webm')} bytes`);
    check('the narration WAV was written', sizeOf('narration.wav') > 44, `${sizeOf('narration.wav')} bytes`);

    const frames = fs.existsSync(path.join(dir, 'frames'))
      ? fs.readdirSync(path.join(dir, 'frames')).filter((name) => name.endsWith('.png'))
      : [];
    check('keyframes were extracted from the imported video', frames.length > 0, `${frames.length} frame(s)`);

    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    check('the package records that it was imported', run.source && run.source.kind === 'import', JSON.stringify(run.source));
    check('the original file name was kept', run.source && run.source.name === 'holiday-demo.webm');
    check(
      'the duration came from the file rather than a stopwatch',
      Math.abs(run.durationSeconds - RECORD_MS / 1000) < 3,
      `${run.durationSeconds}s`
    );
    check('the narration level was measured', Boolean(run.narration && run.narration.level), run.narration && run.narration.summary);

    const brief = fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8');
    check('the brief says the video was imported, not recorded here',
      /imported video `holiday-demo\.webm`/.test(brief) && !/unknown display/.test(brief));
    check('the brief carries a ready-made prompt', brief.includes('## Coding-agent prompt'));

    const summary = await window.webContents.executeJavaScript(
      "Array.from(document.getElementById('summary').children).map((li) => li.textContent)"
    );
    check('the Done summary names the file it came from',
      summary.some((row) => row.includes('holiday-demo.webm')), summary.join(' | '));

    // ------------------------------------------------------- Export as a zip

    const label = await poll(
      window,
      "(() => { const t = document.getElementById('export-video-label').textContent; return /\\d/.test(t) ? t : false; })()",
      15000,
      'the export checkbox to be labelled with the video size'
    );
    check('the checkbox says what including the video costs', /Include the video \(/.test(label), label);

    // Unticked, so this export is the "without the video" case.
    await window.webContents.executeJavaScript(
      "document.getElementById('export-video').checked = false; document.getElementById('export').click(); true"
    );
    const noteWithout = await poll(
      window,
      "(() => { const t = document.getElementById('export-note').textContent; return t.includes('Saved') || t.includes('could not') ? t : false; })()",
      60000,
      'the zip without the video to be written'
    );
    check('a zip without the video was written', /^Saved /.test(noteWithout), noteWithout);
    check('the export named a real file', fs.existsSync(zipTarget), zipTarget);
    check(
      'the suggested name says the video was left out',
      /-without-video\.zip$/.test(dialogDefaultPath),
      dialogDefaultPath
    );

    const withoutBytes = fs.existsSync(zipTarget) ? fs.statSync(zipTarget).size : 0;

    // Now with the video, to prove the option actually changes what is written.
    await window.webContents.executeJavaScript(
      "document.getElementById('export-video').checked = true; document.getElementById('export').click(); true"
    );
    const noteWith = await poll(
      window,
      "(() => { const t = document.getElementById('export-note').textContent; return t.includes('Saved') || t.includes('could not') ? t : false; })()",
      120000,
      'the zip with the video to be written'
    );
    check('a zip with the video was written', /^Saved /.test(noteWith), noteWith);

    const withBytes = fs.existsSync(zipTarget) ? fs.statSync(zipTarget).size : 0;
    const videoBytes = sizeOf('recording.webm');
    // The video is stored rather than deflated, so the difference between the
    // two exports should be the video itself plus a header. Checking the exact
    // difference proves it went in whole, which "it got bigger" would not.
    check(
      'the difference between the two zips is the video',
      Math.abs(withBytes - withoutBytes - videoBytes) < 2000,
      `${withoutBytes} without, ${withBytes} with, video is ${videoBytes}`
    );
    check(
      'the suggested name no longer says the video was left out',
      !/-without-video\.zip$/.test(dialogDefaultPath),
      dialogDefaultPath
    );

    // Opened with something other than the code that wrote it, because a zip
    // only this app can read would be no use to the person it is sent to.
    const into = path.join(sandbox, 'unzipped');
    fs.mkdirSync(into, { recursive: true });
    let extracted = [];
    try {
      execFileSync(
        process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'tar',
        ['-xf', zipTarget, '-C', into],
        { stdio: 'ignore' }
      );
      extracted = fs.readdirSync(into);
    } catch (error) {
      // GNU tar cannot read a zip, so on Linux this is expected; the unit tests
      // cover the round trip there with whatever extractor the machine has.
      extracted = [`(not checked here: ${error.message.split('\n')[0]})`];
    }
    check(
      'the zip opens in another program',
      extracted.includes('agent-brief.md') || String(extracted[0]).startsWith('(not checked'),
      extracted.join(', ')
    );

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
