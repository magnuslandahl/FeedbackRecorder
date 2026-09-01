'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

// Captures the real UI in each state it can be caught in, so a UX review looks
// at the thing itself rather than at the markup that produces it.

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv.find((a) => a.startsWith('--out='));
const OUT_DIR = OUT ? OUT.slice('--out='.length) : path.join(os.tmpdir(), 'fr-shots');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-shot-'));
app.setPath('userData', path.join(sandbox, 'userData'));

fs.mkdirSync(OUT_DIR, { recursive: true });

async function shoot(window, name) {
  // capturePage on a never-shown window can hand back the last composited
  // frame rather than the current one, which produces a screenshot of a state
  // the app has already left. Waiting for two animation frames and a beat gives
  // the compositor something current to hand over.
  await window.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
  );
  window.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 900));
  const image = await window.webContents.capturePage();
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`shot ${file}`);
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
      return setTimeout(tick, 200);
    };
    tick();
  });
}

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));
  settings.save({ recordingsDir: path.join(sandbox, 'recordings'), language: 'sv' });

  let barWindow = null;
  const windows = {
    hideMain() {},
    showMain() {},
    openBar() {
      barWindow = new BrowserWindow({
        width: 380,
        height: 72,
        show: false,
        frame: false,
        webPreferences: {
          preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
          contextIsolation: true,
          sandbox: false,
          backgroundThrottling: false
        }
      });
      barWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'bar.html'));
      return { onRecordedDisplay: false };
    },
    closeBar() {},
    sendToBar(channel, payload) {
      if (barWindow && !barWindow.isDestroyed()) barWindow.webContents.send(channel, payload);
    },
    sendToMain() {}
  };

  const runtime = createRuntime({ appRoot: ROOT, windows });
  runtime.installDisplayMediaHandler(session.defaultSession);
  runtime.registerIpc();

  const window = new BrowserWindow({
    width: 540,
    height: 880,
    show: false,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await poll(window, "!document.getElementById('start').disabled", 30000, 'Ready');
    // A window that is never shown can be captured before its images have been
    // decoded and painted. `[].every()` is true, so this has to require that
    // there are thumbnails at all, not merely that none are broken.
    await poll(
      window,
      `(() => {
        const images = Array.from(document.querySelectorAll('#display-list img'));
        return images.length > 0 && images.every((i) => i.complete && i.naturalWidth > 0);
      })()`,
      15000,
      'display thumbnails to decode'
    );
    await new Promise((r) => setTimeout(r, 600));
    const readyInfo = await window.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('display-list');
      return { cards: list.children.length, height: list.getBoundingClientRect().height };
    })()`);
    console.log(`ready: ${JSON.stringify(readyInfo)}`);
    await shoot(window, '1-ready');

    await window.webContents.executeJavaScript("document.getElementById('start').click()");
    await poll(window, "!document.getElementById('state-recording').hidden", 30000, 'Recording');
    await new Promise((r) => setTimeout(r, 3500));
    await shoot(window, '2-recording-mainwindow');
    if (barWindow) await shoot(barWindow, '2-recording-bar');

    window.webContents.send('recording:stopRequested');
    await poll(window, "!document.getElementById('state-framing').hidden", 60000, 'Framing');
    await shoot(window, '3-framing');

    await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      const rect = canvas.getBoundingClientRect();
      const at = (fx, fy) => ({ clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * fy,
        bubbles: true, pointerId: 1, isPrimary: true });
      canvas.dispatchEvent(new PointerEvent('pointerdown', at(0.2, 0.2)));
      canvas.dispatchEvent(new PointerEvent('pointermove', at(0.8, 0.75)));
      canvas.dispatchEvent(new PointerEvent('pointerup', at(0.8, 0.75)));
    })()`);
    await shoot(window, '3-framing-selected');

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await new Promise((r) => setTimeout(r, 1200));
    await shoot(window, '4-processing');

    await poll(window, "!document.getElementById('state-done').hidden", 180000, 'Done');
    const steps = await window.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('#steps li')).map((li) => li.dataset.step + ':' + (li.className || 'none'))"
    );
    console.log(`steps at done: ${steps.join(' | ')}`);
    await shoot(window, '5-done');
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
  }

  try {
    fs.rmSync(path.join(sandbox, 'recordings'), { recursive: true, force: true });
  } catch (error) {
    /* temp */
  }

  // Destroy the windows explicitly. A capture stream still attached to a live
  // window has left orphaned renderer processes behind when the parent shell
  // closed the pipe early.
  BrowserWindow.getAllWindows().forEach((open) => {
    if (!open.isDestroyed()) open.destroy();
  });
  app.exit(0);
});
