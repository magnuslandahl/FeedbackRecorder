'use strict';

const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const displays = require('./displays');
const settings = require('./settings');
const whisper = require('./whisper');
const buildInfo = require('./build-info');
const { createRuntime } = require('./runtime');

const APP_ROOT = path.join(__dirname, '..', '..');
const BAR_SIZE = { width: 380, height: 72 };

let mainWindow = null;
let barWindow = null;

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
  mainWindow = new BrowserWindow({
    width: 540,
    height: 880,
    minWidth: 460,
    minHeight: 560,
    title: `FeedbackRecorder ${buildInfo.describe(app.getVersion()).display}`,
    backgroundColor: '#14161a',
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    show: false,
    webPreferences: webPreferences()
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
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

  openBar(displayId) {
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
      backgroundColor: '#14161a',
      webPreferences: webPreferences()
    });

    barWindow.setAlwaysOnTop(true, 'screen-saver');
    barWindow.loadFile(path.join(__dirname, '..', 'renderer', 'bar.html'));
    barWindow.on('closed', () => {
      barWindow = null;
    });

    return placement;
  },

  closeBar() {
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
  return app.exit(found.ready ? 0 : 1);
}

app.whenReady().then(() => {
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(buildInfo.describe(app.getVersion()).full);
    return app.exit(0);
  }
  if (process.argv.includes('--selftest')) return selftest();

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
