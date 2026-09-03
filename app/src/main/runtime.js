'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, desktopCapturer, shell, clipboard, dialog, BrowserWindow } = require('electron');

const displays = require('./displays');
const permissions = require('./permissions');
const settings = require('./settings');
const whisper = require('./whisper');
const pkg = require('./package-writer');
const buildInfo = require('./build-info');
const exporter = require('./exporter');
const languages = require('../shared/languages');
const imports = require('../shared/imports');
const exportRules = require('../shared/exports');

// Everything the renderer can ask for, with window handling injected rather than
// reached for. main.js supplies real windows; the end-to-end test supplies a
// hidden one, so the test drives the same handlers the app does instead of a
// copy of them that can drift.

function createRuntime(options) {
  const appRoot = options.appRoot;
  const windows = options.windows;
  const runs = new Map();
  let captureDisplayId = null;

  function requireRun(runId) {
    const run = runs.get(runId);
    if (!run) throw new Error(`Unknown recording ${runId}`);
    return run;
  }

  // Chromium's own picker is never shown: it offers windows and browser tabs,
  // which this app deliberately does not record, and it cannot show the
  // microphone state that has to be checked in the same breath.
  function installDisplayMediaHandler(targetSession) {
    targetSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'] });
          const chosen =
            sources.find((source) => String(source.display_id) === String(captureDisplayId)) ||
            sources[0];
          if (!chosen) return callback({});
          return callback({ video: chosen });
        } catch (error) {
          return callback({});
        }
      },
      { useSystemPicker: false }
    );
  }

  function registerIpc() {
    ipcMain.handle('displays:list', () => displays.listDisplays());
    ipcMain.handle('app:version', () => buildInfo.describe(options.appVersion));
    ipcMain.handle('permissions:describe', () => permissions.describe());
    ipcMain.handle('permissions:requestMicrophone', () => permissions.requestMicrophone());
    ipcMain.handle('permissions:openSettings', (_event, kind) => permissions.openSettings(kind));

    ipcMain.handle('settings:load', () => settings.load());
    ipcMain.handle('settings:save', (_event, patch) => settings.save(patch));

    ipcMain.handle('recording:begin', async (_event, request) => {
      const resolved = await displays.resolveDisplay(request && request.displayId);
      if (!resolved.display) throw new Error('No display is available to record.');

      captureDisplayId = resolved.display.id;
      const config = settings.save({
        displayId: resolved.display.id,
        microphoneId: (request && request.microphoneId) || ''
      });
      fs.mkdirSync(config.recordingsDir, { recursive: true });

      const created = pkg.createPackage(config.recordingsDir, new Date());
      runs.set(created.id, {
        id: created.id,
        dir: created.dir,
        display: resolved.display,
        startedAt: new Date().toISOString(),
        degraded: []
      });

      const placement = windows.openBar(resolved.display.id);
      windows.hideMain();

      return {
        runId: created.id,
        dir: created.dir,
        display: resolved.display,
        fellBack: resolved.fellBack,
        barOnRecordedDisplay: Boolean(placement && placement.onRecordedDisplay)
      };
    });

    ipcMain.on('recording:tick', (_event, state) => windows.sendToBar('bar:state', state));
    ipcMain.on('bar:stop', () => windows.sendToMain('recording:stopRequested'));

    // An existing video takes the same route as a recording from here on: it gets
    // a package, its audio is transcribed and its frames are extracted. What it
    // has no use for is a display, a bar or a microphone.
    ipcMain.handle('import:begin', (_event, request) => {
      const name = imports.sourceName(request && request.name);
      if (!name) throw new Error('That file has no name, so there is nothing to import.');

      const config = settings.load();
      fs.mkdirSync(config.recordingsDir, { recursive: true });

      const created = pkg.createPackage(config.recordingsDir, new Date());
      runs.set(created.id, {
        id: created.id,
        dir: created.dir,
        source: { kind: 'import', name },
        startedAt: new Date().toISOString(),
        degraded: []
      });

      return { runId: created.id, dir: created.dir, fileName: imports.recordingFileName(name) };
    });

    ipcMain.handle('import:copyVideo', (_event, runId, sourcePath, fileName) => {
      const run = requireRun(runId);
      if (!sourcePath) throw new Error('That file could not be read from disk.');
      return pkg.copyRecording(run.dir, sourcePath, fileName);
    });

    ipcMain.handle('recording:finished', (_event, runId) => {
      windows.closeBar();
      windows.showMain();
      return requireRun(runId).dir;
    });

    ipcMain.handle('recording:saveVideo', (_event, runId, data, fileName) =>
      pkg.writeRecording(requireRun(runId).dir, data, fileName)
    );

    ipcMain.handle('recording:saveAudio', (_event, runId, data) =>
      pkg.writeAudio(requireRun(runId).dir, data)
    );

    ipcMain.handle('recording:saveFrames', (_event, runId, frames) => {
      const run = requireRun(runId);
      run.keyframes = pkg.writeFrames(run.dir, frames);
      return run.keyframes;
    });

    ipcMain.handle('transcribe:status', () => whisper.locate(appRoot));

    ipcMain.handle('transcribe:run', async (_event, runId, request) => {
      const run = requireRun(runId);
      return whisper.transcribe({
        appRoot,
        wavPath: path.join(run.dir, 'narration.wav'),
        language: languages.normalize((request && request.language) || settings.load().language),
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
        source: run.source,
        // Which build made this package. A bug report arrives with the package
        // attached, and "it did this" is only actionable if it says which build
        // did it.
        build: buildInfo.describe(options.appVersion),
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

    // What an export would contain, so the choice of whether to include the
    // video can be put to the user with its cost attached rather than as a bare
    // question.
    ipcMain.handle('export:plan', (_event, runId) => exporter.plan(requireRun(runId).dir));

    ipcMain.handle('export:save', async (event, runId, request) => {
      const run = requireRun(runId);
      // Both are opt-in. A caller that says nothing gets the lean export.
      const includeVideo = Boolean(request && request.includeVideo);
      const includeAudio = Boolean(request && request.includeAudio);

      const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Save this review as a zip',
        defaultPath: path.join(
          settings.load().recordingsDir,
          exportRules.zipFileName(run.id, { includeVideo, includeAudio })
        ),
        filters: [{ name: 'Zip archive', extensions: ['zip'] }]
      });

      // Cancelling is an ordinary outcome, not a failure.
      if (chosen.canceled || !chosen.filePath) return { canceled: true };

      const result = await exporter.save({
        dir: run.dir,
        target: chosen.filePath,
        includeVideo,
        includeAudio
      });
      return Object.assign({ canceled: false }, result);
    });

    ipcMain.handle('clipboard:write', (_event, text) => {
      clipboard.writeText(String(text || ''));
      return true;
    });
  }

  return { registerIpc, installDisplayMediaHandler, runs };
}

module.exports = { createRuntime };
