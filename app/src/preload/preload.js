'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const region = require('../shared/region');
const keyframes = require('../shared/keyframes');
const narration = require('../shared/narration');
const wav = require('../shared/wav');
const naming = require('../shared/naming');
const languages = require('../shared/languages');
const imports = require('../shared/imports');

// The renderer gets a named surface, not the IPC channel itself. Everything that
// touches disk, processes or other windows lives on the other side of it.
contextBridge.exposeInMainWorld('feedback', {
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  permissions: () => ipcRenderer.invoke('permissions:describe'),
  requestMicrophone: () => ipcRenderer.invoke('permissions:requestMicrophone'),
  openPermissionSettings: (kind) => ipcRenderer.invoke('permissions:openSettings', kind),

  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  beginRecording: (options) => ipcRenderer.invoke('recording:begin', options),
  tick: (state) => ipcRenderer.send('recording:tick', state),
  recordingFinished: (runId) => ipcRenderer.invoke('recording:finished', runId),
  saveVideo: (runId, data, fileName) => ipcRenderer.invoke('recording:saveVideo', runId, data, fileName),
  saveAudio: (runId, data) => ipcRenderer.invoke('recording:saveAudio', runId, data),
  saveFrames: (runId, frames) => ipcRenderer.invoke('recording:saveFrames', runId, frames),

  beginImport: (options) => ipcRenderer.invoke('import:begin', options),
  copyImportedVideo: (runId, sourcePath, fileName) =>
    ipcRenderer.invoke('import:copyVideo', runId, sourcePath, fileName),

  // A dropped or picked File says nothing about where it lives on disk. This is
  // the supported way to ask, and it returns '' for anything not backed by a
  // real file, which is the case that has to fall back to copying the bytes.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (error) {
      return '';
    }
  },

  transcriberStatus: () => ipcRenderer.invoke('transcribe:status'),
  transcribe: (runId, options) => ipcRenderer.invoke('transcribe:run', runId, options),
  finalize: (runId, details) => ipcRenderer.invoke('recording:finalize', runId, details),

  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),

  onStopRequested: (handler) => ipcRenderer.on('recording:stopRequested', () => handler()),

  // Used by the recording bar window only.
  requestStop: () => ipcRenderer.send('bar:stop'),
  onBarState: (handler) => ipcRenderer.on('bar:state', (_event, state) => handler(state)),

  // The pure logic is shared with the main process and the tests rather than
  // reimplemented here, so there is one definition of each rule.
  lib: {
    normalizeDrag: region.normalizeDrag,
    clampRegion: region.clampRegion,
    scaleRegion: region.scaleRegion,
    isWholeFrame: region.isWholeFrame,
    wholeFrame: region.wholeFrame,
    describeRegion: region.describeRegion,
    summarizeRegion: region.summarizeRegion,
    selectKeyframes: keyframes.selectKeyframes,
    sampleIntervalSeconds: keyframes.sampleIntervalSeconds,
    measureLevels: narration.measureLevels,
    classifyNarration: narration.classifyNarration,
    encodeWav: wav.encodeWav,
    mixToMono: wav.mixToMono,
    formatTimecode: naming.formatTimecode,
    formatDuration: naming.formatDuration,
    languages: languages.LANGUAGES,
    describeLanguage: languages.describe,
    normalizeLanguage: languages.normalize,
    isAutoLanguage: languages.isAuto,
    looksLikeVideo: imports.looksLikeVideo,
    recordingFileName: imports.recordingFileName,
    videoExtensions: imports.VIDEO_EXTENSIONS
  }
});
