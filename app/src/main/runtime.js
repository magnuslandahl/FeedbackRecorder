'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ipcMain,
  desktopCapturer,
  shell,
  clipboard,
  dialog,
  BrowserWindow,
  nativeImage,
  globalShortcut
} = require('electron');

const displays = require('./displays');
const permissions = require('./permissions');
const settings = require('./settings');
const whisper = require('./whisper');
const pkg = require('./package-writer');
const buildInfo = require('./build-info');
const exporter = require('./exporter');
const updater = require('./updater');
const inputCaptureModule = require('./input-capture');
const languages = require('../shared/languages');
const imports = require('../shared/imports');
const exportRules = require('../shared/exports');
const paths = require('../shared/paths');
const shortcuts = require('../shared/shortcuts');

// Everything the renderer can ask for, with window handling injected rather than
// reached for. main.js supplies real windows; the end-to-end test supplies a
// hidden one, so the test drives the same handlers the app does instead of a
// copy of them that can drift.

function createRuntime(options) {
  const appRoot = options.appRoot;
  const windows = options.windows;
  const inputCapture = inputCaptureModule.create({
    appRoot,
    resourcesPath: options.resourcesPath || process.resourcesPath
  });
  const runs = new Map();
  // The zip built for each run so it can be dragged out. Kept here rather than
  // on the run so the renderer never learns a path it could hand back.
  const dragFiles = new Map();
  const dragGenerations = new Map();
  let captureSource = null;

  function requireRun(runId) {
    const run = runs.get(runId);
    if (!run) throw new Error(`Unknown recording ${runId}`);
    return run;
  }

  function discardPreparedDrag(runId) {
    const generation = (dragGenerations.get(runId) || 0) + 1;
    dragGenerations.set(runId, generation);
    const previous = dragFiles.get(runId);
    dragFiles.delete(runId);
    if (!previous) return generation;
    try {
      fs.rmSync(path.dirname(previous), { recursive: true, force: true });
    } catch (error) {
      // It is a disposable convenience file. Its stale contents are no longer
      // reachable through this runtime even if the temporary cleanup failed.
    }
    return generation;
  }

  // Chromium's own picker is never shown. FeedbackRecorder's picker includes
  // physical displays plus, on macOS, application windows (including native
  // full-screen windows in other Spaces), and keeps the microphone state beside
  // that choice.
  function installDisplayMediaHandler(targetSession) {
    targetSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const kind = captureSource && captureSource.kind === 'window' ? 'window' : 'screen';
          const sources = await desktopCapturer.getSources({ types: [kind] });
          const chosen =
            sources.find(
              (source) => captureSource && source.id === captureSource.sourceId
            ) ||
            (kind === 'screen'
              ? sources.find(
                  (source) =>
                    captureSource &&
                    String(source.display_id) === String(captureSource.displayId)
                ) || sources[0]
              : null);
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
    ipcMain.handle('updates:check', () => updater.check());
    ipcMain.handle('updates:install', async (event, asset) => {
      const sender = event.sender;
      return updater.install(asset, (fraction) => {
        if (!sender.isDestroyed()) sender.send('updates:progress', fraction);
      });
    });
    ipcMain.handle('updates:openPage', async (_event, url) => {
      await shell.openExternal(url || updater.RELEASES_PAGE);
      return true;
    });
    ipcMain.handle('permissions:describe', () => permissions.describe());
    ipcMain.handle('permissions:prime', () => permissions.prime());
    ipcMain.handle('permissions:restart', () => permissions.restart());
    ipcMain.handle('permissions:resetAndRestart', () => permissions.resetAndRestart());
    ipcMain.handle('permissions:acknowledgeMigration', () => permissions.acknowledgeMigration());
    ipcMain.handle('permissions:requestMicrophone', () => permissions.requestMicrophone());
    ipcMain.handle('permissions:openSettings', (_event, kind) => permissions.openSettings(kind));
    ipcMain.handle('input:status', () =>
      inputCaptureModule.status(appRoot, options.resourcesPath || process.resourcesPath)
    );
    ipcMain.handle('input:requestPermissions', () =>
      inputCaptureModule.requestPermissions(
        appRoot,
        options.resourcesPath || process.resourcesPath
      )
    );

    ipcMain.handle('settings:load', () => settings.load());
    ipcMain.handle('settings:save', (_event, patch) => settings.save(patch));

    ipcMain.handle('recording:begin', async (_event, request) => {
      const wanted = request && (request.sourceId || request.displayId);
      const resolved = await displays.resolveDisplay(wanted);
      if (!resolved.display) {
        throw new Error(
          resolved.missingWindow
            ? 'The selected app window is no longer available. Choose it again.'
            : 'No screen or app window is available to record.'
        );
      }

      captureSource = resolved.display;
      const patch = { microphoneId: (request && request.microphoneId) || '' };
      // Window identifiers are tied to one open window and do not survive an
      // app relaunch. Remember only physical displays.
      if (resolved.display.kind !== 'window') patch.displayId = resolved.display.id;
      const config = settings.save(patch);
      fs.mkdirSync(config.recordingsDir, { recursive: true });

      const created = pkg.createPackage(config.recordingsDir, new Date());
      runs.set(created.id, {
        id: created.id,
        dir: created.dir,
        display: resolved.display,
        startedAt: new Date().toISOString(),
        degraded: []
      });

      const placement = windows.openBar(
        resolved.display.kind === 'window' ? null : resolved.display.id
      );
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

    // Discarding destroys a review that cannot be performed again from memory,
    // so it is confirmed before anything stops. The dialog has no parent on
    // purpose: the main window is hidden while recording, and attaching a modal
    // sheet to a hidden window puts the question somewhere nobody can answer it.
    ipcMain.on('bar:discard', async () => {
      const choice = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Keep recording', 'Discard it'],
        defaultId: 0,
        cancelId: 0,
        title: 'Discard this recording?',
        message: 'Discard this recording?',
        detail:
          'Everything captured so far — the screen and the narration — is deleted, and the recording carries on until you answer. This cannot be undone.'
      });

      if (choice.response === 1) windows.sendToMain('recording:discardRequested');
      else windows.sendToBar('bar:discardCancelled');
    });

    // What the keyboard route into a running recording is, and whether it can
    // actually be had. The set-up screen asks before promising it; the bar asks
    // before naming it on the Stop button.
    ipcMain.handle('shortcuts:stop', () =>
      shortcuts.stopState(globalShortcut, process.platform)
    );

    ipcMain.handle('recording:discard', async (_event, runId) => {
      windows.closeBar();
      windows.showMain();
      const run = runs.get(runId);
      if (!run) return false;
      await inputCapture.discard(runId);
      // The package directory is created at Begin, so a discarded run leaves a
      // half-written one behind unless it is removed here.
      fs.rmSync(run.dir, { recursive: true, force: true });
      runs.delete(runId);
      return true;
    });

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

    ipcMain.handle('recording:inputStart', async (_event, runId, request) => {
      const run = requireRun(runId);
      if (request && Number(request.captureWidth) > 0 && Number(request.captureHeight) > 0) {
        run.display = Object.assign({}, run.display, {
          actualWidth: Number(request.captureWidth),
          actualHeight: Number(request.captureHeight),
          captureWidth: Number(request.captureWidth),
          captureHeight: Number(request.captureHeight)
        });
      }
      const state = await inputCapture.start(run, request || {});
      run.inputStart = state;
      return state;
    });

    ipcMain.handle('recording:inputStop', async (_event, runId) => {
      const run = requireRun(runId);
      const captured = await inputCapture.stop(runId);
      let status = captured.status || run.inputStart || {};

      // stop() has no active helper when capture was disabled or unsupported,
      // so the answer from start is the useful one in those cases.
      if (!status.enabled && run.inputStart) status = run.inputStart;

      const available = Boolean(status.pointer || status.keyboard);
      if (available) {
        run.inputEvents = captured.entries || [];
        run.input = pkg.writeInputEvents(
          run.dir,
          run.inputEvents,
          status
        );
      } else {
        run.inputEvents = [];
        run.input = {
          available: false,
          pointer: false,
          keyboard: false,
          summary: 'not captured',
          counts: {},
          privacy:
            'Shortcuts and navigation keys are named. Ordinary typing is counted, never stored.',
          reason:
            status.reason ||
            (status.enabled === false
              ? 'Input activity capture was turned off in Settings.'
              : 'Clicks and keyboard activity were not captured.')
        };
      }

      if (status.reason && available) run.degraded.push(status.reason);
      if (status.interrupted) {
        run.degraded.push(
          'Input activity capture was interrupted during the recording, so its timeline may have a gap.'
        );
      }
      if (status.malformed) {
        run.degraded.push(
          `${status.malformed} input event${status.malformed === 1 ? '' : 's'} could not be read, so the timeline may have a gap.`
        );
      }
      return run.input;
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
      const previous = run.finalized;
      const keyframes = details.keyframes || run.keyframes || [];
      const base = Object.assign({}, run);
      // A second framing pass must not serialize the complete previous result
      // inside the next run.json.
      delete base.finalized;
      const merged = Object.assign(base, details, {
        id: run.id,
        packagePath: run.dir,
        startedAt: run.startedAt,
        display: run.display,
        source: run.source,
        // Which build made this package. A bug report arrives with the package
        // attached, and "it did this" is only actionable if it says which build
        // did it.
        build: buildInfo.describe(options.appVersion),
        keyframes,
        revisits: details.revisits || run.revisits || [],
        notes:
          details.notes ||
          pkg.remapNotes(previous && previous.notes, keyframes),
        degraded: Array.from(new Set((run.degraded || []).concat(details.degraded || [])))
      });
      const result = pkg.finalize(run.dir, merged);
      runs.set(runId, Object.assign(run, { finalized: result.run }));
      discardPreparedDrag(runId);
      return { dir: run.dir, brief: result.brief, prompt: result.prompt, run: result.run };
    });

    ipcMain.handle('recording:saveNotes', (_event, runId, notes) => {
      const run = requireRun(runId);
      if (!run.finalized) throw new Error('Finish processing the recording before adding notes.');
      const result = pkg.finalize(
        run.dir,
        Object.assign({}, run.finalized, {
          inputEvents: run.inputEvents || [],
          notes
        })
      );
      run.finalized = result.run;
      discardPreparedDrag(runId);
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

    // Where packages and zips are written. A folder is worth asking the
    // operating system for rather than typing: the picker knows which paths
    // exist and which are writable, and a mistyped one fails at the worst
    // moment, when a recording has already been made.
    ipcMain.handle('settings:chooseFolder', async (event) => {
      const current = settings.load().recordingsDir;
      const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Where should recordings be saved?',
        defaultPath: current,
        properties: ['openDirectory', 'createDirectory']
      });
      if (chosen.canceled || !chosen.filePaths || !chosen.filePaths.length) return { canceled: true };

      const dir = chosen.filePaths[0];
      // Chosen, not defaulted, so the sync-root rule is a warning rather than a
      // refusal — somebody may well want a review to land in a shared folder.
      // Saying so beats discovering it from an upload notification.
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        return { canceled: false, error: `That folder could not be used: ${error.message}` };
      }

      return {
        canceled: false,
        settings: settings.save({ recordingsDir: dir }),
        synced: paths.isSyncedLocation(dir)
      };
    });

    ipcMain.handle('settings:defaultFolder', () => {
      const dir = settings.defaultRecordingsDir();
      return { settings: settings.save({ recordingsDir: dir }), synced: paths.isSyncedLocation(dir) };
    });

    ipcMain.handle('settings:folderState', () => {
      const dir = settings.load().recordingsDir;
      return { dir, synced: paths.isSyncedLocation(dir), isDefault: dir === settings.defaultRecordingsDir() };
    });

    // A zip built ahead of the drag, because a drag cannot wait for one.
    //
    // It is the lean export — the brief, the transcript and the pictures — which
    // is what this is for: dropping a review into a chat. The video would make
    // it too big to send and the narration audio is somebody's voice, and both
    // are already a deliberate opt-in on the export button next to it.
    //
    // It goes to a temporary folder rather than into the package, so it cannot
    // end up inside the next export of that same package.
    ipcMain.handle('export:prepareDrag', async (_event, runId) => {
      const run = requireRun(runId);
      const generation = discardPreparedDrag(runId);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbackrecorder-drag-'));
      const target = path.join(dir, exportRules.zipFileName(run.id, {}));

      try {
        const result = await exporter.save({ dir: run.dir, target });
        if (dragGenerations.get(runId) !== generation) {
          fs.rmSync(dir, { recursive: true, force: true });
          return { stale: true };
        }
        dragFiles.set(runId, target);
        return { path: target, name: path.basename(target), bytes: result.bytes };
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
      }
    });

    // Handing a file to the operating system. This has to come from the main
    // process: the renderer only gets to say which recording it means, and it
    // cannot name a path of its own choosing.
    ipcMain.on('export:drag', (event, runId) => {
      const file = dragFiles.get(runId);
      if (!file || !fs.existsSync(file)) return;

      // Windows throws on a drag with no icon, so this is not decoration.
      const icon = nativeImage
        .createFromPath(path.join(appRoot, 'src', 'renderer', 'logo.png'))
        .resize({ width: 64, height: 64 });

      event.sender.startDrag({ file, icon });
    });
  }

  return {
    registerIpc,
    installDisplayMediaHandler,
    runs,
    // The end-to-end test needs to look at the zip built for dragging. The map
    // itself stays private: a path the renderer could name is a path it could
    // ask to have handed to another application.
    dragFileFor: (runId) => dragFiles.get(runId) || null
  };
}

module.exports = { createRuntime };
