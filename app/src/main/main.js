'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell, clipboard } = require('electron');

const displays = require('./displays');
const permissions = require('./permissions');
const settings = require('./settings');
const whisper = require('./whisper');
const pkg = require('./package-writer');

const APP_ROOT = path.join(__dirname, '..', '..');
const BAR_SIZE = { width: 380, height: 72 };

let mainWindow = null;
let barWindow = null;
let captureDisplayId = null;
const runs = new Map();

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 460,
    minHeight: 620,
    title: 'FeedbackRecorder',
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The window hides while recording, and a throttled renderer would stop
      // driving the level meter and the elapsed clock on the bar.
      backgroundThrottling: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showBar(displayId) {
  closeBar();
  const placement = displays.barPlacement(displayId, BAR_SIZE);

  barWindow = new BrowserWindow({
    width: BAR_SIZE.width,
    height: BAR_SIZE.height,
    x: placement.x,
    y: placement.y,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  barWindow.setAlwaysOnTop(true, 'screen-saver');
  barWindow.loadFile(path.join(__dirname, '..', 'renderer', 'bar.html'));
  barWindow.on('closed', () => {
    barWindow = null;
  });

  return placement;
}

function closeBar() {
  if (barWindow && !barWindow.isDestroyed()) barWindow.destroy();
  barWindow = null;
}

// Chromium's own picker is never shown: it offers windows and browser tabs,
// which this app deliberately does not record, and it cannot show the
// microphone state that has to be checked in the same breath.
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const chosen =
          sources.find((source) => String(source.display_id) === String(captureDisplayId)) || sources[0];
        if (!chosen) return callback({});
        return callback({ video: chosen });
      } catch (error) {
        return callback({});
      }
    },
    { useSystemPicker: false }
  );
}

function requireRun(runId) {
  const run = runs.get(runId);
  if (!run) throw new Error(`Unknown recording ${runId}`);
  return run;
}

function registerIpc() {
  ipcMain.handle('displays:list', () => displays.listDisplays());
  ipcMain.handle('permissions:describe', () => permissions.describe());
  ipcMain.handle('permissions:requestMicrophone', () => permissions.requestMicrophone());
  ipcMain.handle('permissions:openSettings', (_event, kind) => permissions.openSettings(kind));

  ipcMain.handle('settings:load', () => settings.load());
  ipcMain.handle('settings:save', (_event, patch) => settings.save(patch));

  ipcMain.handle('recording:begin', async (_event, options) => {
    const resolved = await displays.resolveDisplay(options && options.displayId);
    if (!resolved.display) throw new Error('No display is available to record.');

    captureDisplayId = resolved.display.id;
    const config = settings.save({ displayId: resolved.display.id, microphoneId: options.microphoneId || '' });
    fs.mkdirSync(config.recordingsDir, { recursive: true });

    const created = pkg.createPackage(config.recordingsDir, new Date());
    runs.set(created.id, {
      id: created.id,
      dir: created.dir,
      display: resolved.display,
      startedAt: new Date().toISOString(),
      degraded: []
    });

    const placement = showBar(resolved.display.id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();

    return {
      runId: created.id,
      dir: created.dir,
      display: resolved.display,
      fellBack: resolved.fellBack,
      barOnRecordedDisplay: placement.onRecordedDisplay
    };
  });

  ipcMain.on('recording:tick', (_event, state) => {
    if (barWindow && !barWindow.isDestroyed()) barWindow.webContents.send('bar:state', state);
  });

  ipcMain.on('bar:stop', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('recording:stopRequested');
  });

  ipcMain.handle('recording:finished', (_event, runId) => {
    closeBar();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    return requireRun(runId).dir;
  });

  ipcMain.handle('recording:saveVideo', (_event, runId, data) => {
    const run = requireRun(runId);
    return pkg.writeRecording(run.dir, data);
  });

  ipcMain.handle('recording:saveAudio', (_event, runId, data) => {
    const run = requireRun(runId);
    return pkg.writeAudio(run.dir, data);
  });

  ipcMain.handle('recording:saveFrames', (_event, runId, frames) => {
    const run = requireRun(runId);
    run.keyframes = pkg.writeFrames(run.dir, frames);
    return run.keyframes;
  });

  ipcMain.handle('transcribe:status', () => whisper.locate(APP_ROOT));

  ipcMain.handle('transcribe:run', async (_event, runId, options) => {
    const run = requireRun(runId);
    return whisper.transcribe({
      appRoot: APP_ROOT,
      wavPath: path.join(run.dir, 'narration.wav'),
      language: (options && options.language) || settings.load().language,
      outputDir: run.dir
    });
  });

  ipcMain.handle('recording:finalize', (_event, runId, details) => {
    const run = requireRun(runId);
    const merged = Object.assign({}, run, details, {
      id: run.id,
      packagePath: run.dir,
      startedAt: run.startedAt,
      display: run.display,
      keyframes: details.keyframes || run.keyframes || [],
      degraded: (run.degraded || []).concat(details.degraded || [])
    });
    const result = pkg.finalize(run.dir, merged);
    runs.set(runId, Object.assign(run, { finalized: result.run }));
    return { dir: run.dir, brief: result.brief, prompt: result.prompt, run: result.run };
  });

  ipcMain.handle('shell:reveal', (_event, target) => {
    shell.openPath(target);
    return true;
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
}

app.whenReady().then(() => {
  installDisplayMediaHandler();
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  closeBar();
  if (process.platform !== 'darwin') app.quit();
});
