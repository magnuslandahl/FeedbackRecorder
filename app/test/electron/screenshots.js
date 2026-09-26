'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const { makeAndDropVideo } = require('./synthetic-video');
const { PUBLIC_PROFILE } = require('./public-fixtures');

// This is a tool a person runs and pipes — `npm run shots | head`, or into a
// filter that stops reading once it has seen enough. When the far end of the
// pipe closes, the next console.log throws EPIPE, and an uncaught throw in an
// Electron main process is not a stack trace on stderr: it is a modal dialog
// nobody asked for, on top of the screen being photographed.
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
});

// Captures the real UI in each state it can be caught in, so a UX review looks
// at the thing itself rather than at the markup that produces it.

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_MODE = process.argv.includes('--public');
const IMPORT_WALKTHROUGH = makeAndDropVideo(
  PUBLIC_MODE
    ? { ms: 4200, name: PUBLIC_PROFILE.recordingName, publicDemo: true }
    : { ms: 4000, name: 'walkthrough.webm' }
);
const OUT = process.argv.find((a) => a.startsWith('--out='));
const OUT_DIR = OUT
  ? OUT.slice('--out='.length)
  : PUBLIC_MODE
    ? path.join(ROOT, '..', 'docs', 'images')
    : path.join(os.tmpdir(), 'fr-shots');
const PUBLIC_ASSETS = [
  'recording-controller.png',
  'framing-region.png',
  'handoff-with-comments.png',
  'social-preview.png'
];

// Which palette to capture. A light theme is easy to get subtly wrong — grey
// text on a grey panel, a meter that vanishes — and none of that shows up in a
// test that asserts colour values. Looking at it is the check.
const THEME = process.argv.find((a) => a.startsWith('--theme='));
const THEME_NAME = PUBLIC_MODE ? 'light' : THEME ? THEME.slice('--theme='.length) : 'dark';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-shot-'));
app.setPath('userData', path.join(sandbox, 'userData'));
if (PUBLIC_MODE) app.commandLine.appendSwitch('force-device-scale-factor', '1');

fs.mkdirSync(OUT_DIR, { recursive: true });
if (PUBLIC_MODE) {
  PUBLIC_ASSETS.forEach((name) => fs.rmSync(path.join(OUT_DIR, name), { force: true }));
}

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
  const captured = await window.webContents.capturePage();
  const [contentWidth, contentHeight] = window.getContentSize();
  const image = PUBLIC_MODE
    ? captured.resize({ width: contentWidth, height: contentHeight, quality: 'best' })
    : captured;
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`shot ${file}`);
}

async function assertPublicContent(window, label) {
  const content = await window.webContents.executeJavaScript('document.body.innerText');
  const forbidden = [
    os.homedir(),
    sandbox,
    'development build',
    'No preview',
    'Microphone 1',
    'Display 1'
  ].filter(Boolean);
  const found = forbidden.find((value) => content.includes(value));
  if (found) throw new Error(`${label} contains forbidden live or unstable content: ${found}`);
  if (await window.webContents.executeJavaScript("document.documentElement.dataset.theme !== 'light'")) {
    throw new Error(`${label} did not render in the forced light theme`);
  }
}

async function captureSocialPreview(handoffPath) {
  if (!fs.existsSync(handoffPath)) throw new Error('The handoff image is required for the social preview.');
  const logo = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'logo.png')).toString('base64');
  const handoff = fs.readFileSync(handoffPath).toString('base64');
  const html = `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1280px; height: 640px; margin: 0; overflow: hidden; }
      body {
        display: grid; grid-template-columns: 520px 1fr; gap: 58px; align-items: center;
        padding: 64px 72px; color: #172033; background: #eaf0fb;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 28px; }
      .brand img { width: 72px; height: 72px; border-radius: 16px; }
      .brand strong { font-size: 32px; letter-spacing: -0.02em; }
      h1 { margin: 0; font-size: 54px; line-height: 1.06; letter-spacing: -0.035em; }
      p { margin: 24px 0 0; color: #48566a; font-size: 23px; line-height: 1.4; }
      .shot {
        width: 610px; height: 512px; overflow: hidden; border: 1px solid #cbd5e1;
        border-radius: 20px; background: #fff; box-shadow: 0 24px 60px rgba(38, 63, 105, .18);
      }
      .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
    </style>
    <body>
      <section>
        <div class="brand">
          <img src="data:image/png;base64,${logo}" alt="">
          <strong>FeedbackRecorder</strong>
        </div>
        <h1>Show the change.<br>Hand over the context.</h1>
        <p>Turn a narrated screen walkthrough or written keyframe comments into an agent-ready brief.</p>
      </section>
      <div class="shot"><img src="data:image/png;base64,${handoff}" alt=""></div>
    </body>`;
  const social = new BrowserWindow({
    width: 1280,
    height: 640,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#eaf0fb',
    webPreferences: { sandbox: true, backgroundThrottling: false }
  });
  try {
    await social.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await shoot(social, 'social-preview');
  } finally {
    social.destroy();
  }
}

async function capturePublicScreenshots() {
  const publicPreload = path.join(__dirname, 'public-preload.js');
  const window = new BrowserWindow({
    width: 720,
    height: 960,
    useContentSize: true,
    show: false,
    backgroundColor: '#f4f6f9',
    webPreferences: {
      preload: publicPreload,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  const barWindow = new BrowserWindow({
    width: 470,
    height: 72,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#f4f6f9',
    webPreferences: {
      preload: publicPreload,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await window.webContents.insertCSS('* { transition: none !important; animation: none !important; }');
    await poll(window, "!document.getElementById('start').disabled", 15000, 'public fixtures');

    await barWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'bar.html'));
    barWindow.webContents.send('public:bar-state', {
      elapsed: PUBLIC_PROFILE.elapsedSeconds,
      level: 0.42
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assertPublicContent(barWindow, 'recording controller');
    await shoot(barWindow, 'recording-controller');

    await window.webContents.executeJavaScript(IMPORT_WALKTHROUGH);
    await poll(window, "!document.getElementById('state-framing').hidden", 30000, 'public framing');
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
      canvas.dispatchEvent(new PointerEvent('pointerdown', at(0.23, 0.14)));
      canvas.dispatchEvent(new PointerEvent('pointermove', at(0.93, 0.88)));
      canvas.dispatchEvent(new PointerEvent('pointerup', at(0.93, 0.88)));
      document.getElementById('frame-status').textContent =
        '00:12 of 00:42 · 896 × 533 · 52% of the screen';
    })()`);
    await assertPublicContent(window, 'framing region');
    await shoot(window, 'framing-region');

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await poll(window, "!document.getElementById('state-done').hidden", 60000, 'public handoff');
    await window.webContents.executeJavaScript(`(() => {
      const frame = document.getElementById('keyframe-comment');
      frame.value = 'Keep the selected option visible after saving.';
      frame.dispatchEvent(new Event('input', { bubbles: true }));
      const general = document.getElementById('general-notes');
      general.value = 'Confirm the change without covering the selected setting.';
      general.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('package-path').textContent =
        ${JSON.stringify(PUBLIC_PROFILE.packageLabel)};
      document.getElementById('keyframe-position').textContent = 'Keyframe 1 of 1 · 00:12';
      const terms = Array.from(document.querySelectorAll('#summary dt'));
      const length = terms.find((term) => term.textContent === 'Length');
      if (length && length.nextElementSibling) length.nextElementSibling.textContent = '42 s';
      document.querySelector('main').scrollTop = 0;
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await assertPublicContent(window, 'handoff');
    await shoot(window, 'handoff-with-comments');
    await captureSocialPreview(path.join(OUT_DIR, 'handoff-with-comments.png'));
  } finally {
    barWindow.destroy();
    window.destroy();
  }
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
  if (PUBLIC_MODE) {
    try {
      await capturePublicScreenshots();
    } catch (error) {
      console.error(`FAILED: ${error.stack || error.message}`);
      app.exitCode = 1;
    }
    BrowserWindow.getAllWindows().forEach((open) => {
      if (!open.isDestroyed()) open.destroy();
    });
    app.exit(app.exitCode || 0);
    return;
  }

  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));
  settings.save({
    recordingsDir: path.join(sandbox, 'recordings'),
    language: 'sv',
    theme: THEME_NAME
  });

  let barWindow = null;
  const windows = {
    hideMain() {},
    showMain() {},
    openBar() {
      barWindow = new BrowserWindow({
        // The size the app really opens the bar at. A screenshot taken at some
        // other width would not show whether the controls fit.
        width: 470,
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

    // Transitions are switched off before the UI is driven anywhere, not after.
    //
    // These windows are never shown, and Chromium does not advance a transition
    // in a window it is not compositing: a colour part-way through one stays
    // there. The step row is the visible casualty — it kept showing "Frame"
    // highlighted on the Done screenshot, which is a picture of a bug the app
    // does not have. A transition that never starts cannot freeze.
    await window.webContents.insertCSS('* { transition: none !important; }');

    await poll(window, "!document.getElementById('start').disabled", 30000, 'Ready');
    // A window that is never shown can be captured before its images have been
    // decoded and painted.
    //
    // The regression this guards against is a picker that renders nothing, so
    // that is what is required: cards. The previews are a separate matter —
    // macOS hands back no thumbnail at all until Screen Recording is granted,
    // and insisting on one made this tool unrunnable on a Mac rather than
    // producing the screenshots it was asked for.
    await poll(
      window,
      "document.querySelectorAll('#display-list .display').length > 0",
      15000,
      'the display picker to render'
    );
    await poll(
      window,
      `(() => {
        const images = Array.from(document.querySelectorAll('#display-list img'))
          .filter((i) => i.getAttribute('src'));
        return images.every((i) => i.complete && i.naturalWidth > 0);
      })()`,
      15000,
      'display thumbnails to decode'
    );
    const previews = await window.webContents.executeJavaScript(
      "document.querySelectorAll('#display-list img[src]').length"
    );
    if (!previews) {
      console.log(
        'note: the screen previews are empty, so the picker is pictured without them. ' +
          'On macOS that means Screen Recording has not been granted to this build.'
      );
    }
    await new Promise((r) => setTimeout(r, 600));
    const readyInfo = await window.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('display-list');
      return { cards: list.children.length, height: list.getBoundingClientRect().height };
    })()`);
    console.log(`ready: ${JSON.stringify(readyInfo)}`);
    await shoot(window, '1-ready');

    // The second choice — importing a video — is below the fold whenever there
    // is more than one screen to pick from, so it never appeared in a review of
    // the screenshots otherwise.
    await window.webContents.executeJavaScript(
      "document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight; true"
    );
    await shoot(window, '1-ready-bottom');
    await window.webContents.executeJavaScript("document.querySelector('main').scrollTop = 0; true");

    // Appearance, language and the save folder live behind the gear now, so
    // they have to be opened to be looked at.
    await window.webContents.executeJavaScript(
      "document.getElementById('open-settings').click(); true"
    );
    await new Promise((r) => setTimeout(r, 400));
    await shoot(window, '1-ready-settings');
    await window.webContents.executeJavaScript(
      "document.getElementById('settings-dialog').close(); true"
    );

    // The recording route needs the screen, and macOS refuses it until Screen
    // Recording has been granted — which cannot be granted from in here. Rather
    // than stopping with two screenshots taken, the remaining states are reached
    // by importing a video instead: framing, processing and Done are the same
    // code either way, which is exactly what the import test exists to prove.
    let recorded = false;
    await window.webContents.executeJavaScript("document.getElementById('start').click()");
    try {
      await poll(window, "!document.getElementById('state-recording').hidden", 20000, 'Recording');
      recorded = true;
    } catch (error) {
      console.log('note: the screen could not be captured, so the walkthrough is imported instead.');
      console.log('      the recording state itself cannot be pictured without a real capture.');
    }

    if (recorded) {
      await new Promise((r) => setTimeout(r, 3500));
      await shoot(window, '2-recording-mainwindow');
      if (barWindow) await shoot(barWindow, '2-recording-bar');
      window.webContents.send('recording:stopRequested');
    } else {
      // The bar is a window of its own and inherits nothing from the main one —
      // it resolves the palette a second time — so it is worth photographing
      // even when there is nothing to record. Pressing Record already opened it
      // before the capture was refused.
      if (!barWindow) windows.openBar();
      await new Promise((r) => setTimeout(r, 900));
      windows.sendToBar('bar:state', { elapsed: 72.4, level: 0.42 });
      await new Promise((r) => setTimeout(r, 700));
      if (barWindow) await shoot(barWindow, '2-recording-bar');

      await window.webContents.executeJavaScript(IMPORT_WALKTHROUGH);
    }

    await poll(window, "!document.getElementById('state-framing').hidden", 90000, 'Framing');
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
    // Processing can be over before a picture of it can be taken — an imported
    // clip with no speech in it finishes almost at once — and a file named
    // "processing" showing the Done screen is a picture of something that never
    // happened. So the state is confirmed to still be up after the shutter, and
    // the file is dropped when it was not.
    try {
      await poll(window, "!document.getElementById('state-processing').hidden", 8000, 'Processing');
      await shoot(window, '4-processing');
      const stillProcessing = await window.webContents.executeJavaScript(
        "!document.getElementById('state-processing').hidden"
      );
      if (!stillProcessing) {
        fs.rmSync(path.join(OUT_DIR, '4-processing.png'), { force: true });
        console.log('note: processing finished before it could be photographed, so that shot was dropped.');
      }
    } catch (error) {
      console.log('note: processing was over before it could be caught.');
    }

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
