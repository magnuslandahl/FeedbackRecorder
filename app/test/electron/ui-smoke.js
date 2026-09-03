'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');

// Loads the real UI with the real preload and asks the DOM what happened. The
// absence of console errors is not evidence that a window rendered anything.

const ROOT = path.join(__dirname, '..', '..');
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

app.whenReady().then(async () => {
  // The app's own IPC lives in src/main/main.js next to window creation, so the
  // handlers the Ready state calls are stubbed here rather than imported.
  const displays = require(path.join(ROOT, 'src', 'main', 'displays.js'));
  const permissions = require(path.join(ROOT, 'src', 'main', 'permissions.js'));
  const whisper = require(path.join(ROOT, 'src', 'main', 'whisper.js'));
  const buildInfo = require(path.join(ROOT, 'src', 'main', 'build-info.js'));

  ipcMain.handle('displays:list', () => displays.listDisplays());
  ipcMain.handle('permissions:describe', () => permissions.describe());
  ipcMain.handle('permissions:prime', () => permissions.prime());
  ipcMain.handle('settings:load', () => ({ microphoneId: '', displayId: '', language: 'sv' }));
  ipcMain.handle('transcribe:status', () => whisper.locate(ROOT));
  ipcMain.handle('app:version', () => buildInfo.describe());

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    callback(sources[0] ? { video: sources[0] } : {});
  });

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const errors = [];
  window.webContents.on('console-message', (event) => {
    const message = (event && event.message) || '';
    if (/Content Security Policy|Uncaught|is not a function|undefined/i.test(message)) {
      errors.push(message);
    }
  });

  await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const state = await window.webContents.executeJavaScript(`(() => ({
    readyVisible: !document.getElementById('state-ready').hidden,
    otherStatesHidden: ['recording', 'framing', 'processing', 'done']
      .every((name) => document.getElementById('state-' + name).hidden),
    displayCount: document.getElementById('display-list').children.length,
    displaySelected: document.querySelectorAll('#display-list .display.selected').length,
    micOptions: document.getElementById('mic-select').options.length,
    transcriberText: document.getElementById('transcriber-panel').textContent.trim(),
    readyNote: document.getElementById('ready-note').textContent.trim(),
    languageOptions: (document.getElementById('language-select') || { options: [] }).options.length,
    languageValue: (document.getElementById('language-select') || {}).value || '',
    languageFirst: ((document.getElementById('language-select') || { options: [] }).options[0] || {}).value || '',
    versionText: document.getElementById('app-version').textContent.trim(),
    versionTitle: document.getElementById('app-version').title,
    bridgeFunctions: Object.keys(window.feedback).length,
    libFunctions: Object.keys(window.feedback.lib).length
  }))()`);

  console.log(JSON.stringify(state, null, 2));
  console.log('');

  check('the Ready state is the one on screen', state.readyVisible && state.otherStatesHidden);
  check('the display picker rendered a screen', state.displayCount > 0, `${state.displayCount} display(s)`);
  check('a display is preselected so Record is reachable', state.displaySelected === 1);
  check('the microphone picker rendered', state.micOptions > 0, `${state.micOptions} option(s)`);
  check(
    'the transcriber panel states whether transcription is available',
    /ready|unavailable/i.test(state.transcriberText)
  );
  check(
    'the language picker offers a choice, with auto first',
    state.languageOptions > 5 && state.languageFirst === 'auto',
    `${state.languageOptions} language(s), first is "${state.languageFirst}"`
  );
  check(
    'the saved language is the one selected',
    state.languageValue === 'sv',
    `selected "${state.languageValue}" for a stored setting of "sv"`
  );
  check(
    'the running version is on screen',
    /^\d+\.\d+\.\d+/.test(state.versionText),
    state.versionText
  );
  check(
    'hovering the version gives the full build',
    state.versionTitle.includes(state.versionText),
    state.versionTitle
  );
  check('the preload bridge is exposed', state.bridgeFunctions > 15 && state.libFunctions > 10);
  check('no Content Security Policy or scripting errors', errors.length === 0, errors.join(' | '));

  // A permission probe is a probe, not a prerequisite. If asking macOS for
  // Screen Recording throws, the honest outcome is a UI that says so — not an
  // app that never finishes starting. This failed exactly that way once.
  ipcMain.removeHandler('permissions:prime');
  ipcMain.handle('permissions:prime', () => {
    throw new Error('simulated refusal');
  });

  const second = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  await second.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const survived = await second.webContents.executeJavaScript(
    "!document.getElementById('state-ready').hidden && document.getElementById('display-list').children.length > 0"
  );
  check('the app still starts when a permission probe fails', survived);
  second.destroy();

  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);
  app.exit(checks.some((item) => !item.passed) ? 1 : 0);
});
