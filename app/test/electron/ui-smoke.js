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

// "Is this a light colour?" from an rgb() string. A light theme is not proved by
// an attribute being set — it is proved by the pixels changing — and the exact
// values in the palette are free to be adjusted without breaking this.
function isLight(colour) {
  const parts = String(colour || '').match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return false;
  const [r, g, b] = parts.slice(0, 3).map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
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
  // Light on purpose: the dark palette is the stylesheet default, so a test run
  // against dark cannot tell "the theme was applied" from "nothing happened".
  ipcMain.handle('settings:load', () => ({
    microphoneId: '',
    displayId: '',
    language: 'sv',
    theme: 'light'
  }));
  ipcMain.handle('settings:save', (_event, patch) =>
    Object.assign({ microphoneId: '', displayId: '', language: 'sv', theme: 'light' }, patch || {})
  );
  ipcMain.handle('settings:folderState', () => ({
    dir: path.join('C:', 'Example', 'Recordings'),
    synced: false,
    isDefault: true
  }));
  ipcMain.handle('transcribe:status', () => whisper.locate(ROOT));
  ipcMain.handle('app:version', () => buildInfo.describe());

  // A release the app cannot already be running, so the update panel has
  // something real to render. Stubbed rather than fetched: a test that needs
  // GitHub to be reachable is a test that fails for reasons of its own.
  ipcMain.handle('updates:check', () => ({
    checked: true,
    available: true,
    installable: true,
    currentVersion: '0.2.0',
    version: '9.9.9',
    buildNumber: 999,
    pageUrl: 'https://example.invalid/releases',
    inPlace: true,
    asset: { name: 'FeedbackRecorder-Windows-x64-Setup.exe', url: 'https://example.invalid/f', size: 1 }
  }));

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
    // An <img> with no src is a broken-image icon on screen. Every card must
    // show either a real preview or the deliberate stand-in, never that.
    brokenPreviews: Array.from(document.querySelectorAll('#display-list img'))
      .filter((i) => !i.getAttribute('src')).length,
    previewCards: document.querySelectorAll('#display-list img[src], #display-list .preview').length,
    micOptions: document.getElementById('mic-select').options.length,
    transcriberText: document.getElementById('transcriber-panel').textContent.trim(),
    readyNote: document.getElementById('ready-note').textContent.trim(),
    languageOptions: (document.getElementById('language-select') || { options: [] }).options.length,
    languageValue: (document.getElementById('language-select') || {}).value || '',
    languageFirst: ((document.getElementById('language-select') || { options: [] }).options[0] || {}).value || '',
    versionText: document.getElementById('app-version').textContent.trim(),
    versionTitle: document.getElementById('app-version').title,
    updateVisible: !document.getElementById('update-panel').hidden,
    updateSummary: document.getElementById('update-summary').textContent.trim(),
    updateButton: document.getElementById('check-updates').textContent.trim(),
    updateAction: document.getElementById('update-install').textContent.trim(),
    updateNote: document.getElementById('update-note').textContent.trim(),
    bridgeFunctions: Object.keys(window.feedback).length,
    libFunctions: Object.keys(window.feedback.lib).length,

    themeAttribute: document.documentElement.dataset.theme || '',
    themeOptions: document.getElementById('theme-select').options.length,
    themeValue: document.getElementById('theme-select').value,
    // What was actually painted. The attribute only proves a string was
    // written; this proves the stylesheet answered it.
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    folderText: document.getElementById('folder-path').textContent.trim(),
    folderNote: document.getElementById('folder-note').textContent.trim()
  }))()`);

  console.log(JSON.stringify(state, null, 2));
  console.log('');

  check('the Ready state is the one on screen', state.readyVisible && state.otherStatesHidden);
  check('the display picker rendered a screen', state.displayCount > 0, `${state.displayCount} display(s)`);
  check('a display is preselected so Record is reachable', state.displaySelected === 1);
  // A preview that cannot be read must look deliberate. An <img> left without a
  // src draws Chromium's broken-image icon and spells the alt text out beside
  // it, which is what a Mac without Screen Recording used to show on every card.
  check(
    'every display card shows a preview or a deliberate stand-in, never a broken image',
    state.brokenPreviews === 0 && state.previewCards === state.displayCount,
    `${state.brokenPreviews} broken, ${state.previewCards} of ${state.displayCount} filled`
  );
  // A note that blames the wrong operating system is worse than no note at all.
  // This read "Windows refused to read the screen" on a Mac, because the platform
  // it words itself from was taken from a permission reply that had not arrived.
  const wrongPlatform =
    (process.platform === 'darwin' && /windows/i.test(state.readyNote)) ||
    (process.platform === 'win32' && /macos/i.test(state.readyNote));
  check(
    'a blank preview names this operating system rather than another one',
    !wrongPlatform,
    state.readyNote || '(previews were readable, so there is no note)'
  );
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
  check(
    'a newer release is offered, naming both versions',
    state.updateVisible && state.updateSummary.includes('9.9.9') && state.updateSummary.includes('0.2.0'),
    state.updateSummary
  );
  check(
    'the check-for-updates control reports what it found',
    /update available/i.test(state.updateButton),
    state.updateButton
  );
  check(
    'the update says what clicking it will do',
    /install/i.test(state.updateAction) && /close|reopen/i.test(state.updateNote),
    `${state.updateAction} — ${state.updateNote}`
  );
  check('no Content Security Policy or scripting errors', errors.length === 0, errors.join(' | '));

  // A light theme that sets an attribute but paints nothing is the failure this
  // is here to catch, so the assertion is on the colour, not the attribute.
  check(
    'the saved theme is the one painted',
    state.themeAttribute === 'light',
    `data-theme="${state.themeAttribute}" for a stored setting of "light"`
  );
  check(
    'the light theme actually repaints the window',
    isLight(state.bodyBackground) && !isLight(state.bodyColor),
    `background ${state.bodyBackground}, text ${state.bodyColor}`
  );
  check(
    'the appearance picker offers all three choices and shows the saved one',
    state.themeOptions === 3 && state.themeValue === 'light',
    `${state.themeOptions} option(s), showing "${state.themeValue}"`
  );
  check(
    'the save folder is on screen with an explanation',
    state.folderText.length > 0 && /recordings and exported zips/i.test(state.folderNote),
    `${state.folderText} — ${state.folderNote}`
  );

  // A permission probe is a probe, not a prerequisite. If asking macOS for
  // Screen Recording throws, the honest outcome is a UI that says so — not an
  // app that never finishes starting. This failed exactly that way once.
  //
  // The same goes for the update check: GitHub being unreachable, rate-limiting
  // this machine, or answering with nonsense must cost the user a button label,
  // never the app.
  ipcMain.removeHandler('permissions:prime');
  ipcMain.handle('permissions:prime', () => {
    throw new Error('simulated refusal');
  });
  ipcMain.removeHandler('updates:check');
  ipcMain.handle('updates:check', () => {
    throw new Error('simulated network failure');
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
  const quietUpdate = await second.webContents.executeJavaScript(
    "document.getElementById('update-panel').hidden"
  );
  check('a failed update check leaves no update on screen', quietUpdate);
  second.destroy();

  // The case above is the polite one. What a Mac actually does on a first run is
  // worse: askForMediaAccess puts a system prompt on screen and the promise does
  // not settle until a human clicks it — measured still pending after 15 s with
  // nobody there. A probe that throws is caught; a probe that never answers is
  // not, and it used to hold the entire Ready screen hostage behind it.
  ipcMain.removeHandler('permissions:prime');
  ipcMain.handle('permissions:prime', () => new Promise(() => {}));

  const third = new BrowserWindow({
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
  await third.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const unattended = await third.webContents.executeJavaScript(`(() => ({
    displays: document.getElementById('display-list').children.length,
    mics: document.getElementById('mic-select').options.length,
    languages: (document.getElementById('language-select') || { options: [] }).options.length
  }))()`);
  check(
    'a permission prompt nobody answers still leaves a usable Ready screen',
    unattended.displays > 0 && unattended.mics > 0 && unattended.languages > 5,
    `${unattended.displays} display(s), ${unattended.mics} microphone(s), ${unattended.languages} language(s)`
  );
  third.destroy();

  // A microphone is not a prerequisite for recording a screen, and the app
  // already knows how to record without one and say so. Requiring one here left
  // the only button the window exists for disabled, with nothing saying why, on
  // every machine whose microphone is missing, in use, or not permitted yet.
  const withoutMic = await window.webContents.executeJavaScript(`(() => {
    const select = document.getElementById('mic-select');
    const start = document.getElementById('start');
    const saved = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }));

    // Exactly what refreshMicrophones() leaves behind on a machine with none.
    select.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No microphone found';
    select.appendChild(none);
    select.dispatchEvent(new Event('change'));
    const result = { disabled: start.disabled, label: start.textContent.trim() };

    select.replaceChildren();
    saved.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.text;
      select.appendChild(option);
    });
    select.dispatchEvent(new Event('change'));
    result.restoredLabel = start.textContent.trim();
    result.restoredDisabled = start.disabled;
    return result;
  })()`);
  check(
    'a screen can still be recorded when there is no microphone',
    !withoutMic.disabled,
    withoutMic.disabled ? 'Record was disabled with no reason given' : 'Record stayed reachable'
  );
  check(
    'the button says the recording will have no narration, before it is made',
    /without narration/i.test(withoutMic.label),
    `"${withoutMic.label}"`
  );
  check(
    'the button goes back to plain Record once a microphone is there',
    withoutMic.restoredLabel === 'Record' && !withoutMic.restoredDisabled,
    `"${withoutMic.restoredLabel}"`
  );

  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);
  app.exit(checks.some((item) => !item.passed) ? 1 : 0);
});
