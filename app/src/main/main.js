'use strict';

const path = require('node:path');
const { app, BrowserWindow, screen, session, globalShortcut } = require('electron');

const displays = require('./displays');
const permissions = require('./permissions');
const settings = require('./settings');
const whisper = require('./whisper');
const inputCapture = require('./input-capture');
const buildInfo = require('./build-info');
const shortcuts = require('../shared/shortcuts');
const { createRuntime } = require('./runtime');
const windowSize = require('./window-size');

const APP_ROOT = path.join(__dirname, '..', '..');
const BAR_SIZE = { width: 344, height: 44 };

let mainWindow = null;
let barWindow = null;
let captureHighlightWindow = null;

function webPreferences() {
  return {
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    // The window hides while recording, and a throttled renderer would stop
    // driving the level meter and the elapsed clock on the bar.
    backgroundThrottling: false
  };
}

function createMainWindow() {
  const size = windowSize.restore(
    settings.load().windowSize,
    screen.getPrimaryDisplay().workArea
  );
  mainWindow = new BrowserWindow({
    ...size,
    minWidth: windowSize.MIN_WIDTH,
    minHeight: windowSize.MIN_HEIGHT,
    title: `FeedbackRecorder ${buildInfo.describe(app.getVersion()).display}`,
    backgroundColor: '#14161a',
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    show: false,
    webPreferences: webPreferences()
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  windowSize.remember(mainWindow, (patch) => settings.save(patch));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const windows = {
  hideMain() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  },

  showMain() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  },

  openBar(displayId, highlightBounds) {
    windows.closeBar();
    const placement = displays.barPlacement(displayId, BAR_SIZE);

    barWindow = new BrowserWindow({
      width: BAR_SIZE.width,
      height: BAR_SIZE.height,
      x: placement.x,
      y: placement.y,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: webPreferences()
    });

    barWindow.setAlwaysOnTop(true, 'screen-saver');
    // The compact control sits on the recorded screen. Keep it out of the
    // video where the platform supports window capture exclusion.
    barWindow.setContentProtection(true);
    if (process.platform === 'darwin') {
      // Native full-screen apps live in separate Spaces.
      barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    barWindow.loadFile(path.join(__dirname, '..', 'renderer', 'bar.html'));
    barWindow.on('closed', () => {
      barWindow = null;
    });

    if (highlightBounds) {
      const highlightWindow = new BrowserWindow({
        x: highlightBounds.x,
        y: highlightBounds.y,
        width: highlightBounds.width,
        height: highlightBounds.height,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        enableLargerThanScreen: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      captureHighlightWindow = highlightWindow;

      highlightWindow.setIgnoreMouseEvents(true);
      // Keep the indicator out of the recording where the operating system
      // supports capture exclusion. On platforms that do not, it remains a
      // thin edge that can be removed during the framing step.
      highlightWindow.setContentProtection(true);
      highlightWindow.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        highlightWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true
        });
      }
      highlightWindow.loadFile(
        path.join(__dirname, '..', 'renderer', 'capture-highlight.html')
      );
      highlightWindow.once('ready-to-show', () => {
        if (!highlightWindow.isDestroyed()) {
          highlightWindow.showInactive();
          if (barWindow && !barWindow.isDestroyed()) barWindow.moveTop();
        }
      });
      highlightWindow.on('closed', () => {
        if (captureHighlightWindow === highlightWindow) captureHighlightWindow = null;
      });
    }

    // Keep the accelerator as a fallback if an exclusive full-screen window
    // hides the control. It is not advertised in the setup screen.
    const stopShortcut = globalShortcut.register(shortcuts.STOP_RECORDING, () => {
      windows.sendToMain('recording:stopRequested');
    });

    return Object.assign({}, placement, { stopShortcut });
  },

  closeBar() {
    // Released with the bar, so the combination is only taken for as long as
    // there is a recording to stop.
    globalShortcut.unregister(shortcuts.STOP_RECORDING);
    if (captureHighlightWindow && !captureHighlightWindow.isDestroyed()) {
      captureHighlightWindow.destroy();
    }
    captureHighlightWindow = null;
    if (barWindow && !barWindow.isDestroyed()) barWindow.destroy();
    barWindow = null;
  },

  sendToBar(channel, payload) {
    if (barWindow && !barWindow.isDestroyed()) barWindow.webContents.send(channel, payload);
  },

  sendToMain(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }
};

// `FeedbackRecorder.exe --selftest` reports what the install can see and exits.
// In a packaged app the vendor files sit next to the executable rather than in
// the source tree, and that is exactly the kind of difference that is invisible
// until someone records a review and gets no transcript.
function selftest() {
  const found = whisper.locate(APP_ROOT);
  const input = inputCapture.status(APP_ROOT, process.resourcesPath);
  const snapshot = settings.load();
  const build = buildInfo.describe(app.getVersion());
  console.log(`version:       ${build.full}`);
  console.log(`packaged:      ${app.isPackaged}`);
  console.log(`appRoot:       ${APP_ROOT}`);
  console.log(`resources:     ${process.resourcesPath}`);
  console.log(`recordings:    ${snapshot.recordingsDir}`);
  console.log(`language:      ${snapshot.language}`);
  console.log(`transcriber:   ${found.ready ? found.modelName : `unavailable — ${found.reason}`}`);
  if (found.ready) {
    console.log(`binary:        ${found.binary}`);
    console.log(`vad:           ${found.vadModel ? path.basename(found.vadModel) : 'none'}`);
  }
  console.log(
    `input:         ${
      input.helper
        ? `helper ready; clicks ${input.pointer ? 'allowed' : 'not allowed'}, keys ${
            input.keyboard ? 'allowed' : 'not allowed'
          }`
        : `unavailable — ${input.reason}`
    }`
  );
  const inputReady = (process.platform !== 'darwin' && process.platform !== 'win32') || input.helper;
  return app.exit(found.ready && inputReady ? 0 : 1);
}

app.whenReady().then(() => {
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(buildInfo.describe(app.getVersion()).full);
    return app.exit(0);
  }
  if (process.argv.includes('--selftest')) return selftest();

  permissions.reconcileIdentity();
  const runtime = createRuntime({ appRoot: APP_ROOT, windows, appVersion: app.getVersion() });
  runtime.installDisplayMediaHandler(session.defaultSession);
  runtime.registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  return undefined;
});

app.on('window-all-closed', () => {
  windows.closeBar();
  if (process.platform !== 'darwin') app.quit();
});

// A global accelerator outlives the window that took it, so it is released
// explicitly rather than left to the process ending tidily.
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
