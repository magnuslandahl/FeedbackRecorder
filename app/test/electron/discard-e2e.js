'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

// Throwing a recording away is the only thing in this app that deletes what a
// user made, so it is the one path where being wrong is expensive in both
// directions: deleting a walkthrough nobody meant to lose, or leaving a
// half-written package behind that nothing in the app can then remove.
//
// It needs no capture and no microphone — the package directory is created when
// recording begins, which is well before any frame arrives — so unlike
// test:record this runs anywhere, including CI.

const ROOT = path.join(__dirname, '..', '..');
const TIMEOUT_MS = 120000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-discard-e2e-'));
app.setPath('userData', path.join(sandbox, 'userData'));

function finish(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  const passed = checks.filter((item) => item.passed).length;
  console.log(`${passed}/${checks.length} checks passed`);

  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    /* userData is held by this process until it exits; it is under TEMP */
  }

  app.exit(passed === checks.length ? code : 1);
}

function packagesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?$/.test(name));
}

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));

  const recordingsDir = path.join(sandbox, 'recordings');
  settings.save({ recordingsDir, language: 'en' });

  // The bar and the main window are the two things a discard has to put back,
  // so they are recorded rather than stubbed away silently.
  const events = [];
  const windows = {
    hideMain: () => events.push('hideMain'),
    showMain: () => events.push('showMain'),
    openBar: () => {
      events.push('openBar');
      return { onRecordedDisplay: false };
    },
    closeBar: () => events.push('closeBar'),
    sendToBar: (channel) => events.push(`bar:${channel}`),
    sendToMain: (channel) => events.push(`main:${channel}`)
  };

  const runtime = createRuntime({ appRoot: ROOT, windows });
  runtime.registerIpc();

  // What the confirmation dialog answers. The gate itself is under test, so the
  // answer is set per case rather than assumed.
  let answer = 0;
  let asked = null;
  dialog.showMessageBox = async (options) => {
    asked = options;
    return { response: answer };
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

  const begin = () =>
    window.webContents.executeJavaScript('window.feedback.beginRecording({}).then((r) => r.runId)');

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // ---------------------------------------------------------- the gate

    const keptId = await begin();
    const keptDir = path.join(recordingsDir, keptId);
    check('beginning a recording creates its package directory', fs.existsSync(keptDir), keptId);

    events.length = 0;
    answer = 0; // "Keep recording"
    require('electron').ipcMain.emit('bar:discard');
    await new Promise((resolve) => setTimeout(resolve, 300));

    check(
      'discarding asks before it deletes anything',
      asked && /discard/i.test(asked.message || ''),
      asked ? asked.message : '(no dialog was shown)'
    );
    check(
      'the default answer is the one that keeps the recording',
      asked && asked.defaultId === 0 && asked.cancelId === 0 && /keep/i.test(asked.buttons[0]),
      asked ? `default "${asked.buttons[asked.defaultId]}", cancel "${asked.buttons[asked.cancelId]}"` : ''
    );
    check(
      'answering "keep" discards nothing',
      fs.existsSync(keptDir) && !events.includes('main:recording:discardRequested'),
      events.join(', ') || '(nothing happened)'
    );
    check(
      'answering "keep" tells the bar to re-enable its buttons',
      events.includes('bar:bar:discardCancelled'),
      events.join(', ')
    );

    // ------------------------------------------------------ the deletion

    events.length = 0;
    answer = 1; // "Discard it"
    require('electron').ipcMain.emit('bar:discard');
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(
      'answering "discard" asks the renderer to tear the recording down',
      events.includes('main:recording:discardRequested'),
      events.join(', ')
    );

    events.length = 0;
    const removed = await window.webContents.executeJavaScript(
      `window.feedback.discardRecording(${JSON.stringify(keptId)})`
    );
    check('discarding reports that it removed the run', removed === true, String(removed));
    check('the package directory is gone', !fs.existsSync(keptDir), keptDir);
    check(
      'no package is left behind in the recordings folder',
      packagesIn(recordingsDir).length === 0,
      packagesIn(recordingsDir).join(', ') || '(empty)'
    );
    check(
      'the bar is closed and the main window comes back',
      events.includes('closeBar') && events.includes('showMain'),
      events.join(', ')
    );

    // The run is deregistered, so anything still holding its id gets a clear
    // refusal rather than writing into a directory that no longer exists.
    const afterwards = await window.webContents.executeJavaScript(
      `window.feedback.recordingFinished(${JSON.stringify(keptId)}).then(() => 'resolved', (e) => 'rejected')`
    );
    check('a discarded run is no longer known', afterwards === 'rejected', afterwards);

    const again = await window.webContents.executeJavaScript(
      `window.feedback.discardRecording(${JSON.stringify(keptId)})`
    );
    check('discarding twice is harmless', again === false, String(again));

    // ------------------------------------------- one discard, one recording

    const keepId = await begin();
    const discardId = await begin();
    check(
      'two recordings started in the same second get separate packages',
      keepId !== discardId,
      `${keepId} and ${discardId}`
    );
    await window.webContents.executeJavaScript(
      `window.feedback.discardRecording(${JSON.stringify(discardId)})`
    );
    check(
      'discarding one recording leaves the others alone',
      fs.existsSync(path.join(recordingsDir, keepId)) &&
        !fs.existsSync(path.join(recordingsDir, discardId)),
      `kept ${keepId}, discarded ${discardId}`
    );

    // ------------------------------------------------------------ the bar

    // While a recording runs the bar is the only control there is, and it can
    // end up on a screen nobody is looking at. The accelerator is taken here
    // the way openBar takes it, so the bar is asked the same question it would
    // be asked for real.
    const shortcuts = require(path.join(ROOT, 'src', 'shared', 'shortcuts.js'));
    const { globalShortcut } = require('electron');
    const held = globalShortcut.register(shortcuts.STOP_RECORDING, () => {});

    // The bar is where a discard starts and the only thing on screen while a
    // recording runs, so what it offers is checked rather than assumed.
    const bar = new BrowserWindow({
      width: 470,
      height: 72,
      show: false,
      frame: false,
      webPreferences: {
        preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    await bar.loadFile(path.join(ROOT, 'src', 'renderer', 'bar.html'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const barState = await bar.webContents.executeJavaScript(`(() => {
      const discard = document.getElementById('discard');
      const meter = document.querySelector('.bar-meter');
      // What the meter draws for ordinary speech, through the same shared
      // mapping the set-up meter uses.
      const speech = window.feedback.lib.meterWidth(0.05);
      return {
        hasDiscard: Boolean(discard),
        discardText: discard ? discard.textContent.trim() : '',
        hasStop: Boolean(document.getElementById('stop')),
        stopTitle: (document.getElementById('stop') || {}).title || '',
        stopKeys: (document.getElementById('stop') || { getAttribute: () => null }).getAttribute('aria-keyshortcuts') || '',
        hasTargetBand: Boolean(meter && meter.querySelector('.meter-target')),
        bandLeft: meter ? getComputedStyle(meter.querySelector('.meter-target')).left : '',
        meterWidth: meter ? meter.getBoundingClientRect().width : 0,
        speechFraction: speech,
        controlsFit: (() => {
          const inner = document.querySelector('.bar-inner');
          return inner ? inner.scrollWidth <= inner.clientWidth + 1 : false;
        })()
      };
    })()`);

    check(
      'the bar offers a way out that is not finishing the recording',
      barState.hasDiscard && /discard/i.test(barState.discardText) && barState.hasStop,
      `"${barState.discardText}" beside Stop`
    );
    check(
      'the bar marks the same "loud enough" band the set-up meter does',
      barState.hasTargetBand && barState.bandLeft !== '',
      `band starts at ${barState.bandLeft} of a ${Math.round(barState.meterWidth)}px track`
    );
    // The bar used to draw the raw level, so speech filled 5% of the track and
    // read as silence next to a band it never reached.
    check(
      'ordinary speech reaches the band on the bar',
      barState.speechFraction > 0.22 && barState.speechFraction < 0.67,
      `${Math.round(barState.speechFraction * 100)}% of the track`
    );
    check('everything on the bar fits without clipping', barState.controlsFit);

    // Named on the button it belongs to, and only while it is really held:
    // telling somebody about a shortcut that failed to register sends them
    // hunting for a key that does nothing.
    check(
      'the bar names the stop shortcut exactly when it is held',
      held
        ? barState.stopTitle.includes(shortcuts.describe(shortcuts.STOP_RECORDING, process.platform)) &&
          barState.stopKeys === shortcuts.STOP_RECORDING
        : barState.stopTitle === '' && barState.stopKeys === '',
      held ? `title "${barState.stopTitle}"` : 'the combination could not be taken here, and nothing was claimed'
    );
    if (held) globalShortcut.unregister(shortcuts.STOP_RECORDING);

    clearTimeout(failsafe);
    finish(0);
  } catch (error) {
    clearTimeout(failsafe);
    check('the run completed without throwing', false, error && error.message);
    finish(1);
  }
});
