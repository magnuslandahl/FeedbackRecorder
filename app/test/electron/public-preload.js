'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const region = require('../../src/shared/region');
const keyframes = require('../../src/shared/keyframes');
const narration = require('../../src/shared/narration');
const wav = require('../../src/shared/wav');
const naming = require('../../src/shared/naming');
const languages = require('../../src/shared/languages');
const imports = require('../../src/shared/imports');
const exportRules = require('../../src/shared/exports');
const themes = require('../../src/shared/themes');
const fixtures = require('./public-fixtures');

const profile = fixtures.PUBLIC_PROFILE;
let completedRun = null;

const settings = {
  recordingsDir: 'Local FeedbackRecorder folder',
  microphoneId: 'public-demo-microphone',
  displayId: 'public-demo-display',
  language: profile.language,
  theme: profile.theme,
  captureInputActivity: false,
  inputPermissionsAsked: false
};

const api = {
  publicMode: true,
  publicMicrophones: fixtures.microphones(),
  platform: 'win32',
  listDisplays: async () => fixtures.displays(),
  appVersion: async () => fixtures.build(),
  checkForUpdates: async () => ({ checked: true, available: false }),
  installUpdate: async () => {
    throw new Error('Public screenshot mode cannot install updates.');
  },
  openReleasesPage: async () => true,
  onUpdateProgress: () => {},

  permissions: async () => ({
    platform: 'win32',
    microphone: { granted: true, status: 'allowed', hint: '' },
    screen: { granted: true, status: 'allowed', hint: '', needsRestart: false },
    migration: null
  }),
  primePermissions: async () => true,
  restartApp: async () => true,
  resetPermissionsAndRestart: async () => true,
  acknowledgePermissionMigration: async () => true,
  requestMicrophone: async () => true,
  openPermissionSettings: async () => true,
  inputStatus: async () => ({ supported: false }),
  requestInputPermissions: async () => ({ supported: false }),

  loadSettings: async () => Object.assign({}, settings),
  saveSettings: async (patch) => Object.assign(settings, patch || {}),

  beginRecording: async () => {
    throw new Error('Public screenshot mode cannot record a live display.');
  },
  tick: () => {},
  recordingFinished: async () => profile.packageLabel,
  saveVideo: async () => true,
  saveAudio: async () => true,
  saveFrames: async (_runId, frames) =>
    frames.map((frame, index) => ({
      file: `frames/keyframe-${String(index + 1).padStart(3, '0')}.png`,
      time: frame.time,
      score: frame.score
    })),
  startInputCapture: async () => ({ supported: false, enabled: false }),
  stopInputCapture: async () => ({ available: false }),

  beginImport: async () => ({
    runId: profile.runId,
    dir: profile.packageLabel,
    fileName: profile.recordingName
  }),
  copyImportedVideo: async () => {
    throw new Error('Public screenshot fixtures never read a video from disk.');
  },
  pathForFile: () => '',

  transcriberStatus: async () => ({ ready: true }),
  transcribe: async () => fixtures.transcript(),
  finalize: async (_runId, details) => {
    completedRun = Object.assign({}, details, {
      id: profile.runId,
      packagePath: profile.packageLabel,
      startedAt: profile.startedAt,
      source: { kind: 'import', name: profile.recordingName },
      build: fixtures.build(),
      input: { available: false },
      notes: { general: '', frames: [] }
    });
    return {
      dir: profile.packageLabel,
      brief: 'A deterministic demo handoff.',
      prompt: 'Keep the chosen notification option visible after saving.',
      run: completedRun
    };
  },
  saveNotes: async (_runId, notes) => {
    completedRun = Object.assign({}, completedRun, { notes });
    return {
      dir: profile.packageLabel,
      brief: 'A deterministic demo handoff with written context.',
      prompt: 'Keep the chosen notification option visible after saving.',
      run: completedRun
    };
  },

  reveal: async () => true,
  copy: async () => true,
  exportPlan: async () => ({
    videoBytes: 2_400_000,
    videoFiles: 1,
    audioBytes: 420_000,
    audioFiles: 1,
    otherBytes: 186_000
  }),
  exportSave: async () => ({ canceled: true }),
  prepareDrag: async () => ({ name: profile.zipName, bytes: 186_000 }),
  startDrag: () => {},

  chooseFolder: async () => ({ canceled: true }),
  useDefaultFolder: async () => ({
    settings: Object.assign({}, settings),
    dir: settings.recordingsDir,
    isDefault: true,
    synced: false
  }),
  folderState: async () => ({
    dir: settings.recordingsDir,
    isDefault: true,
    synced: false
  }),

  onStopRequested: () => {},
  stopShortcut: async () => ({
    available: true,
    active: true,
    label: 'Ctrl+Shift+.',
    accelerator: 'Control+Shift+.'
  }),
  onDiscardRequested: () => {},
  discardRecording: async () => true,

  requestStop: () => {},
  requestDiscard: () => {},
  onDiscardCancelled: () => {},
  onBarState: (handler) =>
    ipcRenderer.on('public:bar-state', (_event, state) => handler(state)),

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
    signatureShape: keyframes.SIGNATURE,
    summarizeKeyframes: keyframes.summarize,
    measureLevels: narration.measureLevels,
    classifyNarration: narration.classifyNarration,
    meterWidth: narration.meterWidth,
    meterTone: narration.meterTone,
    encodeWav: wav.encodeWav,
    mixToMono: wav.mixToMono,
    formatTimecode: naming.formatTimecode,
    formatDuration: naming.formatDuration,
    languages: languages.LANGUAGES,
    describeLanguage: languages.describe,
    normalizeLanguage: languages.normalize,
    isAutoLanguage: languages.isAuto,
    themes: themes.THEMES,
    normalizeTheme: themes.normalize,
    resolveTheme: themes.resolve,
    looksLikeVideo: imports.looksLikeVideo,
    recordingFileName: imports.recordingFileName,
    videoExtensions: imports.VIDEO_EXTENSIONS,
    formatBytes: exportRules.formatBytes
  }
};

contextBridge.exposeInMainWorld('feedback', api);
