'use strict';

const api = window.feedback;
const lib = api.lib;

if (api.integratedTitlebar && (api.platform === 'win32' || api.platform === 'darwin')) {
  document.documentElement.dataset.titlebar = api.platform;
}

const el = (id) => document.getElementById(id);
const STATES = ['ready', 'recording', 'importing', 'framing', 'processing', 'done', 'history'];

// Which of the four things the user thinks they are doing each state belongs to.
const STEP_OF = {
  ready: 'ready',
  recording: 'recording',
  importing: 'recording',
  framing: 'framing',
  processing: 'framing',
  done: 'done'
};
const STEP_ORDER = ['ready', 'recording', 'framing', 'done'];

// States with nothing to act on and no content that fills the window.
const WAITING_STATES = new Set(['recording', 'importing', 'processing']);

// What each state is called out loud. A state change only repaints, so without
// this a screen reader is told nothing at all about having moved on.
const STATE_NAMES = {
  ready: 'Set up',
  recording: 'Recording',
  importing: 'Reading your video',
  framing: 'Framing the recording',
  processing: 'Processing the recording',
  done: 'Ready to hand over',
  history: 'Recordings'
};

// Where the Recordings button is offered. Everywhere else, leaving would walk
// away from a recording or a processing pass that is still in flight.
const HISTORY_FROM = new Set(['ready', 'done', 'history']);

const ui = {
  micSelect: el('mic-select'),
  micMeter: el('mic-meter'),
  micMeterWrap: el('mic-meter-wrap'),
  micHint: el('mic-hint'),
  recordingHint: el('recording-hint'),
  micTest: el('mic-test'),
  displayList: el('display-list'),
  permissionPanel: el('permission-panel'),
  permissionList: el('permission-list'),
  permissionMigrationNote: el('permission-migration-note'),
  permissionReset: el('permission-reset'),
  permissionResetNote: el('permission-reset-note'),
  transcriberPanel: el('transcriber-panel'),
  start: el('start'),
  readyNote: el('ready-note'),
  canvas: el('frame-canvas'),
  selection: el('frame-selection'),
  scrubber: el('scrubber'),
  frameStatus: el('frame-status'),
  frameReset: el('frame-reset'),
  frameAccept: el('frame-accept'),
  progress: el('progress'),
  processFill: el('process-fill'),
  processMeter: el('process-meter'),
  processCancel: el('process-cancel'),
  keyframeReview: el('keyframe-review'),
  keyframePreview: el('keyframe-preview'),
  keyframeViewport: el('keyframe-viewport'),
  keyframeZoom: el('keyframe-zoom'),
  keyframeZoomValue: el('keyframe-zoom-value'),
  keyframeImage: el('keyframe-image'),
  keyframePrevious: el('keyframe-previous'),
  keyframeSlider: el('keyframe-slider'),
  keyframeNext: el('keyframe-next'),
  keyframePosition: el('keyframe-position'),
  keyframeComment: el('keyframe-comment'),
  frameNarration: el('frame-narration'),
  generalNotes: el('general-notes'),
  notesStatus: el('notes-status'),
  transcriptReview: el('transcript-review'),
  transcriptEngine: el('transcript-engine'),
  transcriptPreview: el('transcript-preview'),
  transcriptEditor: el('transcript-editor'),
  transcriptFields: el('transcript-fields'),
  transcriptEdit: el('transcript-edit'),
  transcriptDone: el('transcript-done'),
  transcriptStatus: el('transcript-status'),
  keyframeDialog: el('keyframe-dialog'),
  keyframeDialogTitle: el('keyframe-dialog-title'),
  keyframeDialogImage: el('keyframe-dialog-image'),
  keyframeDialogClose: el('keyframe-dialog-close'),
  summary: el('summary'),
  warnings: el('warnings'),
  packagePath: el('package-path'),
  packageGlance: el('package-glance'),
  handoverSummary: el('handover-summary'),
  reviewSummary: el('review-summary'),
  recordingReview: el('recording-review'),
  handoverLocal: el('handover-local'),
  handoverAttachment: el('handover-attachment'),
  localPromptPreview: el('local-prompt-preview'),
  attachmentPromptPreview: el('attachment-prompt-preview'),
  copyPrompt: el('copy-prompt'),
  copyAttachment: el('copy-attachment'),
  copyFullBrief: el('copy-full-brief'),
  reveal: el('reveal'),
  reframe: el('reframe'),
  again: el('again'),
  video: el('source'),
  dropzone: el('dropzone'),
  chooseVideo: el('choose-video'),
  videoFile: el('video-file'),
  importNote: el('import-note'),
  importProgress: el('import-progress'),
  appVersion: el('app-version'),
  checkUpdates: el('check-updates'),
  updatePanel: el('update-panel'),
  updateCheckNote: el('update-check-note'),
  updateSummary: el('update-summary'),
  updateInstall: el('update-install'),
  updatePage: el('update-page'),
  updateNote: el('update-note'),
  updateMeter: el('update-meter'),
  updateProgress: el('update-progress'),
  exportButton: el('export'),
  exportVideo: el('export-video'),
  exportVideoLabel: el('export-video-label'),
  exportAudio: el('export-audio'),
  exportAudioLabel: el('export-audio-label'),
  exportNote: el('export-note'),
  themeSelect: el('theme-select'),
  folderPath: el('folder-path'),
  folderChange: el('folder-change'),
  folderDefault: el('folder-default'),
  folderNote: el('folder-note'),
  dragFile: el('drag-file'),
  dragName: el('drag-name'),
  dragSub: el('drag-sub'),
  actions: el('actions'),
  openSettings: el('open-settings'),
  openHistory: el('open-history'),
  historyList: el('history-list'),
  historySearch: el('history-search'),
  historyStatus: el('history-status'),
  historyCount: el('history-count'),
  historyFolder: el('history-folder'),
  historyBack: el('history-back'),
  historyRow: el('history-row'),
  settingsDialog: el('settings-dialog'),
  settingsClose: el('settings-close'),
  inputSettings: el('input-settings'),
  captureInputActivity: el('capture-input-activity'),
  inputCaptureNote: el('input-capture-note'),
  body: document.querySelector('main'),
  announcer: el('state-announcer'),
  recordStep: document.querySelector('#steps li[data-step="recording"] .step'),
  frameStep: document.querySelector('#steps li[data-step="framing"] .step')
};

// Which finished steps can be gone back to from each state. Only the Done
// screen offers it: there the package is complete, so leaving it loses nothing.
// From framing it would leave a half-built package behind. A package reopened
// from the Recordings screen has no video loaded, so it cannot be reframed.
const STEP_TARGETS = {
  done: {
    ready: { label: 'Set up: start another recording', button: () => ui.again },
    framing: {
      label: 'Frame: adjust the framing',
      button: () => ui.reframe,
      available: () => !session.reopened
    }
  }
};

function stepTarget(state, step) {
  const target = (STEP_TARGETS[state] || {})[step];
  return target && (!target.available || target.available()) ? target : null;
}

// The microphone hint carries a test's verdict or a reason the microphone
// cannot be used, and nothing at rest. It used to hold a standing instruction,
// which cost three lines of the first screen to say something true only while
// somebody was looking at the meter — and the meter is only up during a test.
const NO_MIC_HINT =
  'No microphone was found. You can still record the screen — the walkthrough will have no ' +
  'narration, and the brief will say so.';

const session = {
  displays: [],
  selectedDisplayId: null,
  // Known from the bridge rather than from a permission reply, so a message that
  // reads differently per platform is never worded before it is known which one
  // this is. refreshPermissions() confirms it with what the main process says.
  platform: api.platform,
  settings: null,
  micStream: null,
  micAnalyser: null,
  meterTimer: null,
  recorder: null,
  inputCapturePromise: null,
  chunks: [],
  displayStream: null,
  startedAt: 0,
  tickTimer: null,
  run: null,
  completedRun: null,
  // A finished package opened again from the Recordings screen, rather than
  // one just made: its video is not loaded, so it cannot be reframed.
  reopened: false,
  blob: null,
  videoUrl: null,
  importing: false,
  frameSize: { width: 0, height: 0 },
  duration: 0,
  region: null,
  transcriptPromise: null,
  narration: null,
  degraded: [],
  prompt: '',
  exportPlan: null,
  // Identity of the save that owns this recording's handover controls.
  exportOperation: null,
  handoverRunId: null,
  // Whether the zip behind the drag handle has been written yet.
  dragReady: false,
  previewTimer: null,
  previewBusy: false,
  frameUrls: [],
  keyframeIndex: 0,
  frameTimeline: [],
  notesDraft: null,
  transcriptDraft: null,
  transcriptDirty: false,
  editsTimer: null,
  editsRevision: 0,
  editsSavedRevision: 0,
  editsSaving: null,
  dragPreparation: 0,
  stopping: false,
  discarding: false,
  // The processing pass in flight, so it can be cancelled, and a promise that
  // settles when it has actually stopped touching the video.
  processing: null,
  processingSettled: null,
  // The Recordings screen: what was listed, which screen to go back to, and
  // the thumbnails already fetched for it.
  historyItems: [],
  historyReturn: 'ready',
  historyThumbs: new Map(),
  historyBusy: false
};

function showState(name) {
  STATES.forEach((state) => {
    const node = el(`state-${state}`);
    if (node) node.hidden = state !== name;
  });

  // The action bar is pinned outside the scrolling area, so each state swaps in
  // its own buttons rather than putting them where the content ends.
  document.querySelectorAll('.action-set').forEach((node) => {
    node.hidden = node.dataset.for !== name;
  });

  // Three states have nothing to act on, and the bar still drew its border and
  // its padding in them — an empty ruled band across the bottom of the window.
  // Hiding it takes the rule away rather than leaving a bar with no buttons.
  if (ui.actions) ui.actions.hidden = !document.querySelector(`.action-set[data-for="${name}"]`);

  // None of those three fills the window either, so what little they do show is
  // centred in the space instead of pinned to the top of a very tall gap.
  if (ui.body) ui.body.classList.toggle('waiting', WAITING_STATES.has(name));

  // An imported video occupies the same slot in the flow as recording one, but
  // saying "Record" while it is being read would describe something the app is
  // not doing.
  if (ui.recordStep) ui.recordStep.textContent = name === 'importing' ? 'Import' : 'Record';

  // Processing is the tail of the framing step rather than a fifth one, but
  // leaving it labelled "Frame" pointed at work the user had already finished.
  // The step is named for what the app is doing, exactly as the record step is
  // renamed while a video is being imported.
  if (ui.frameStep) ui.frameStep.textContent = name === 'processing' ? 'Process' : 'Frame';

  const step = STEP_OF[name];
  const reached = STEP_ORDER.indexOf(step);
  document.querySelectorAll('#steps li').forEach((node) => {
    const index = STEP_ORDER.indexOf(node.dataset.step);
    const active = index === reached;
    node.classList.toggle('active', active);
    node.classList.toggle('past', index < reached);
    // Which one is current, said rather than only drawn.
    if (active) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');

    const button = node.querySelector('.step');
    const target = stepTarget(name, node.dataset.step);
    if (button) {
      button.disabled = !target;
      if (target) {
        button.title = target.label;
        button.setAttribute('aria-label', target.label);
      } else {
        button.removeAttribute('title');
        button.removeAttribute('aria-label');
      }
    }
  });

  if (ui.announcer) ui.announcer.textContent = STATE_NAMES[name] || '';

  if (ui.openHistory) {
    ui.openHistory.hidden = !HISTORY_FROM.has(name);
    ui.openHistory.classList.toggle('active', name === 'history');
    ui.openHistory.setAttribute('aria-pressed', String(name === 'history'));
  }

  // The previews are only worth retaking while the picker is on screen.
  if (name === 'ready') startPreviewRefresh();
  else stopPreviewRefresh();
}

function note(target, text, tone) {
  target.textContent = text || '';
  target.className = tone ? `hint ${tone}` : 'hint';
}

// A hint with nothing in it is a blank line, and the microphone panel is silent
// most of the time, so this collapses instead of reserving the space.
function setMicHint(text, tone) {
  note(ui.micHint, text, tone);
  ui.micHint.hidden = !text;
}

// ---------------------------------------------------------------- Ready state

// The build is shown before anything else runs, so a screenshot of a broken
// state always says which build broke.
async function showVersion() {
  try {
    const build = await api.appVersion();
    ui.appVersion.textContent = build.display;
    ui.appVersion.title = build.full;
  } catch (error) {
    ui.appVersion.textContent = '';
  }
}

// ----------------------------------------------------------------- Appearance

// Whether the operating system is asking for a light window. Watched rather
// than read once, because somebody on "match the system" expects the app to
// follow when the system switches at sunset.
const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)');

// Only ever "light" or "dark" reaches the document; see shared/themes.js.
function applyTheme(setting) {
  const resolved = lib.resolveTheme(setting, systemPrefersLight.matches);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

function buildThemePicker() {
  const current = lib.normalizeTheme(session.settings && session.settings.theme);

  lib.themes.forEach((theme) => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    ui.themeSelect.appendChild(option);
  });
  ui.themeSelect.value = current;

  ui.themeSelect.addEventListener('change', async () => {
    const chosen = lib.normalizeTheme(ui.themeSelect.value);
    applyTheme(chosen);
    session.settings = await api.saveSettings({ theme: chosen });
  });

  systemPrefersLight.addEventListener('change', () => {
    if (session.settings) applyTheme(session.settings.theme);
  });
}

function describeInputSetting(state) {
  if (!state) return;
  session.inputStatus = state;
  if (!state.supported) {
    ui.inputSettings.hidden = true;
    return;
  }

  ui.inputSettings.hidden = false;
  if (!ui.captureInputActivity.checked) {
    note(ui.inputCaptureNote, 'Turned off. New recordings will not include an input timeline.');
  } else if (state.pointer && state.keyboard) {
    note(ui.inputCaptureNote, 'Ready. Both clicks and keyboard activity will be timestamped.', 'good');
  } else {
    note(
      ui.inputCaptureNote,
      state.reason || 'macOS permission is needed before input activity can be recorded.',
      'warn'
    );
  }
}

function buildInputPicker() {
  ui.captureInputActivity.checked =
    Boolean(session.settings && session.settings.captureInputActivity);
  ui.inputSettings.hidden = session.platform !== 'darwin' && session.platform !== 'win32';

  ui.captureInputActivity.addEventListener('change', async () => {
    const enabled = ui.captureInputActivity.checked;
    session.settings = await api.saveSettings({
      captureInputActivity: enabled,
      inputPermissionsAsked:
        enabled ? true : Boolean(session.settings && session.settings.inputPermissionsAsked)
    });
    if (enabled && session.platform === 'darwin') await api.requestInputPermissions();
    await refreshPermissions();
  });
}

// ------------------------------------------------------- Where things are saved

async function refreshFolder() {
  const state = await api.folderState();
  ui.folderPath.textContent = state.dir;
  ui.folderDefault.disabled = state.isDefault;
  describeFolder(state);
}

// A folder inside a sync root is allowed but worth saying out loud: a review is
// hundreds of megabytes of whatever was on screen, and uploading that to
// corporate storage should be a decision rather than a surprise.
function describeFolder(state) {
  if (state.synced) {
    note(
      ui.folderNote,
      'That folder syncs to the cloud, so recordings will be uploaded. Fine if you meant it.',
      'warn'
    );
  } else if (state.isDefault) {
    note(ui.folderNote, 'Recordings and exported zips are both saved here.');
  } else {
    note(ui.folderNote, 'Recordings and exported zips are both saved here from now on.');
  }
}

async function changeFolder() {
  const result = await api.chooseFolder();
  if (result.canceled) return;
  if (result.error) {
    note(ui.folderNote, result.error, 'bad');
    return;
  }
  session.settings = result.settings;
  await refreshFolder();
}

async function useDefaultFolder() {
  const result = await api.useDefaultFolder();
  session.settings = result.settings;
  await refreshFolder();
}

// ------------------------------------------------------------------- Updating

// Downloading is remembered so a second click cannot start a second download of
// the same file over the first one.
let pendingUpdate = null;
let pendingInPlace = false;
let downloading = false;

function renderUpdate(result) {
  const panel = ui.updatePanel;
  const available = Boolean(result && result.available);
  ui.openSettings.classList.toggle('update-ready', available);
  ui.openSettings.title = available ? 'Settings — update available' : 'Settings';
  ui.openSettings.setAttribute('aria-label', ui.openSettings.title);
  if (!result || !result.available) {
    panel.hidden = true;
    pendingUpdate = null;
    return;
  }

  pendingUpdate = result.asset || null;
  pendingInPlace = Boolean(result.inPlace);
  const name = result.buildNumber ? `${result.version} (build ${result.buildNumber})` : result.version;
  ui.updateSummary.textContent = `FeedbackRecorder ${name} is available. You are running ${result.currentVersion}.`;

  // Windows and macOS both replace themselves now; Linux is handed the file.
  // Saying which before the click is the difference between a considered choice
  // and a surprise.
  const inPlace = Boolean(result.inPlace);
  ui.updateInstall.hidden = !result.installable;
  ui.updateInstall.textContent = inPlace ? 'Update now' : 'Download';
  // The download page is a way out when the app cannot update itself. Offering
  // it beside a button that does the whole thing only invites the longer route.
  ui.updatePage.hidden = inPlace && result.installable;
  ui.updateNote.textContent = result.installable
    ? (inPlace
      ? (session.platform === 'darwin'
        ? (result.permissionIdentity && result.permissionIdentity.stable
          ? 'FeedbackRecorder will close, update and reopen. Permissions already granted in macOS stay in place.'
          : 'FeedbackRecorder will close, update and reopen. This copy has a build-specific macOS identity, so the next launch removes its old permission entries and asks once more.')
        : 'FeedbackRecorder will close while it updates, then reopen.')
      : 'The download will be shown in your file manager when it is ready.')
    : (result.reason || '');
  panel.hidden = false;
}

async function checkForUpdates(quiet) {
  const button = ui.checkUpdates;
  button.disabled = true;
  button.textContent = 'Checking…';
  note(ui.updateCheckNote, '');
  try {
    const result = await api.checkForUpdates();
    if (!result.checked) {
      button.textContent = 'Check for updates';
      note(ui.updateCheckNote, result.reason || 'Could not check for updates.', 'bad');
      return;
    }
    renderUpdate(result);
    session.updatePageUrl = result.pageUrl;
    button.textContent = 'Check again';
    note(ui.updateCheckNote, result.available ? 'Update available.' : 'Up to date.');
  } catch (error) {
    button.textContent = 'Check for updates';
    note(ui.updateCheckNote, `Could not check for updates: ${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function installUpdate() {
  if (!pendingUpdate || downloading) return;
  downloading = true;
  ui.updateInstall.disabled = true;
  ui.updateInstall.textContent = 'Downloading…';
  ui.updateMeter.hidden = false;
  try {
    const result = await api.installUpdate(pendingUpdate);
    if (result && result.installed) {
      // The app is about to go; the helper reopens it.
      ui.updateInstall.textContent = 'Installing…';
    } else {
      // The swap could not be done, so the file is the answer instead. Saying
      // why beats a button that silently did something else than it offered.
      ui.updateInstall.textContent = 'Downloaded';
      ui.updatePage.hidden = false;
      note(
        ui.updateNote,
        result && result.reason
          ? `This copy could not be replaced automatically, so the download was opened instead: ${result.reason}`
          : 'The download was opened.',
        result && result.reason ? 'warn' : ''
      );
    }
  } catch (error) {
    ui.updateInstall.disabled = false;
    ui.updateInstall.textContent = pendingInPlace ? 'Update now' : 'Download';
    ui.updateMeter.hidden = true;
    note(ui.updateNote, `The update could not be downloaded: ${error.message}`, 'bad');
  } finally {
    downloading = false;
  }
}

async function refreshPermissions() {
  const state = await api.permissions();
  session.platform = state.platform;
  const rows = [];
  let input = null;

  if (
    (state.platform === 'darwin' || state.platform === 'win32') &&
    session.settings &&
    session.settings.captureInputActivity
  ) {
    input = await api.inputStatus();
    describeInputSetting(input);
  } else if (state.platform === 'darwin' || state.platform === 'win32') {
    describeInputSetting({
      supported: true,
      pointer: false,
      keyboard: false,
      reason: ''
    });
  }

  if (!state.microphone.granted || state.microphone.hint) {
    rows.push({ kind: 'microphone', label: 'Microphone', status: state.microphone.status, hint: state.microphone.hint });
  }
  if (!state.screen.granted) {
    rows.push({
      kind: 'screen',
      label: 'Screen recording',
      status: state.screen.status,
      hint: state.screen.hint,
      needsRestart: state.screen.needsRestart
    });
  }
  if (input && input.supported && (!input.helper ||
      (state.platform === 'win32' && (!input.pointer || !input.keyboard)))) {
    rows.push({
      kind: null,
      label: 'Input activity',
      status: 'unavailable',
      hint: input.reason,
      needsRestart: false
    });
  } else if (state.platform === 'darwin' && input && input.supported && !input.pointer) {
    rows.push({
      kind: 'accessibility',
      label: 'Mouse clicks',
      status: 'not allowed',
      hint:
        'Allow FeedbackRecorder under Accessibility so clicks, double-clicks and right-clicks can be timestamped.',
      needsRestart: true
    });
  }
  if (state.platform === 'darwin' && input && input.supported && !input.keyboard && input.helper) {
    rows.push({
      kind: 'input',
      label: 'Keyboard activity',
      status: 'not allowed',
      hint:
        'Allow FeedbackRecorder under Input Monitoring. Shortcuts and navigation keys are saved; ordinary typing is only counted.',
      needsRestart: true
    });
  }

  const migration = state.migration && state.migration.changed ? state.migration : null;
  const migrationFailures =
    migration && Array.isArray(migration.failures) ? migration.failures : [];
  if (migration) {
    note(
      ui.permissionMigrationNote,
      migrationFailures.length
        ? `This update changed FeedbackRecorder's macOS identity, but ${migrationFailures.join(', ')} could not be removed automatically. Use the button below before allowing the app again.`
        : migration.stable
          ? 'This update changed FeedbackRecorder to a stable macOS identity. Old permission entries were removed; allow this version once and future signed updates keep those grants.'
          : 'This update changed FeedbackRecorder\'s macOS identity. Old permission entries were removed so System Settings shows only the current version.',
      migrationFailures.length ? 'warn' : ''
    );
    ui.permissionMigrationNote.hidden = false;
  } else {
    note(ui.permissionMigrationNote, '');
    ui.permissionMigrationNote.hidden = true;
  }

  ui.permissionPanel.hidden = rows.length === 0 && !migration;
  ui.permissionList.replaceChildren();

  let restartOffered = false;
  rows.forEach((row) => {
    const wrap = document.createElement('div');
    const status = document.createElement('div');
    status.className = 'status';
    status.innerHTML = `<span>${row.label}</span><span class="value bad">${row.status}</span>`;
    wrap.appendChild(status);

    if (row.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = row.hint;
      wrap.appendChild(hint);
    }

    if (state.platform === 'darwin' && row.kind) {
      const button = document.createElement('button');
      button.className = 'secondary wide';
      button.textContent = 'Open system settings';
      button.addEventListener('click', async () => {
        await api.openPermissionSettings(row.kind);
      });
      wrap.appendChild(button);

      // Screen Recording is only applied to a process that started after it was
      // allowed, so the app has to go away and come back. Saying that and then
      // leaving the user to do it by hand is asking them to do the computer's
      // job.
      if (row.needsRestart && !restartOffered) {
        restartOffered = true;
        const restart = document.createElement('button');
        restart.className = 'secondary wide';
        restart.textContent = 'Restart FeedbackRecorder';
        restart.addEventListener('click', () => api.restartApp());
        wrap.appendChild(restart);
      }
    }

    ui.permissionList.appendChild(wrap);
  });

  const canReset = state.platform === 'darwin' && (rows.length > 0 || migration);
  ui.permissionReset.hidden = !canReset;
  if (!canReset) note(ui.permissionResetNote, '');

  if (
    !rows.length &&
    migration &&
    !migration.createdThisLaunch &&
    migrationFailures.length === 0
  ) {
    await api.acknowledgePermissionMigration();
    ui.permissionReset.hidden = true;
    ui.permissionPanel.hidden = true;
  }

  return state;
}

async function refreshTranscriber() {
  const status = await api.transcriberStatus();
  ui.transcriberPanel.replaceChildren();

  const heading = document.createElement('h2');
  heading.textContent = 'Transcription';
  ui.transcriberPanel.appendChild(heading);

  const line = document.createElement('div');
  line.className = 'status';
  line.innerHTML = status.ready
    ? '<span>Runs on this machine</span><span class="value good">ready</span>'
    : '<span>Runs on this machine</span><span class="value warn">unavailable</span>';
  ui.transcriberPanel.appendChild(line);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = status.ready
    ? 'Your narration is transcribed locally and never uploaded.'
    : `${status.reason} Recording still works: the package will hold the video, the keyframes and the measured narration level, and will say the transcript is missing.`;
  if (status.ready && !status.swedishModel) {
    hint.textContent += ' The Swedish model is missing. Reinstall FeedbackRecorder or run npm run vendor in a development checkout to enable Swedish transcription.';
    hint.classList.add('warn');
  }
  ui.transcriberPanel.appendChild(hint);

  // Offered even when the transcriber is missing. The language is a stored
  // preference rather than a property of this run, and hiding it would leave a
  // repaired install quietly transcribing in the wrong language.
  buildLanguagePicker();
}

// The language has to be settled before recording, not after: it is what the
// transcriber is told, and getting it wrong produces confident nonsense rather
// than an error.
function buildLanguagePicker() {
  const label = document.createElement('label');
  label.className = 'field';
  label.htmlFor = 'language-select';
  label.textContent = 'Language you speak';
  ui.transcriberPanel.appendChild(label);

  const select = document.createElement('select');
  select.id = 'language-select';
  lib.languages.forEach((language) => {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    select.appendChild(option);
  });

  const current = lib.normalizeLanguage(session.settings && session.settings.language);
  select.value = current;
  ui.language = select;
  ui.transcriberPanel.appendChild(select);

  const note = document.createElement('p');
  note.className = 'hint';
  const describeChoice = (code) =>
    lib.isAutoLanguage(code)
      ? 'The language is detected locally, then KB-Whisper small is used for Swedish and Whisper for other languages. Naming the language is more reliable when you already know it.'
      : `Your narration is transcribed as ${lib.describeLanguage(code)} using ${code === 'sv' ? 'KB-Whisper small' : 'Whisper'}. This is remembered for next time.`;
  note.textContent = describeChoice(current);
  ui.transcriberPanel.appendChild(note);

  select.addEventListener('change', async () => {
    const chosen = lib.normalizeLanguage(select.value);
    note.textContent = describeChoice(chosen);
    session.settings = await api.saveSettings({ language: chosen });
  });
}

// The microphone panel owns its hint only when it has something of its own to
// say. A specific failure reported elsewhere ("the microphone is not
// available: …") is more useful than the general note, so it is never
// overwritten here.
function setMicAvailability(hasMic) {
  if (!hasMic) {
    if (ui.micHint.classList.contains('bad')) return;
    setMicHint(NO_MIC_HINT, 'warn');
    ui.micHint.dataset.owner = 'availability';
  } else if (ui.micHint.dataset.owner === 'availability') {
    setMicHint('');
    delete ui.micHint.dataset.owner;
  }
}

async function refreshMicrophones() {
  const devices = api.publicMode
    ? api.publicMicrophones
    : await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((device) => device.kind === 'audioinput');
  ui.micSelect.replaceChildren();

  if (!mics.length) {
    const option = document.createElement('option');
    option.textContent = 'No microphone found';
    option.value = '';
    ui.micSelect.appendChild(option);
    ui.micSelect.disabled = true;
    ui.micTest.disabled = true;
    setMicAvailability(false);
    return;
  }

  ui.micSelect.disabled = false;
  ui.micTest.disabled = false;
  setMicAvailability(true);
  mics.forEach((mic, index) => {
    const option = document.createElement('option');
    option.value = mic.deviceId;
    option.textContent = lib.deviceLabel(mic.label, `Microphone ${index + 1}`);
    // The full label, IDs and all, is still there for anyone telling two
    // identical headsets apart.
    if (mic.label) option.title = mic.label;
    ui.micSelect.appendChild(option);
  });

  const preferred = session.settings && session.settings.microphoneId;
  if (preferred && mics.some((mic) => mic.deviceId === preferred)) ui.micSelect.value = preferred;
}

// The preview for one card: a picture when the screen could be read, and a
// deliberate stand-in when it could not. Built here rather than inline so the
// live refresh can swap one for the other when a permission is granted while
// the app is open.
function buildPreview(display) {
  if (display.thumbnail) {
    const image = document.createElement('img');
    image.src = display.thumbnail;
    image.alt = display.name;
    return image;
  }

  // An <img> with no src is drawn by Chromium as a broken-image icon with
  // its alt text spelled out beside it, which reads as the app being broken
  // rather than as the permission signal it is — and repeats the label that
  // is already underneath. macOS returns no thumbnail at all until Screen
  // Recording is granted, so on a Mac this is the ordinary first-run case.
  const blank = document.createElement('div');
  blank.className = 'preview';
  blank.textContent = 'No preview';
  return blank;
}

// A blank preview means the screen could not be read, which has a different
// cause on each platform and is worth naming rather than showing an empty box.
function notePreviewState() {
  if (session.displays.some((display) => display.thumbnailBlank)) {
    note(
      ui.readyNote,
      session.platform === 'darwin'
        ? 'The screen previews are blank, which means macOS has not granted Screen Recording yet. Switch FeedbackRecorder on in System Settings, then use the restart button above — macOS only applies Screen Recording to an app that started after it was allowed.'
        : 'The screen previews are blank, so Windows refused to read the screen. This happens while the session is locked, in some remote desktop sessions, and on windows that block capture. Recording now would produce a black video.',
      'warn'
    );
  } else if (ui.readyNote.textContent) {
    note(ui.readyNote, '');
  }
}

function selectDisplay(id) {
  session.selectedDisplayId = id;
  Array.from(ui.displayList.querySelectorAll('.display')).forEach((child) => {
    const chosen = child.dataset.displayId === String(id);
    child.classList.toggle('selected', chosen);
    child.setAttribute('aria-pressed', String(chosen));
  });
  updateReadiness();
}

async function refreshDisplays() {
  session.displays = await api.listDisplays();
  ui.displayList.replaceChildren();

  // What is on screen wins over what was stored. Choosing a display and then
  // switching to another app used to put the selection back, because the refresh
  // on the way in read the saved setting — which a click does not write. With
  // the previews now refreshing on a timer, that would have snatched the
  // selection back every couple of seconds.
  const wanted = [session.selectedDisplayId, session.settings && session.settings.displayId].find(
    (id) => id && session.displays.some((item) => item.id === id)
  );
  session.selectedDisplayId = wanted || (session.displays[0] || {}).id || null;

  const kinds = new Set(session.displays.map((display) => display.kind || 'screen'));
  let lastKind = null;
  session.displays.forEach((display) => {
    const kind = display.kind || 'screen';
    if (kinds.size > 1 && kind !== lastKind) {
      const heading = document.createElement('div');
      heading.className = 'source-heading';
      heading.textContent = kind === 'window' ? 'Full-screen apps and windows' : 'Screens';
      ui.displayList.appendChild(heading);
      lastKind = kind;
    }

    const button = document.createElement('button');
    button.className = `display${display.id === session.selectedDisplayId ? ' selected' : ''}`;
    button.type = 'button';
    button.dataset.displayId = display.id;
    button.dataset.sourceKind = kind;
    // Selection was a border colour and nothing else, so it did not exist for
    // anybody not looking at it.
    button.setAttribute('aria-pressed', String(display.id === session.selectedDisplayId));

    button.appendChild(buildPreview(display));

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = display.name;
    button.appendChild(label);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = kind === 'window' ? 'App window' : display.resolution || '';
    button.appendChild(sub);

    button.addEventListener('click', () => selectDisplay(display.id));

    ui.displayList.appendChild(button);
  });

  notePreviewState();
}

// How often the previews are retaken. They were a photograph from whenever the
// window was last opened or focused, so the picker showed a screen as it had
// been minutes ago and there was no way to tell two similar monitors apart by
// what was on them — which is the whole reason the picker shows pictures.
const PREVIEW_REFRESH_MS = 2000;

// Retakes the previews without rebuilding the picker. A full refreshDisplays()
// every two seconds would throw away focus, hover and the pressed state mid
// interaction; this replaces image data and nothing else.
async function refreshPreviews() {
  if (session.previewBusy) return;
  if (el('state-ready').hidden || session.importing) return;
  // Only whether anybody can see the window, and deliberately not whether it has
  // focus. Gating on focus was a mistake that gave back exactly the behaviour
  // this replaced: no refresh while you were in another application, then one on
  // the way back, which is what the old code already did and what looked broken.
  //
  // It was justified by a cost that turned out not to exist. Reading three
  // screens takes about 180 ms of wall clock, which is what was measured, but
  // only 18 ms of CPU — the rest is waiting on the window server. At one refresh
  // every two seconds that is under 1% of one core, and it stops altogether the
  // moment the picker leaves the screen.
  //
  // document.hidden is trustworthy here: measured, it turns true when the window
  // is minimized and when the application is hidden, and false again on the way
  // back.
  if (document.hidden) return;

  session.previewBusy = true;
  try {
    const displays = await api.listDisplays();

    // A monitor plugged in or unplugged changes what the picker is offering, not
    // just what it looks like, so that is a rebuild.
    const sameScreens =
      displays.length === session.displays.length &&
      displays.every((display, index) => display.id === session.displays[index].id);
    if (!sameScreens) {
      await refreshDisplays();
      updateReadiness();
      return;
    }

    session.displays = displays;
    Array.from(ui.displayList.querySelectorAll('.display')).forEach((card) => {
      const display = displays.find((item) => String(item.id) === card.dataset.displayId);
      if (!display) return;

      const current = card.firstElementChild;
      const isImage = current && current.tagName === 'IMG';
      if (display.thumbnail && isImage) {
        current.src = display.thumbnail;
      } else if (Boolean(display.thumbnail) !== isImage) {
        // Screen Recording granted while the app was open, or revoked: the kind
        // of preview has changed, so the node has to.
        card.replaceChild(buildPreview(display), current);
      }
    });

    notePreviewState();
  } catch (error) {
    // A refusal or a transient failure is the picker keeping what it has, not a
    // reason to empty it. The next tick tries again.
  } finally {
    session.previewBusy = false;
  }
}

function startPreviewRefresh() {
  if (session.previewTimer) return;
  session.previewTimer = setInterval(refreshPreviews, PREVIEW_REFRESH_MS);
}

function stopPreviewRefresh() {
  if (!session.previewTimer) return;
  clearInterval(session.previewTimer);
  session.previewTimer = null;
}

// macOS puts a system prompt in front of the first getUserMedia and does not
// settle the promise until somebody answers it — measured still pending after
// 12 seconds with nobody there. Recording is not worth blocking on that: the app
// already knows how to record without narration and say so. Without a bound,
// pressing Record on a Mac that has never been asked about the microphone hangs
// on a disabled button with nothing on screen.
const MIC_WAIT_MS = 12000;

// How long a microphone may take to open before the wait is worth mentioning.
// Short enough that a real delay is explained quickly, long enough that the
// ordinary case — one that opens at once — never flashes a message about a
// delay that did not happen.
const SLOW_MIC_MS = 600;

// Waits for a microphone, but not forever. On timeout the request is left to
// settle on its own and whatever it opens is closed again, so an answer arriving
// late cannot leave the microphone live behind the app's back.
function waitForMicStream(request, timeoutMs) {
  if (!timeoutMs) return request.then((stream) => ({ stream }));

  let settled = false;
  const timedOut = new Promise((resolve) => {
    setTimeout(() => {
      if (settled) return;
      request.then(
        (late) => late.getTracks().forEach((track) => track.stop()),
        () => {}
      );
      resolve({ stream: null, timedOut: true });
    }, timeoutMs);
  });

  return Promise.race([
    request.then((stream) => {
      settled = true;
      return { stream };
    }),
    timedOut
  ]);
}

async function openMicStream(options) {
  stopMicStream();
  const deviceId = ui.micSelect.value;
  if (!deviceId) return null;

  const timeoutMs = options && 'timeoutMs' in options ? options.timeoutMs : MIC_WAIT_MS;

  let result;
  try {
    result = await waitForMicStream(
      navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      }),
      timeoutMs
    );
  } catch (error) {
    setMicHint(`The microphone could not be opened: ${error.message}`, 'bad');
    return null;
  }

  if (!result.stream) {
    setMicHint(
      session.platform === 'darwin'
        ? 'The microphone did not answer, which usually means a macOS permission prompt is waiting. Allow the microphone, or carry on without narration.'
        : 'The microphone did not answer in time, so it was left alone.',
      'warn'
    );
    return null;
  }

  session.micStream = result.stream;
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(session.micStream).connect(analyser);
  session.micAnalyser = { context, analyser, buffer: new Float32Array(analyser.fftSize) };
  return session.micStream;
}

function stopMicStream() {
  if (session.meterTimer) {
    clearInterval(session.meterTimer);
    session.meterTimer = null;
  }
  if (session.micAnalyser) {
    session.micAnalyser.context.close().catch(() => {});
    session.micAnalyser = null;
  }
  if (session.micStream) {
    session.micStream.getTracks().forEach((track) => track.stop());
    session.micStream = null;
  }
}

// Opening the microphone for a recording, with the wait explained if there is
// one. A disabled Record button and nothing else is the same failure as a bar
// that appears before the recording does: the app looks stuck, and on macOS the
// thing to do about it — answer the permission prompt — is exactly what the
// silence fails to mention.
async function openMicStreamForRecording(options) {
  let explained = false;
  const slow = setTimeout(() => {
    explained = true;
    note(
      ui.readyNote,
      session.platform === 'darwin'
        ? 'Waiting for the microphone. If macOS is asking permission, answer it — or wait, and the recording starts without narration.'
        : 'Waiting for the microphone…'
    );
  }, SLOW_MIC_MS);

  try {
    return await openMicStream(options);
  } finally {
    clearTimeout(slow);
    if (explained) note(ui.readyNote, '');
  }
}

function currentLevel() {
  if (!session.micAnalyser) return 0;
  const { analyser, buffer } = session.micAnalyser;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function paintMeter(node, level) {
  node.style.width = `${Math.round(lib.meterWidth(level) * 100)}%`;
  node.className = 'meter-fill';
  const tone = lib.meterTone(level);
  if (tone !== 'ok') node.classList.add(tone);
}

async function testMicrophone() {
  ui.micTest.disabled = true;
  ui.micTest.textContent = 'Listening…';
  // Up only while there is a level to show. A meter sitting at zero says the
  // microphone is silent, which is not the same thing as not being measured.
  ui.micMeterWrap.hidden = false;
  setMicHint('Speak normally. The bar should reach the marked band.');

  const stream = await openMicStream();
  if (!stream) {
    ui.micTest.disabled = false;
    ui.micTest.textContent = 'Test';
    ui.micMeterWrap.hidden = true;
    // openMicStream has already said why, so the standing instruction above
    // must not overwrite it.
    if (!ui.micHint.textContent || ui.micHint.textContent.startsWith('Speak normally')) {
      setMicHint('');
    }
    return;
  }

  let peak = 0;
  const started = Date.now();
  session.meterTimer = setInterval(() => {
    const level = currentLevel();
    if (level > peak) peak = level;
    paintMeter(ui.micMeter, level);

    if (Date.now() - started > 5000) {
      clearInterval(session.meterTimer);
      session.meterTimer = null;
      const verdict = lib.classifyNarration(lib.measureLevels(Float32Array.of(peak, peak)));
      // The verdict outlives the meter. Hiding the answer to a test somebody
      // just ran would leave them no better off for having run it.
      setMicHint(
        verdict.level === 'ok'
          ? `Heard you clearly. Only the microphone is recorded; system audio never is.`
          : `${verdict.summary} ${verdict.advice}`,
        verdict.level === 'ok' ? '' : 'warn'
      );
      ui.micTest.disabled = false;
      ui.micTest.textContent = 'Test';
      stopMicStream();
      paintMeter(ui.micMeter, 0);
      ui.micMeterWrap.hidden = true;
      session.micConfirmed = true;
      updateReadiness();
    }
  }, 60);
}

// A microphone is not a prerequisite. The app already records without one and
// says so on the recording screen, so requiring one here disabled the only
// button this window exists for — with nothing on screen saying why — on any
// machine whose microphone is missing, in use, or not permitted yet. A screen
// is the real requirement, because without one there is nothing to capture.
function updateReadiness() {
  const ready = Boolean(session.selectedDisplayId);
  ui.start.disabled = !ready;
  // Said on the button rather than after the fact, so choosing to record in
  // silence is deliberate rather than discovered at the end of a walkthrough.
  ui.start.textContent = ready && !ui.micSelect.value ? 'Record without narration' : 'Record';

  // A disabled primary action has to say what would enable it. refreshDisplays
  // owns this note otherwise, and its blank-preview warning is the more
  // specific answer whenever it has one.
  if (!ready && !ui.readyNote.textContent) {
    note(
      ui.readyNote,
      'No screen or app window was found to record, so there is nothing to capture.',
      'bad'
    );
  }
}

// What the picker shows is what the transcriber is told, rather than trusting
// that the saved setting and the visible selection have not drifted apart.
function currentLanguage() {
  if (ui.language) return lib.normalizeLanguage(ui.language.value);
  return lib.normalizeLanguage(session.settings && session.settings.language);
}

// ------------------------------------------------------------ Recording state

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// options is only ever passed by the end-to-end test, which uses it to force the
// microphone wait to time out on a machine whose microphone answers instantly.
// The no-narration path is otherwise unreachable there, and it is the one that
// has to be right: a recording that silently captures no sound is worse than one
// that refuses to start.
async function startRecording(options) {
  ui.start.disabled = true;
  const source = session.displays.find((item) => item.id === session.selectedDisplayId);

  // The microphone is asked for before anything on screen claims to be
  // recording. beginRecording puts the bar up and hides this window, and a bar
  // reads as "recording" the moment it appears — but the clock on it does not
  // start until the recorder does. Asking for the microphone after that meant a
  // macOS permission prompt could hold the two apart for as long as twelve
  // seconds, with somebody talking into a bar that was capturing nothing.
  const micStream = await openMicStreamForRecording(options);

  let begun;
  try {
    begun = await api.beginRecording({
      sourceId: session.selectedDisplayId,
      microphoneId: ui.micSelect.value
    });
  } catch (error) {
    stopMicStream();
    note(ui.readyNote, `Recording could not start: ${error.message}`, 'bad');
    ui.start.disabled = false;
    return;
  }

  session.run = begun;
  session.degraded = [];
  if (!micStream) {
    session.degraded.push('No microphone was captured, so this recording has no narration.');
  }
  if (begun.fellBack) {
    session.degraded.push(
      `The chosen display was gone when recording started, so ${begun.display.name} was recorded instead.`
    );
  }
  const wanted = source || begun.display;
  let displayStream;
  try {
    const video = { frameRate: { ideal: 30 } };
    if (wanted.captureWidth > 0 && wanted.captureHeight > 0) {
      video.width = { ideal: wanted.captureWidth };
      video.height = { ideal: wanted.captureHeight };
    }
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: false
    });
  } catch (error) {
    stopMicStream();
    await api.recordingFinished(begun.runId);
    // macOS refuses the capture outright rather than handing back a black one,
    // and Chromium reports that refusal as "Invalid capture constraints", which
    // names the wrong thing entirely. The missing permission is the cause worth
    // putting on screen, and a blank preview is how it is already known.
    const blocked =
      session.platform === 'darwin' &&
      wanted.kind !== 'window' &&
      wanted.thumbnailBlank;
    note(
      ui.readyNote,
      blocked
        ? 'macOS has not granted Screen Recording to FeedbackRecorder, so there is nothing to capture. Switch it on in System Settings, then restart the app with the button above.'
        : `The screen could not be captured: ${error.message}`,
      'bad'
    );
    ui.start.disabled = false;
    showState('ready');
    return;
  }

  const videoTrack = displayStream.getVideoTracks()[0];
  const actual = videoTrack.getSettings();
  session.run.display = Object.assign({}, wanted, {
    actualWidth: actual.width || wanted.captureWidth,
    actualHeight: actual.height || wanted.captureHeight
  });

  // Requesting the native size is not the same as getting it, and a downscaled
  // capture is what makes on-screen text in the keyframes unreadable.
  if (
    wanted.captureWidth > 0 &&
    actual.width &&
    actual.width < wanted.captureWidth * 0.95
  ) {
    session.degraded.push(
      `The screen was captured at ${actual.width}x${actual.height} instead of ${wanted.captureWidth}x${wanted.captureHeight}, so small text in the keyframes may be hard to read.`
    );
  }

  // Said while it is still worth knowing. The degraded list reports this at the
  // end too, but by then the walkthrough has been talked through: somebody who
  // narrates a whole review only to be told afterwards that none of it was heard
  // has lost the review, and the screen they were looking at the entire time was
  // saying their microphone was being recorded.
  ui.recordingHint.textContent = micStream
    ? 'The controls are in the bar on screen. Only your microphone is being recorded.'
    : 'The controls are in the bar on screen. No microphone is being recorded, so this walkthrough will have no narration — stop and allow the microphone if you meant to speak.';
  ui.recordingHint.classList.toggle('bad', !micStream);

  const tracks = [videoTrack].concat(micStream ? micStream.getAudioTracks() : []);
  const combined = new MediaStream(tracks);
  const pixels = (actual.width || 1920) * (actual.height || 1080);

  session.displayStream = displayStream;
  session.chunks = [];
  session.stopping = false;
  session.recorder = new MediaRecorder(combined, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: Math.min(16e6, Math.max(4e6, Math.round(pixels * 30 * 0.08))),
    audioBitsPerSecond: 128000
  });

  session.recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) session.chunks.push(event.data);
  };
  session.recorder.onstop = () => (session.discarding ? finishDiscard() : finishRecording());

  // A screen that disappears mid-recording ends the track. The review cannot be
  // performed again from memory, so what was captured is kept and processed.
  videoTrack.addEventListener('ended', () => {
    if (session.stopping) return;
    session.degraded.push('The recorded screen disappeared during the recording, so it stops early.');
    stopRecording();
  });

  session.startedAt = Date.now();
  session.recorder.start(2000);
  // Starts after MediaRecorder, then tells the helper how far into the video it
  // joined so its timestamps still line up. Starting it before the screen and
  // microphone are ready would put permission-prompt time at the front of the
  // event log.
  session.inputCapturePromise = api
    .startInputCapture(session.run.runId, {
      enabled: Boolean(session.settings && session.settings.captureInputActivity),
      offsetSeconds: (Date.now() - session.startedAt) / 1000,
      captureWidth: actual.width || 0,
      captureHeight: actual.height || 0
    })
    .catch((error) => ({
      supported: session.platform === 'darwin',
      enabled: true,
      pointer: false,
      keyboard: false,
      reason: error.message
    }));
  showState('recording');

  session.tickTimer = setInterval(() => {
    api.tick({
      elapsed: (Date.now() - session.startedAt) / 1000,
      level: currentLevel()
    });
  }, 100);
}

function stopRecording() {
  if (session.stopping) return;
  session.stopping = true;
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
  if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
}

// Throwing away what has been captured, for the walkthrough that went wrong in
// its first ten seconds. Before this the only way out of a recording was to
// finish it, which wrote a package that nothing in the app could then remove.
// The bar asks for confirmation in the main process; by the time this runs the
// answer was yes.
function discardRecording() {
  if (session.stopping) return;
  session.stopping = true;
  session.discarding = true;
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
  // A recorder that never started has no stop event to wait for.
  if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
  else finishDiscard();
}

async function finishDiscard() {
  if (session.displayStream) {
    session.displayStream.getTracks().forEach((track) => track.stop());
    session.displayStream = null;
  }
  stopMicStream();

  // Nothing captured is kept, and nothing is written on the way out.
  session.chunks = [];
  session.blob = null;
  session.degraded = [];

  const runId = session.run && session.run.runId;
  session.inputCapturePromise = null;
  session.run = null;
  session.completedRun = null;
  session.discarding = false;
  session.stopping = false;

  let problem = '';
  try {
    // Called even without a run id: the handler closes the bar and brings the
    // window back either way, and leaving the bar up over a recording that has
    // already stopped is the worse failure.
    await api.discardRecording(runId || '');
  } catch (error) {
    problem = `The recording was discarded, but its folder could not be removed: ${error.message}`;
  }

  showState('ready');
  await refreshDisplays();
  updateReadiness();

  // refreshDisplays owns this note and clears it, so the outcome goes on
  // afterwards — and only when nothing more important is already standing there.
  if (!ui.readyNote.textContent) {
    if (problem) note(ui.readyNote, problem, 'warn');
    else note(ui.readyNote, 'That recording was discarded. Nothing was saved.');
  }
}

async function finishRecording() {
  session.duration = (Date.now() - session.startedAt) / 1000;
  if (session.displayStream) {
    session.displayStream.getTracks().forEach((track) => track.stop());
    session.displayStream = null;
  }

  session.blob = new Blob(session.chunks, { type: session.chunks[0] ? session.chunks[0].type : 'video/webm' });
  session.chunks = [];

  // Stop it at the same boundary as the video. It writes the two event files
  // into the package and puts their summary on the run before the brief is made.
  if (session.inputCapturePromise) await session.inputCapturePromise;
  await api.stopInputCapture(session.run.runId);
  session.inputCapturePromise = null;

  await api.recordingFinished(session.run.runId);
  await api.saveVideo(session.run.runId, await session.blob.arrayBuffer());

  // Audio first, so transcription can run while the framing step waits on a
  // human. The crop only affects video, so the transcript is the same either way.
  await extractAudio();
  stopMicStream();

  await prepareFraming();
}

async function extractAudio() {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await session.blob.arrayBuffer());
    const channels = [];
    for (let i = 0; i < decoded.numberOfChannels; i += 1) channels.push(decoded.getChannelData(i));
    const mono = lib.mixToMono(channels);

    session.narration = lib.classifyNarration(lib.measureLevels(mono));
    await api.saveAudio(session.run.runId, lib.encodeWav(mono, 16000));

    // Silence is where Whisper invents text: two runs over the same quiet file
    // once produced entirely different transcripts. Audio this quiet is reported
    // as measured rather than handed to a transcriber that will guess.
    if (session.narration.level === 'ok') {
      session.transcriptPromise = api
        .transcribe(session.run.runId, { language: currentLanguage() })
        .catch((error) => ({
          available: false,
          segments: [],
          reason: error.message
        }));
    } else {
      session.transcriptPromise = Promise.resolve({
        available: false,
        segments: [],
        reason: session.narration.summary
      });
    }
  } catch (error) {
    // A video with no audio track lands here too, and the decoder's own wording
    // for that is unhelpful. Whatever the cause, the honest report is that
    // there was nothing to transcribe.
    session.narration = lib.classifyNarration(lib.measureLevels(new Float32Array(0)));
    session.degraded.push('No audio could be read from this video, so it has no narration to transcribe.');
    session.transcriptPromise = Promise.resolve({
      available: false,
      segments: [],
      reason: `No audio could be read from it (${error.message}).`
    });
  } finally {
    context.close().catch(() => {});
  }
}

// --------------------------------------------------------- Importing a video

// An existing recording joins the pipeline at the point a fresh one reaches
// when the user presses Stop: it has a package, its audio is measured and
// transcribed, and it is framed by hand. Everything after this is shared, so
// the two routes cannot drift apart.
async function importVideo(file) {
  if (!file || session.importing) return;

  note(ui.importNote, '');

  if (!lib.looksLikeVideo(file.name)) {
    note(
      ui.importNote,
      `${file.name} does not look like a video. Try one of: ${lib.videoExtensions.join(' ')}.`,
      'bad'
    );
    return;
  }

  session.importing = true;
  showState('importing');
  ui.importProgress.textContent = `Checking ${file.name}…`;

  const giveUp = (message) => {
    session.importing = false;
    session.run = null;
    showState('ready');
    note(ui.importNote, message, 'bad');
  };

  try {
    let size;
    try {
      size = await loadVideoSource(file);
    } catch (error) {
      return giveUp(
        `${file.name} could not be opened because ${error.message}. Most MP4 and WebM screen recordings work; a file using an unusual codec may need converting first.`
      );
    }

    if (!size.width || !size.height) {
      return giveUp(
        `${file.name} has no picture in it. An audio-only file has nothing to take keyframes from.`
      );
    }

    // Set before resolving, because the fallback inside resolveDuration is the
    // wall-clock length of a recording, which an imported file never has.
    session.duration = 0;
    const duration = await resolveDuration(ui.video);
    if (!Number.isFinite(duration) || duration <= 0) {
      return giveUp(
        `How long ${file.name} runs for could not be worked out, so its frames could not be timed.`
      );
    }

    ui.importProgress.textContent = 'Copying it into a package…';
    const begun = await api.beginImport({ name: file.name });

    session.run = begun;
    session.duration = duration;
    session.blob = file;
    session.degraded = [`This package was made from an existing video, ${file.name}, rather than recorded here.`];

    // Copying from disk keeps a multi-gigabyte file out of the renderer and off
    // the IPC channel. A File with no path behind it is rare enough to be worth
    // handling rather than refusing.
    const sourcePath = api.pathForFile(file);
    if (sourcePath) {
      await api.copyImportedVideo(begun.runId, sourcePath, begun.fileName);
    } else {
      await api.saveVideo(begun.runId, await file.arrayBuffer(), begun.fileName);
    }

    ui.importProgress.textContent = 'Reading the audio…';
    await extractAudio();

    session.importing = false;
    await prepareFraming();
  } catch (error) {
    giveUp(`${file.name} could not be imported: ${error.message}`);
  }
}

// ------------------------------------------------------------- Framing state

// One place that owns the object URL, so loading a different video does not
// leave the previous one held open for the life of the window.
function loadVideoSource(blob) {
  const video = ui.video;
  if (session.videoUrl) URL.revokeObjectURL(session.videoUrl);
  session.videoUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onLoaded = () => {
      cleanup();
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    const onError = () => {
      cleanup();
      reject(new Error('the format is one this app cannot play'));
    };
    // A file the decoder cannot make sense of sometimes neither loads nor
    // errors, and a spinner that never resolves is the worst of the outcomes.
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('it did not load within 30 seconds'));
    }, 30000);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = session.videoUrl;
  });
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve(video.currentTime);
    };
    const timer = setTimeout(done, 4000);
    video.addEventListener('seeked', done);
    try {
      video.currentTime = time;
    } catch (error) {
      done();
    }
  });
}

// WebM written by MediaRecorder carries no duration in its header, so the
// element reports Infinity until it has been seeked past the end.
async function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await seekTo(video, 1e6);
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return session.duration;
}

async function prepareFraming() {
  const video = ui.video;
  await loadVideoSource(session.blob);

  session.duration = await resolveDuration(video);
  session.frameSize = { width: video.videoWidth, height: video.videoHeight };
  session.region = null;

  ui.canvas.width = video.videoWidth;
  ui.canvas.height = video.videoHeight;
  ui.scrubber.value = '0';

  await seekTo(video, 0);
  drawFrame();
  updateFrameStatus();
  showState('framing');
}

function drawFrame() {
  const context = ui.canvas.getContext('2d');
  context.drawImage(ui.video, 0, 0, ui.canvas.width, ui.canvas.height);
}

function updateFrameStatus() {
  const at = lib.formatTimecode(ui.video.currentTime || 0);
  const total = lib.formatTimecode(session.duration);
  const area = lib.summarizeRegion(session.region, session.frameSize.width, session.frameSize.height);
  ui.frameStatus.textContent = `${at} of ${total} · ${area}`;
}

function paintSelection() {
  if (!session.region) {
    ui.selection.hidden = true;
    return;
  }
  const rect = ui.canvas.getBoundingClientRect();
  const wrap = ui.canvas.parentElement.getBoundingClientRect();
  const sx = rect.width / session.frameSize.width;
  const sy = rect.height / session.frameSize.height;

  ui.selection.hidden = false;
  ui.selection.style.left = `${rect.left - wrap.left + session.region.x * sx}px`;
  ui.selection.style.top = `${rect.top - wrap.top + session.region.y * sy}px`;
  ui.selection.style.width = `${session.region.width * sx}px`;
  ui.selection.style.height = `${session.region.height * sy}px`;
}

function installFramingHandlers() {
  let dragging = null;

  const pointFrom = (event) => {
    const rect = ui.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * session.frameSize.width,
      y: ((event.clientY - rect.top) / rect.height) * session.frameSize.height
    };
  };

  ui.canvas.addEventListener('pointerdown', (event) => {
    dragging = pointFrom(event);
    // Capture is a convenience, not a requirement: a pointer that is no longer
    // active throws here, and losing the drag is better than losing the handler.
    try {
      ui.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* the drag still tracks through pointermove */
    }
  });

  ui.canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const drag = lib.normalizeDrag(dragging, pointFrom(event));
    session.region = lib.clampRegion(drag, session.frameSize.width, session.frameSize.height);
    paintSelection();
    updateFrameStatus();
  });

  ui.canvas.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    const drag = lib.normalizeDrag(dragging, pointFrom(event));
    dragging = null;
    try {
      ui.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* nothing was captured */
    }

    // A click rather than a drag means "no rectangle", not a 1-pixel crop.
    if (drag.width < 24 || drag.height < 24) session.region = null;
    else session.region = lib.clampRegion(drag, session.frameSize.width, session.frameSize.height);

    paintSelection();
    updateFrameStatus();
  });

  ui.scrubber.addEventListener('input', async () => {
    const ratio = Number(ui.scrubber.value) / 1000;
    await seekTo(ui.video, ratio * session.duration);
    drawFrame();
    paintSelection();
    updateFrameStatus();
  });

  ui.frameReset.addEventListener('click', () => {
    session.region = null;
    paintSelection();
    updateFrameStatus();
  });

  ui.frameAccept.addEventListener('click', () => {
    processRecording().catch((error) => {
      if (error && error.cancelled) return;
      session.processing = null;
      addProgress(`Processing failed: ${error.message}`, 'bad');
      setProcessCancelable(true, 'Back to framing');
    });
  });

  document.addEventListener('keydown', (event) => {
    if (el('state-framing').hidden) return;
    if (event.key === 'Enter') ui.frameAccept.click();
    if (event.key === 'Escape') ui.frameReset.click();
  });
}

// ---------------------------------------------------------- Processing state

function addProgress(text, tone) {
  const item = document.createElement('li');
  item.textContent = text;
  if (tone) item.className = tone;
  ui.progress.appendChild(item);
  return item;
}

// One bar for the whole of processing, because the rows each count their own
// thing and none of them says how much is left overall. The shares are rough
// time weights: scanning is most of it, transcription is usually already done.
const PROCESS_SHARES = { scan: [0, 60], extract: [60, 85], transcribe: [85, 95], write: [95, 100] };

function setProcessProgress(phase, fraction) {
  const [from, to] = PROCESS_SHARES[phase];
  const value = Math.round(from + (to - from) * Math.max(0, Math.min(1, fraction)));
  ui.processFill.style.width = `${value}%`;
  ui.processMeter.setAttribute('aria-valuenow', String(value));
}

// The cancel button is only offered while nothing has been written: the last
// step replaces the package's keyframes and brief, and stopping half way through
// that would leave a package that disagrees with itself.
function setProcessCancelable(enabled, label) {
  ui.processCancel.disabled = !enabled;
  ui.processCancel.textContent = label || 'Cancel and go back to framing';
}

function cancelledError() {
  const error = new Error('Processing was cancelled.');
  error.cancelled = true;
  return error;
}

// Also the way out after a failure, when there is no job left to stop.
function cancelProcessing() {
  const job = session.processing;
  if (job && job.committed) return;
  setProcessCancelable(false, ui.processCancel.textContent);
  if (job) {
    job.cancelled = true;
    job.cancel();
  }
  session.processing = null;
  // The cancelled pass may be mid-seek on the shared <video>; framing seeks it
  // too, so it waits for that pass to notice and stop.
  Promise.resolve(session.processingSettled)
    .then(returnToFraming)
    .catch(() => {});
}

// The signature a keyframe decision is made from. It is taken from the framed
// region rather than the whole video: a change outside the frame is invisible
// in the picture that gets saved, so letting it ask for a keyframe produces two
// screenshots that look identical.
function signatureOf(video, work, region) {
  const context = work.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    work.width,
    work.height
  );
  const data = context.getImageData(0, 0, work.width, work.height).data;
  return lib.signatureFromRgba(data);
}

function canvasToBytes(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), 'image/png');
  });
}

async function processRecording() {
  // A cancelled pass may still be between two awaits on the shared <video>.
  // Seeking it from two passes at once would pair a time with the wrong frame.
  if (session.processingSettled) await session.processingSettled;

  let settle;
  session.processingSettled = new Promise((resolve) => {
    settle = resolve;
  });
  let cancel;
  const cancelled = new Promise((resolve) => {
    cancel = resolve;
  });
  const job = { cancelled: false, committed: false, cancel };
  session.processing = job;
  const check = () => {
    if (job.cancelled) throw cancelledError();
  };

  try {
    await runProcessing(job, check, cancelled);
  } finally {
    if (session.processing === job) session.processing = null;
    settle();
  }
}

async function runProcessing(job, check, cancelled) {
  showState('processing');
  ui.progress.replaceChildren();
  setProcessProgress('scan', 0);
  setProcessCancelable(true);

  const video = ui.video;
  const region = lib.clampRegion(session.region, session.frameSize.width, session.frameSize.height);
  const cropped = !lib.isWholeFrame(session.region, session.frameSize.width, session.frameSize.height);

  addProgress(
    `Framed to ${lib.summarizeRegion(session.region, session.frameSize.width, session.frameSize.height)}`
  );

  // Pass one: sample the recording and reduce each sample to a signature, so the
  // frames that end up in the package are the moments the screen changed.
  const scanning = addProgress('Looking for the frames that changed…', 'pending');
  const interval = lib.sampleIntervalSeconds(session.duration);
  const work = document.createElement('canvas');
  work.width = lib.signatureShape.width;
  work.height = lib.signatureShape.height;

  // A seek and a decode is about 40 ms, and a long recording is sampled 900
  // times, so this step can run for the better part of a minute. Without a
  // count moving on screen that is indistinguishable from a hung app.
  const total = Math.max(1, Math.ceil(session.duration / interval));
  const samples = [];
  for (let time = 0; time < session.duration; time += interval) {
    const actual = await seekTo(video, time);
    check();
    samples.push({ time: actual, signature: signatureOf(video, work, region) });
    scanning.textContent = `Looking for the frames that changed… ${Math.min(
      100,
      Math.round((samples.length / total) * 100)
    )}%`;
    setProcessProgress('scan', samples.length / total);
  }

  const chosen = lib.selectKeyframes(samples);
  const pictures = chosen.filter((item) => item.revisitOf === null);
  scanning.textContent = lib.summarizeKeyframes(chosen);
  scanning.className = '';

  // Pass two: render the chosen moments at full resolution, cropped. Cropping a
  // frame is free; cropping the video would mean re-encoding all of it for a
  // file no agent opens.
  const rendering = addProgress('Extracting keyframes…', 'pending');
  const out = document.createElement('canvas');
  out.width = region.width;
  out.height = region.height;
  const outContext = out.getContext('2d');

  // Held in memory until the end, so a cancelled pass leaves the package and
  // the previous Done screen exactly as they were.
  const frames = [];
  const frameUrls = [];
  try {
    for (const item of pictures) {
      await seekTo(video, item.time);
      check();
      outContext.drawImage(
        video,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height
      );
      const data = await canvasToBytes(out);
      check();
      frames.push({ time: item.time, score: item.score, data });
      frameUrls.push(URL.createObjectURL(new Blob([data], { type: 'image/png' })));
      rendering.textContent = `Extracting keyframes… ${frames.length} of ${pictures.length}`;
      setProcessProgress('extract', frames.length / Math.max(1, pictures.length));
    }

    rendering.textContent = `Extracted ${frames.length} keyframe${frames.length === 1 ? '' : 's'} at ${region.width} × ${region.height}.`;
    rendering.className = '';

    addProgress(session.narration ? session.narration.summary : 'Narration level was not measured.');

    // Transcription runs in the main process from the moment recording stopped,
    // and keeps running if this is cancelled, so going back and continuing
    // again picks up the same transcript rather than starting over.
    const waiting = addProgress('Transcribing your narration…', 'pending');
    setProcessProgress('transcribe', 0);
    const transcript = await Promise.race([session.transcriptPromise, cancelled]);
    check();
    if (transcript.available) {
      const count = transcript.segments.length;
      waiting.textContent = count
        ? `Transcribed ${count} segment${count === 1 ? '' : 's'}${transcript.language ? ` (${transcript.language})` : ''}.`
        : 'The transcriber ran but found no speech.';
      waiting.className = count ? '' : 'warn';
    } else {
      waiting.textContent = `No transcript: ${transcript.reason}`;
      waiting.className = 'warn';
      // The narration level is already reported on its own row and in the summary.
      // Repeating it as a separate warning says the same sentence three times.
      const alreadyStated = session.narration && transcript.reason === session.narration.summary;
      if (!alreadyStated) session.degraded.push(`Transcript missing: ${transcript.reason}`);
    }
    setProcessProgress('transcribe', 1);

    // From here the package is rewritten, so there is no stopping half way.
    job.committed = true;
    setProcessCancelable(false);
    const writing = addProgress('Writing the package…', 'pending');
    const written = await api.saveFrames(session.run.runId, frames);

    // A screen that came back has no picture of its own; it points at the one
    // already saved, so narration spoken over it still resolves to something.
    const revisits = chosen
      .filter((item) => item.revisitOf !== null && written[item.revisitOf])
      .map((item) => ({
        time: item.time,
        file: written[item.revisitOf].file,
        score: item.score
      }));

    const result = await api.finalize(session.run.runId, {
      durationSeconds: session.duration,
      frameSize: session.frameSize,
      region: cropped ? region : null,
      keyframes: written,
      revisits,
      narration: session.narration,
      transcript,
      display: session.run.display,
      degraded: Array.from(new Set(session.degraded))
    });
    writing.textContent = `Saved ${written.length} keyframe${written.length === 1 ? '' : 's'} and the brief.`;
    writing.className = '';
    setProcessProgress('write', 1);

    session.frameUrls.forEach((url) => URL.revokeObjectURL(url));
    session.frameUrls = frameUrls.splice(0);
    session.prompt = result.prompt;
    renderDone(result);
  } finally {
    // Whatever was not handed to the Done screen is let go.
    frameUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

// --------------------------------------------------------------- Done state

function renderPackageSummary(run) {
  const transcript = run.transcript || {};
  const segments = transcript.segments || [];
  const count = segments.filter((segment) => segment.text.trim()).length;
  const spokenIn =
    transcript.available && count && transcript.language
      ? ` in ${lib.describeLanguage(transcript.language)}${
          lib.isAutoLanguage(transcript.requestedLanguage) ? ' (detected)' : ''
        }`
      : '';
  const rows = [
    ['Length', lib.formatDuration(run.durationSeconds)],
    [
      'Source',
      run.source && run.source.kind === 'import'
        ? run.source.name
        : (run.display && run.display.name) || 'unknown'
    ],
    ['Framed to', lib.summarizeRegion(run.region, run.frameSize.width, run.frameSize.height)],
    [
      'Keyframes',
      (run.revisits || []).length
        ? `${run.keyframes.length}, revisited ${run.revisits.length} time${run.revisits.length === 1 ? '' : 's'}`
        : String(run.keyframes.length)
    ],
    [
      'Narration',
      transcript.available
        ? `${count} segment${count === 1 ? '' : 's'} ${transcript.edited ? 'corrected' : 'transcribed'}${spokenIn}`
        : 'not transcribed',
      transcript.available && count ? 'good' : 'warn'
    ],
    [
      'Input activity',
      run.source && run.source.kind === 'import'
        ? 'not applicable to an imported video'
        : run.input && run.input.available
          ? run.input.summary
          : 'not captured',
      run.source && run.source.kind === 'import'
        ? ''
        : run.input && run.input.available
          ? 'good'
          : 'warn'
    ]
  ];

  ui.summary.replaceChildren();
  rows.forEach(([term, value, tone]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (term === 'Narration' && transcript.available && segments.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'linkish';
      button.textContent = value;
      button.setAttribute('aria-label', `${value}. View and edit transcript`);
      button.setAttribute('aria-controls', 'transcript-editor');
      button.addEventListener('click', beginTranscriptEditing);
      dd.replaceChildren(button);
    }
    if (tone) dd.className = tone;
    ui.summary.append(dt, dd);
  });
  ui.handoverSummary.textContent = `${lib.formatTimecode(run.durationSeconds)} recording · ${plural(run.keyframes.length, 'screenshot')}`;
  const notes = run.notes || {};
  const comments = Array.isArray(notes.frames) ? notes.frames.length : 0;
  ui.reviewSummary.textContent = [
    String(notes.general || '').trim() ? 'Written instructions' : '',
    comments ? plural(comments, 'comment') : ''
  ].filter(Boolean).join(' · ') || 'Optional';
}

function renderDone(result) {
  session.exportOperation = null;
  ui.exportButton.textContent = 'Save ZIP copy…';
  const run = result.run;
  renderPackageSummary(run);
  ui.warnings.replaceChildren();
  const notes = [];
  if (run.narration && run.narration.level !== 'ok') {
    notes.push([run.narration.summary, run.narration.advice].filter(Boolean).join(' '));
  }

  (run.degraded || []).forEach((text) => notes.push(text));
  if (!(run.transcript && run.transcript.available) && !notes.length) {
    notes.push('No transcript is available. You can add written instructions under Review recording & add notes.');
  }
  notes.forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    ui.warnings.appendChild(item);
  });

  ui.packagePath.textContent = result.dir;
  // Folded away, so the line that stays visible says the two things people
  // check first.
  ui.packageGlance.textContent = `Package details · ${run.keyframes.length} keyframe${
    run.keyframes.length === 1 ? '' : 's'
  } · ${lib.formatTimecode(run.durationSeconds)}`;
  session.completedRun = run;
  if (session.handoverRunId !== session.run.runId) {
    session.handoverRunId = session.run.runId;
    setHandoverMode('local');
    ui.recordingReview.open = false;
    el('handover-more').open = false;
    document.querySelectorAll('.handover-options').forEach((details) => { details.open = false; });
  }
  ui.localPromptPreview.textContent = lib.buildLocalPrompt(session.run.dir);
  ui.attachmentPromptPreview.textContent = lib.buildAttachmentPrompt();
  ui.reframe.hidden = Boolean(session.reopened);
  beginPackageEditing(run);
  showState('done');
  describeExport();
  prepareDrag();
}

function beginPackageEditing(run) {
  const saved = (run && run.notes) || {};
  session.frameTimeline = lib.screenTimeline(run);
  session.notesDraft = {
    general: saved.general || '',
    frames: new Map(
      (Array.isArray(saved.frames) ? saved.frames : []).map((note) => {
        const frame = note.time === undefined
          ? session.frameTimeline.find((entry) => entry.file === note.file)
          : note;
        return [frame ? lib.occurrenceKey(frame) : '', note.text];
      })
    )
  };
  session.transcriptDraft = ((run.transcript && run.transcript.segments) || []).map((segment) => segment.text);
  session.transcriptDirty = false;
  session.editsRevision = 0;
  session.editsSavedRevision = 0;
  session.editsSaving = null;
  session.dragPreparation += 1;
  if (session.editsTimer) clearTimeout(session.editsTimer);
  session.editsTimer = null;
  session.keyframeIndex = 0;
  ui.generalNotes.value = session.notesDraft.general;
  note(ui.notesStatus, '');
  note(ui.transcriptStatus, '');
  ui.transcriptEditor.hidden = true;
  ui.transcriptPreview.hidden = false;
  ui.transcriptEdit.hidden = false;
  ui.transcriptReview.hidden = !(run.transcript && run.transcript.available && session.transcriptDraft.length);
  ui.transcriptEngine.textContent = (run.transcript && run.transcript.engine) || '';
  ui.transcriptEngine.hidden = !ui.transcriptEngine.textContent;
  renderTranscriptPreview();
  renderKeyframeReview();
}

function renderTranscriptPreview() {
  const segments = (session.completedRun && session.completedRun.transcript && session.completedRun.transcript.segments) || [];
  ui.transcriptPreview.replaceChildren();
  segments.forEach((segment) => {
    const line = document.createElement('p');
    const time = document.createElement('time');
    time.textContent = `[${lib.formatTimecode(segment.start)}] `;
    line.append(time, document.createTextNode(segment.text || '(Removed)'));
    ui.transcriptPreview.appendChild(line);
  });
}

function beginTranscriptEditing() {
  if (!session.transcriptDraft || !session.transcriptDraft.length) return;
  const segments = session.completedRun.transcript.segments;
  ui.transcriptFields.replaceChildren();
  session.transcriptDraft.forEach((text, index) => {
    const label = document.createElement('label');
    label.className = 'field';
    label.htmlFor = `transcript-segment-${index}`;
    label.textContent = `${lib.formatTimecode(segments[index].start)} - ${lib.formatTimecode(segments[index].end)}`;
    const input = document.createElement('textarea');
    input.id = label.htmlFor;
    input.className = 'note-field';
    input.rows = 3;
    input.value = text;
    input.addEventListener('input', () => {
      session.transcriptDraft[index] = input.value;
      session.transcriptDirty = true;
      renderFrameNarration();
      markEditsDirty();
    });
    input.addEventListener('change', () => saveEditsNow().catch(() => {}));
    ui.transcriptFields.append(label, input);
  });
  ui.transcriptPreview.hidden = true;
  ui.transcriptEditor.hidden = false;
  ui.transcriptEdit.hidden = true;
  ui.transcriptFields.querySelector('textarea').focus();
}

function renderKeyframeReview() {
  const frames = session.frameTimeline;
  ui.keyframeReview.hidden = frames.length === 0;
  if (!frames.length) return;

  session.keyframeIndex = Math.max(0, Math.min(frames.length - 1, session.keyframeIndex));
  const frame = frames[session.keyframeIndex];
  const imageIndex = session.completedRun.keyframes.findIndex((image) => image.file === frame.file);
  const url = session.frameUrls[imageIndex] || '';
  // A keyframe missing from a reopened package has no picture to show.
  if (url) ui.keyframeImage.src = url;
  else ui.keyframeImage.removeAttribute('src');
  ui.keyframeImage.alt = `Frame ${session.keyframeIndex + 1} at ${lib.formatTime(frame.time)}`;
  ui.keyframeSlider.max = String(frames.length - 1);
  ui.keyframeSlider.value = String(session.keyframeIndex);
  ui.keyframeSlider.setAttribute(
    'aria-valuetext',
    `Frame ${session.keyframeIndex + 1} of ${frames.length}, ${lib.formatTime(frame.time)}`
  );
  ui.keyframeSlider.disabled = frames.length < 2;
  ui.keyframePrevious.disabled = session.keyframeIndex === 0;
  ui.keyframeNext.disabled = session.keyframeIndex === frames.length - 1;
  const end = frames[session.keyframeIndex + 1]?.time ?? session.completedRun.durationSeconds;
  const reused = session.completedRun.keyframes[imageIndex]?.time !== frame.time;
  ui.keyframePosition.textContent =
    `Frame ${session.keyframeIndex + 1} of ${frames.length} · ${lib.formatTime(frame.time)} - ${lib.formatTime(end)}` +
    (reused ? ` · return to image ${imageIndex + 1}` : '');
  ui.keyframeComment.value = session.notesDraft.frames.get(lib.occurrenceKey(frame)) || '';
  ui.keyframeViewport.scrollTop = 0;
  ui.keyframeViewport.scrollLeft = 0;
  renderFrameNarration();
}

function renderFrameNarration() {
  const run = session.completedRun;
  if (!run) return;
  const segments = ((run.transcript && run.transcript.segments) || [])
    .map((segment, index) => ({ ...segment, text: session.transcriptDraft[index] }));
  const spoken = lib.correlateSegments(segments, run.keyframes, run.revisits)
    .filter((segment) => segment.frameOccurrences.some((frame) => frame.occurrence === session.keyframeIndex + 1));
  ui.frameNarration.replaceChildren();
  spoken.forEach((segment) => {
    const line = document.createElement('p');
    const span = segment.frameOccurrences.length > 1 ? ' (spans a screen change)' : '';
    line.textContent = `${lib.formatTime(segment.start)} - ${lib.formatTime(segment.end)}${span}: ${segment.text}`;
    ui.frameNarration.appendChild(line);
  });
  if (!spoken.length) {
    const line = document.createElement('p');
    line.className = 'hint';
    line.textContent = 'No transcribed speech during this frame.';
    ui.frameNarration.appendChild(line);
  }
}

function selectKeyframe(index) {
  session.keyframeIndex = Number(index) || 0;
  renderKeyframeReview();
}

function notesPayload() {
  const frames = session.frameTimeline;
  return {
    general: session.notesDraft ? session.notesDraft.general : '',
    frames: frames
      .map((frame) => ({
        file: frame.file, time: frame.time,
        text: session.notesDraft.frames.get(lib.occurrenceKey(frame)) || ''
      }))
      .filter((entry) => entry.text.trim())
  };
}

function showEditsStatus(text, tone) {
  note(ui.notesStatus, text, tone);
  note(ui.transcriptStatus, text, tone);
}

function markEditsDirty() {
  session.editsRevision += 1;
  session.dragPreparation += 1;
  session.dragReady = false;
  ui.dragFile.disabled = true;
  ui.dragName.textContent = 'Saving changes…';
  ui.dragSub.textContent = 'The ZIP will update after your changes are saved.';
  showEditsStatus('Saving package changes…');
  if (session.editsTimer) clearTimeout(session.editsTimer);
  session.editsTimer = setTimeout(() => {
    saveEditsNow().catch(() => {});
  }, 500);
}

async function saveEditsNow() {
  if (!session.completedRun || !session.notesDraft) return;
  if (session.editsTimer) clearTimeout(session.editsTimer);
  session.editsTimer = null;

  if (session.editsSaving) {
    await session.editsSaving;
    if (session.editsRevision > session.editsSavedRevision) return saveEditsNow();
    return;
  }
  if (session.editsRevision <= session.editsSavedRevision) return;

  const revision = session.editsRevision;
  const edits = { notes: notesPayload() };
  if (session.transcriptDirty) edits.transcriptTexts = session.transcriptDraft.slice();
  const saving = api.saveEdits(session.run.runId, edits);
  session.editsSaving = saving;
  showEditsStatus('Saving package changes…');

  try {
    const result = await saving;
    session.completedRun = result.run;
    session.prompt = result.prompt;
    session.transcriptPromise = Promise.resolve(result.run.transcript);
    session.editsSavedRevision = revision;
  } catch (error) {
    showEditsStatus(`Could not save the package changes: ${error.message}`, 'bad');
    throw error;
  } finally {
    if (session.editsSaving === saving) session.editsSaving = null;
  }

  if (session.editsRevision > session.editsSavedRevision) return saveEditsNow();

  session.transcriptDirty = false;
  renderPackageSummary(session.completedRun);
  renderTranscriptPreview();
  renderFrameNarration();
  showEditsStatus('Saved in this package.', 'good');
  prepareDrag();
}

async function saveEditsBefore(action) {
  try {
    await saveEditsNow();
    return true;
  } catch (error) {
    showEditsStatus(`Could not save before ${action}: ${error.message}`, 'bad');
    return false;
  }
}

async function returnToFraming() {
  if (!session.run || !session.blob || !session.videoUrl) return;
  ui.reframe.disabled = true;
  try {
    showState('framing');
    await seekTo(ui.video, Math.min(ui.video.currentTime || 0, session.duration));
    drawFrame();
    paintSelection();
    updateFrameStatus();
  } finally {
    ui.reframe.disabled = false;
  }
}

// --------------------------------------------------------------- Recordings
//
// Every finished package stays in the recordings folder. This screen lists
// them and opens one on the Done screen again, where its comments can be
// edited and it can be copied, dragged or saved as before. Its video is not
// loaded back, so its framing cannot be changed.

function currentState() {
  return STATES.find((state) => !el(`state-${state}`).hidden);
}

// What the Done screen holds for one package, let go so another can be shown
// or a new recording started.
function resetSession() {
  session.dragPreparation += 1;
  session.frameUrls.forEach((url) => url && URL.revokeObjectURL(url));
  session.frameUrls = [];
  if (session.videoUrl) URL.revokeObjectURL(session.videoUrl);
  session.videoUrl = null;
  ui.video.removeAttribute('src');
  session.run = null;
  session.completedRun = null;
  session.reopened = false;
  session.blob = null;
  session.prompt = '';
  session.exportPlan = null;
  session.exportOperation = null;
  ui.exportButton.textContent = 'Save ZIP copy…';
  ui.exportButton.disabled = false;
  session.handoverRunId = null;
  session.dragReady = false;
  session.notesDraft = null;
  session.transcriptDraft = null;
  session.transcriptDirty = false;
  session.editsRevision = 0;
  session.editsSavedRevision = 0;
  session.editsSaving = null;
  if (session.editsTimer) clearTimeout(session.editsTimer);
  session.editsTimer = null;
  note(ui.importNote, '');
  note(ui.exportNote, '');
}

function packageDate(item) {
  if (item.startedAt) {
    const started = new Date(item.startedAt);
    if (!Number.isNaN(started.getTime())) return started;
  }
  // The folder is named for the moment it was made, in local time.
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(item.id);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function describeWhen(item) {
  const date = packageDate(item);
  return date
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : item.id;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// The list wants a length that reads at a glance; the Done screen keeps the
// precise one.
function describeLength(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function describePackage(item) {
  if (item.status === 'unfinished') return ['Never finished — it can only be shown in its folder or deleted'];
  if (item.status === 'unreadable') return ['Its run.json cannot be read — it can only be shown in its folder or deleted'];
  const parts = [
    describeLength(item.durationSeconds),
    item.source.kind === 'import' ? `Imported ${item.source.name}` : item.source.name,
    plural(item.keyframeCount, 'keyframe')
  ];
  if (item.commentCount) parts.push(plural(item.commentCount, 'note'));
  if (item.degraded) parts.push(plural(item.degraded, 'warning'));
  return parts;
}

const historyThumbObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      historyThumbObserver.unobserve(entry.target);
      showHistoryThumb(entry.target);
    });
  },
  { rootMargin: '240px' }
);

// Fetched once per package and only when its row scrolls near the window, so
// a long list does not decode every recording's first keyframe up front.
async function showHistoryThumb(img) {
  const id = img.dataset.id;
  let url = session.historyThumbs.get(id);
  if (url === undefined) {
    session.historyThumbs.set(id, null);
    try {
      const thumb = await api.recordingThumbnail(id);
      url = thumb ? URL.createObjectURL(new Blob([thumb.data], { type: thumb.type })) : null;
    } catch (error) {
      url = null;
    }
    session.historyThumbs.set(id, url);
  }
  if (url && img.isConnected) {
    img.src = url;
    img.parentElement.classList.add('loaded');
  }
}

function forgetHistoryThumb(id) {
  const url = session.historyThumbs.get(id);
  if (url) URL.revokeObjectURL(url);
  session.historyThumbs.delete(id);
}

function historyRow(item) {
  const row = ui.historyRow.content.firstElementChild.cloneNode(true);
  const when = describeWhen(item);
  const usable = item.status === 'complete';
  const current = Boolean(session.run && session.run.runId === item.id && session.completedRun);
  row.dataset.id = item.id;
  row.dataset.status = item.status;
  row.classList.toggle('current', current);

  const title = row.querySelector('.history-title');
  title.textContent = when;
  if (current) {
    const badge = document.createElement('span');
    badge.className = 'history-badge';
    badge.textContent = 'Open now';
    title.append(badge);
  }
  row.querySelector('.history-meta').textContent = describePackage(item).join(' · ');
  const snippet = row.querySelector('.history-snippet');
  snippet.textContent = item.snippet || '';
  snippet.hidden = !item.snippet;

  const open = row.querySelector('.history-open');
  open.disabled = !usable;
  open.setAttribute('aria-label', usable ? `Open the recording from ${when}` : `Recording from ${when}, cannot be opened`);
  open.addEventListener('click', () => openFromHistory(item.id));

  const img = row.querySelector('.history-thumb img');
  img.dataset.id = item.id;
  if (usable) historyThumbObserver.observe(img);

  const reveal = row.querySelector('.history-reveal');
  reveal.title = 'Show in folder';
  reveal.setAttribute('aria-label', `Show the recording from ${when} in its folder`);
  reveal.addEventListener('click', () => api.revealRecording(item.id));

  const remove = row.querySelector('.history-delete');
  remove.title = 'Delete';
  remove.setAttribute('aria-label', `Delete the recording from ${when}`);
  remove.addEventListener('click', () => deleteFromHistory(item.id));
  return row;
}

function renderHistory() {
  const items = session.historyItems;
  const terms = ui.historySearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = terms.length
    ? items.filter((item) => {
        const haystack = `${item.searchText || ''} ${describeWhen(item)} ${item.id}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
    : items;

  ui.historyList.replaceChildren(...shown.map(historyRow));
  const total = items.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
  ui.historyCount.textContent = items.length
    ? `${plural(items.length, 'recording')} · ${lib.formatBytes(total)}`
    : '';
  ui.historySearch.hidden = !items.length;

  if (!items.length) {
    note(ui.historyStatus, 'No recordings yet. Every recording you finish is kept and listed here.');
  } else if (!shown.length) {
    note(ui.historyStatus, `Nothing matches “${ui.historySearch.value.trim()}”.`);
  } else {
    note(ui.historyStatus, '');
  }
}

async function loadHistory() {
  note(ui.historyStatus, 'Reading the recordings folder…');
  try {
    const listing = await api.listRecordings();
    session.historyItems = listing.items;
    renderHistory();
  } catch (error) {
    session.historyItems = [];
    renderHistory();
    note(ui.historyStatus, `The recordings folder could not be read: ${error.message}`, 'bad');
  }
}

async function openHistory() {
  const from = currentState();
  if (from === 'history') return closeHistory();
  if (!HISTORY_FROM.has(from)) return;
  if (from === 'done' && !(await saveEditsBefore('opening your recordings'))) return;
  session.historyReturn = from;
  ui.historySearch.value = '';
  showState('history');
  await loadHistory();
  if (!ui.historySearch.hidden) ui.historySearch.focus();
}

function closeHistory() {
  if (session.historyReturn === 'done' && session.completedRun) {
    showState('done');
    return;
  }
  showState('ready');
  refreshDisplays().then(updateReadiness);
}

async function openFromHistory(id) {
  if (session.historyBusy) return;
  // Already on the Done screen behind this one: going back is opening it.
  if (session.run && session.run.runId === id && session.completedRun) {
    showState('done');
    return;
  }

  session.historyBusy = true;
  note(ui.historyStatus, 'Opening the recording…');
  const urls = [];
  try {
    const opened = await api.openRecording(id);
    const frames = await api.recordingFrames(id);
    frames.forEach((bytes) => {
      urls.push(bytes ? URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) : '');
    });

    resetSession();
    session.run = { runId: opened.runId, dir: opened.dir };
    session.reopened = true;
    session.frameUrls = urls.splice(0);
    session.prompt = opened.prompt;
    session.historyReturn = 'done';
    note(ui.historyStatus, '');
    renderDone(opened);
  } catch (error) {
    note(ui.historyStatus, `That recording could not be opened: ${error.message}`, 'bad');
  } finally {
    urls.forEach((url) => url && URL.revokeObjectURL(url));
    session.historyBusy = false;
  }
}

async function deleteFromHistory(id) {
  if (session.historyBusy) return;
  session.historyBusy = true;
  try {
    const result = await api.deleteRecording(id);
    if (!result || !result.deleted) return;
    // The package behind the Done screen is gone, so there is nothing to go
    // back to but a new recording.
    if (session.run && session.run.runId === id) {
      resetSession();
      session.historyReturn = 'ready';
    }
    forgetHistoryThumb(id);
    session.historyItems = session.historyItems.filter((item) => item.id !== id);
    renderHistory();
    note(
      ui.historyStatus,
      `Moved to the ${session.platform === 'win32' ? 'Recycle Bin' : 'Trash'}.`,
      'good'
    );
  } catch (error) {
    note(ui.historyStatus, `That recording could not be deleted: ${error.message}`, 'bad');
  } finally {
    session.historyBusy = false;
  }
}

// The zip has to exist before the drag starts: a drag gesture cannot wait for a
// file to be written, so it is built as soon as the package is finished and the
// handle stays disabled until it is there.
async function prepareDrag() {
  const preparation = ++session.dragPreparation;
  const runId = session.run.runId;
  const options = exportOptions();
  const hasInput = Boolean(
    session.completedRun &&
      session.completedRun.input &&
      session.completedRun.input.available
  );
  const notes = session.completedRun && session.completedRun.notes;
  const hasNotes = Boolean(
    String((notes && notes.general) || '').trim() ||
      (Array.isArray(notes && notes.frames) && notes.frames.length)
  );
  const written = hasNotes ? ', written notes' : '';
  let contents = hasInput
    ? `The brief${written}, transcript, pictures and input timeline`
    : `The brief${written}, transcript and pictures`;
  if (options.includeVideo) contents += ', video';
  if (options.includeAudio) contents += ', original audio';
  ui.dragFile.disabled = true;
  ui.exportButton.disabled = true;
  ui.dragName.textContent = 'Preparing ZIP…';
  ui.dragSub.textContent = contents;
  session.dragReady = false;

  try {
    const file = await api.prepareDrag(runId, options);
    if (preparation !== session.dragPreparation || file.stale) return;
    session.dragReady = true;
    ui.dragFile.disabled = false;
    ui.dragName.textContent = file.name;
    ui.dragSub.textContent = `${lib.formatBytes(file.bytes)} · Ready to drag · ${contents.toLowerCase()}`;
  } catch (error) {
    if (preparation !== session.dragPreparation) return;
    ui.dragName.textContent = 'The ZIP could not be prepared';
    ui.dragSub.textContent = 'Choose Save ZIP copy… to try again.';
  } finally {
    if (preparation === session.dragPreparation && !session.exportOperation) ui.exportButton.disabled = false;
  }
}

function exportOptions() {
  return { includeVideo: ui.exportVideo.checked, includeAudio: ui.exportAudio.checked };
}

// The video and the audio are what make an export big, and the audio is the
// user's own voice, so both are opt-in and each says what it would add rather
// than leaving that to be found out from the resulting file.
async function describeExport() {
  const runId = session.run.runId;
  note(ui.exportNote, '');
  ui.exportButton.disabled = false;
  ui.exportVideo.checked = false;
  ui.exportAudio.checked = false;
  ui.exportVideo.disabled = true;
  ui.exportAudio.disabled = true;

  const describe = (input, label, bytes, present, wording, missing) => {
    if (present && bytes > 0) {
      input.disabled = false;
      label.textContent = `${wording} (${lib.formatBytes(bytes)})`;
    } else {
      // Nothing to include, so offering the choice would be a lie.
      input.disabled = true;
      label.textContent = missing;
    }
  };

  try {
    const plan = await api.exportPlan(runId);
    if (!session.run || session.run.runId !== runId) return;
    session.exportPlan = plan;

    describe(
      ui.exportVideo,
      ui.exportVideoLabel,
      plan.videoBytes,
      plan.videoFiles > 0,
      'Include the video',
      'There is no video in this package'
    );
    describe(
      ui.exportAudio,
      ui.exportAudioLabel,
      plan.audioBytes,
      plan.audioFiles > 0,
      'Include the audio recording',
      'There is no audio in this package'
    );
  } catch (error) {
    if (!session.run || session.run.runId !== runId) return;
    session.exportPlan = null;
    ui.exportVideoLabel.textContent = 'Include the video';
    ui.exportAudioLabel.textContent = 'Include the audio recording';
  }
}

function exportSizeHint() {
  const plan = session.exportPlan;
  if (!plan) return '';
  let bytes = plan.otherBytes;
  if (ui.exportVideo.checked) bytes += plan.videoBytes;
  if (ui.exportAudio.checked) bytes += plan.audioBytes;
  return ` about ${lib.formatBytes(bytes)} before compression`;
}

async function exportZip() {
  const run = session.run;
  if (!run || session.exportOperation) return;
  const operation = {};
  const options = exportOptions();
  session.exportOperation = operation;
  const isCurrent = () => session.run === run && session.exportOperation === operation;
  ui.exportButton.disabled = true;
  const wasLabel = ui.exportButton.textContent;
  ui.exportButton.textContent = 'Saving…';
  note(ui.exportNote, `Saving a ZIP copy${exportSizeHint()}…`);

  try {
    const result = await api.exportSave(run.runId, options);
    if (!isCurrent()) return;

    if (result.canceled) {
      note(ui.exportNote, '');
    } else {
      note(
        ui.exportNote,
        `Saved ${result.entries} file${result.entries === 1 ? '' : 's'} as ${lib.formatBytes(result.bytes)}: ${result.path}`,
        'good'
      );
      // Saving can recover a failed preparation. Refresh the handle from the
      // shared archive so it becomes draggable again after that retry.
      await prepareDrag();
    }
  } catch (error) {
    if (isCurrent()) note(ui.exportNote, `The zip could not be written: ${error.message}`, 'bad');
  } finally {
    if (isCurrent()) {
      session.exportOperation = null;
      ui.exportButton.textContent = wasLabel;
      ui.exportButton.disabled = false;
    }
  }
}

function setHandoverMode(mode) {
  const local = mode === 'local';
  ui.handoverLocal.setAttribute('aria-pressed', String(local));
  ui.handoverAttachment.setAttribute('aria-pressed', String(!local));
  el('handover-local-panel').hidden = !local;
  el('handover-attachment-panel').hidden = local;
}

async function copyHandover(button, label, text) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!(await saveEditsBefore('copying'))) return;
    await api.copy(text());
    button.textContent = 'Copied — paste it into your agent';
    setTimeout(() => { button.textContent = label; }, 2200);
  } catch (error) {
    note(ui.exportNote, `Could not copy: ${error.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

// -------------------------------------------------------------------- Wiring

ui.micSelect.addEventListener('change', () => {
  session.micConfirmed = false;
  updateReadiness();
});
ui.micTest.addEventListener('click', () => testMicrophone());
ui.start.addEventListener('click', () => startRecording());

ui.chooseVideo.addEventListener('click', () => ui.videoFile.click());
ui.videoFile.addEventListener('change', () => {
  const file = ui.videoFile.files && ui.videoFile.files[0];
  // Cleared so choosing the same file twice in a row still fires a change.
  ui.videoFile.value = '';
  importVideo(file);
});

// Dropping a file anywhere in a Chromium window makes it navigate to that file,
// which replaces the app with a video player and no way back. This has to be
// refused for the whole document, not only for the drop target.
function acceptsDrop() {
  return !el('state-ready').hidden && !session.importing;
}

['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
    if (name === 'drop' || name === 'dragleave') ui.dropzone.classList.remove('over');
    else if (acceptsDrop()) ui.dropzone.classList.add('over');
  });
});

document.addEventListener('drop', (event) => {
  if (!acceptsDrop()) return;
  const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
  if (!files.length) return;
  if (files.length > 1) {
    note(ui.importNote, `Only one video at a time — using ${files[0].name}.`, 'warn');
  }
  importVideo(files[0]);
});

ui.handoverLocal.addEventListener('click', () => setHandoverMode('local'));
ui.handoverAttachment.addEventListener('click', () => setHandoverMode('attachment'));
ui.copyPrompt.addEventListener('click', () => copyHandover(ui.copyPrompt, 'Copy local prompt', () => lib.buildLocalPrompt(session.run.dir)));
ui.copyAttachment.addEventListener('click', () => copyHandover(ui.copyAttachment, 'Copy instructions to send with it', () => lib.buildAttachmentPrompt()));
ui.copyFullBrief.addEventListener('click', () => copyHandover(ui.copyFullBrief, 'Copy full text brief', () => session.prompt));
ui.reveal.addEventListener('click', async () => {
  if (await saveEditsBefore('opening the folder')) api.reveal(session.run.dir);
});
ui.reframe.addEventListener('click', async () => {
  if (!(await saveEditsBefore('returning to framing'))) return;
  returnToFraming().catch((error) => note(ui.exportNote, error.message, 'bad'));
});
ui.processCancel.addEventListener('click', () => cancelProcessing());
// A finished step in the header goes back to it by pressing the button that
// already does that, so there is one path with one set of safeguards.
document.querySelectorAll('#steps .step').forEach((button) => {
  button.addEventListener('click', () => {
    const target = stepTarget(currentState(), button.parentElement.dataset.step);
    if (target) target.button().click();
  });
});
ui.exportButton.addEventListener('click', async () => {
  if (await saveEditsBefore('exporting')) exportZip();
});

ui.keyframePrevious.addEventListener('click', () => selectKeyframe(session.keyframeIndex - 1));
ui.keyframeNext.addEventListener('click', () => selectKeyframe(session.keyframeIndex + 1));
ui.keyframeSlider.addEventListener('input', () => selectKeyframe(ui.keyframeSlider.value));
ui.keyframeZoom.addEventListener('input', () => {
  const zoom = Number(ui.keyframeZoom.value);
  ui.keyframeViewport.style.setProperty('--frame-zoom', String(zoom / 100));
  ui.keyframeZoomValue.value = `${zoom}%`;
  ui.keyframeZoom.setAttribute('aria-valuetext', `${zoom}%`);
});
ui.keyframeComment.addEventListener('input', () => {
  const frames = session.frameTimeline;
  const frame = frames[session.keyframeIndex];
  if (!frame || !session.notesDraft) return;
  session.notesDraft.frames.set(lib.occurrenceKey(frame), ui.keyframeComment.value);
  markEditsDirty();
});
ui.keyframeComment.addEventListener('change', () => saveEditsNow().catch(() => {}));
ui.generalNotes.addEventListener('input', () => {
  if (!session.notesDraft) return;
  session.notesDraft.general = ui.generalNotes.value;
  markEditsDirty();
});
ui.generalNotes.addEventListener('change', () => saveEditsNow().catch(() => {}));
ui.transcriptEdit.addEventListener('click', beginTranscriptEditing);
ui.transcriptDone.addEventListener('click', async () => {
  if (!(await saveEditsBefore('closing the transcript editor'))) return;
  ui.transcriptEditor.hidden = true;
  ui.transcriptPreview.hidden = false;
  ui.transcriptEdit.hidden = false;
  ui.transcriptEdit.focus();
});
ui.keyframePreview.addEventListener('click', () => {
  if (!ui.keyframeImage.src) return;
  ui.keyframeDialogImage.src = ui.keyframeImage.src;
  ui.keyframeDialogImage.alt = ui.keyframeImage.alt;
  ui.keyframeDialogTitle.textContent = ui.keyframePosition.textContent;
  ui.keyframeDialog.showModal();
});
ui.keyframeDialogClose.addEventListener('click', () => ui.keyframeDialog.close());
ui.keyframeDialog.addEventListener('click', (event) => {
  if (event.target === ui.keyframeDialog) ui.keyframeDialog.close();
});

// The drag itself is handed to the operating system by the main process. The
// renderer supplies the recording ID and media selections, then gets out of the
// way because the default drag — a picture of the button — happens otherwise.
ui.dragFile.addEventListener('dragstart', (event) => {
  event.preventDefault();
  if (!session.dragReady) return;
  api.startDrag(session.run.runId, exportOptions());
});
// Not everyone drags. Clicking it saves the same file the ordinary way.
ui.dragFile.addEventListener('click', async () => {
  if (await saveEditsBefore('exporting')) exportZip();
});
async function changeExportContents() {
  note(ui.exportNote, '');
  const preparation = ++session.dragPreparation;
  session.dragReady = false;
  ui.dragFile.disabled = true;
  // Saving edits already schedules a fresh preparation. If there are none,
  // prepare now so dragging and saving both use these media selections.
  if (await saveEditsBefore('updating the ZIP') && preparation === session.dragPreparation) prepareDrag();
}
ui.exportVideo.addEventListener('change', changeExportContents);
ui.exportAudio.addEventListener('change', changeExportContents);
ui.again.addEventListener('click', async () => {
  if (!(await saveEditsBefore('starting another recording'))) return;
  resetSession();
  showState('ready');
  refreshDisplays().then(updateReadiness);
});

ui.openHistory.addEventListener('click', () => openHistory());
ui.historyBack.addEventListener('click', () => closeHistory());
ui.historyFolder.addEventListener('click', () => api.revealRecording(null));
ui.historySearch.addEventListener('input', () => renderHistory());
// Escape leaves the list the way it leaves a dialog, unless it is only
// clearing the search box.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || currentState() !== 'history') return;
  if (document.querySelector('dialog[open]')) return;
  if (event.target === ui.historySearch && ui.historySearch.value) return;
  closeHistory();
});

api.onStopRequested(() => stopRecording());
api.onDiscardRequested(() => discardRecording());
installFramingHandlers();

ui.checkUpdates.addEventListener('click', () => checkForUpdates(false));
ui.updateInstall.addEventListener('click', () => installUpdate());
ui.updatePage.addEventListener('click', () => api.openReleasesPage(session.updatePageUrl));
api.onUpdateProgress((fraction) => {
  ui.updateProgress.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
});

ui.permissionReset.addEventListener('click', async () => {
  ui.permissionReset.disabled = true;
  note(ui.permissionResetNote, 'Removing the old entries and restarting…');
  try {
    await api.resetPermissionsAndRestart();
  } catch (error) {
    ui.permissionReset.disabled = false;
    note(ui.permissionResetNote, `The old entries could not be removed: ${error.message}`, 'bad');
  }
});

ui.folderChange.addEventListener('click', () => changeFolder());
ui.folderDefault.addEventListener('click', () => useDefaultFolder());

// showModal rather than show, so the rest of the window is inert while it is up
// and Escape closes it without any of that being written here.
ui.openSettings.addEventListener('click', () => {
  if (!ui.settingsDialog.open) ui.settingsDialog.showModal();
});
ui.settingsClose.addEventListener('click', () => ui.settingsDialog.close());
// A click on the backdrop lands on the dialog itself, because the backdrop is
// not an element of its own. Anything inside it hits a child.
ui.settingsDialog.addEventListener('click', (event) => {
  if (event.target === ui.settingsDialog) ui.settingsDialog.close();
});

(async function boot() {
  await showVersion();
  session.settings = await api.loadSettings();

  // Painted before anything else is drawn, so a light-theme user does not watch
  // the app start dark and then change its mind.
  applyTheme(session.settings.theme);
  buildThemePicker();
  buildInputPicker();
  await refreshFolder();

  // Everything that can be drawn without an answer from the operating system is
  // drawn first. On a Mac that has never run this app, asking for a permission
  // puts a system prompt on screen and does not come back until somebody clicks
  // it — measured still pending after 15 seconds with nobody there. Building the
  // UI behind that await meant a first run showed an empty Ready screen: no
  // displays, no microphones, no transcription panel and no language picker,
  // for as long as the prompt stood.
  await refreshTranscriber();
  await refreshMicrophones();
  await refreshDisplays();
  await refreshPermissions();
  updateReadiness();
  // The Recordings button works before all of that has come back, so somebody
  // may already be looking at an earlier recording. That is not taken from them.
  if (currentState() === 'ready') showState('ready');

  // Granting a permission happens in another application, so the app has to
  // notice on the way back rather than showing what was true when it started.
  // Registered before anything can prompt, so it exists however that goes.
  window.addEventListener('focus', async () => {
    if (el('state-ready').hidden || session.importing) return;
    await refreshPermissions();
    await refreshMicrophones();
    await refreshDisplays();
    updateReadiness();
  });

  // Now the part that may sit on a system prompt. Deliberately not awaited by
  // anything above: the app is already usable, and this only adds to it.
  //
  // Asking is what puts the app in the Privacy & Security lists — macOS does not
  // list an app until it has actually asked — so this runs before the UI says
  // anything about permissions, rather than sending people to a pane where
  // FeedbackRecorder is not there to switch on.
  if (!api.publicMode) {
    (async function settlePermissions() {
      if (
        session.platform === 'darwin' &&
        session.settings.captureInputActivity &&
        !session.settings.inputPermissionsAsked
      ) {
        try {
          session.settings = await api.saveSettings({ inputPermissionsAsked: true });
          await api.requestInputPermissions();
        } catch (error) {
          // refreshPermissions below reports the state macOS actually kept.
        }
      }

      try {
        await api.primePermissions();
      } catch (error) {
        // describe() below reports whatever the real state turns out to be.
      }

      // Device labels stay empty until a capture has been permitted once, so this
      // asks for one. Bounded for the same reason as openMicStream: an unanswered
      // macOS prompt never settles, and everything below it is what tells the user
      // the microphone needs allowing — leaving it behind an unbounded await meant
      // the guidance appeared only once it was no longer needed.
      try {
        const probe = await waitForMicStream(
          navigator.mediaDevices.getUserMedia({ audio: true }),
          MIC_WAIT_MS
        );
        if (probe.stream) probe.stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        setMicHint(`The microphone is not available: ${error.message}`, 'bad');
      }

      await refreshPermissions();
      await refreshMicrophones();
      await refreshDisplays();
      updateReadiness();
    })();
  }

  // Checked once on start, quietly: a failed check is not something to open the
  // app with, and the button is there for anybody who wants to ask again.
  checkForUpdates(true);
})();
