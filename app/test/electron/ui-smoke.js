'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, desktopCapturer, globalShortcut } = require('electron');

// Loads the real UI with the real preload and asks the DOM what happened. The
// absence of console errors is not evidence that a window rendered anything.

const ROOT = path.join(__dirname, '..', '..');
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function report(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);
  app.exit(checks.some((item) => !item.passed) ? 1 : code);
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
  // Anything that throws or rejects in here would otherwise leave the process
  // sitting with no windows to close and no output to read — a run that has to
  // be killed rather than one that failed. Cost an evening once; now it reports.
  const failsafe = setTimeout(() => {
    check('the run completed inside the time limit', false, '180s');
    report(1);
  }, 180000);

  process.on('unhandledRejection', (error) => {
    clearTimeout(failsafe);
    check('no promise was left rejected', false, error && error.message);
    report(1);
  });

  // The app's own IPC lives in src/main/main.js next to window creation, so the
  // handlers the Ready state calls are stubbed here rather than imported.
  const displays = require(path.join(ROOT, 'src', 'main', 'displays.js'));
  const permissions = require(path.join(ROOT, 'src', 'main', 'permissions.js'));
  const whisper = require(path.join(ROOT, 'src', 'main', 'whisper.js'));
  const buildInfo = require(path.join(ROOT, 'src', 'main', 'build-info.js'));
  const shortcuts = require(path.join(ROOT, 'src', 'shared', 'shortcuts.js'));

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

  // The real answer rather than a fixture: whether the combination can be taken
  // on this machine is exactly what the check downstream is about.
  ipcMain.handle('shortcuts:stop', () => shortcuts.stopState(globalShortcut, process.platform));

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
    folderNote: document.getElementById('folder-note').textContent.trim(),

    // Settings moved behind a gear, so what used to be part of the first screen
    // must now be reachable rather than gone.
    settingsOpen: document.getElementById('settings-dialog').open,
    settingsHolds: ['theme-select', 'language-select', 'folder-path'].filter((id) => {
      const node = document.getElementById(id);
      return node && document.getElementById('settings-dialog').contains(node);
    }).length,

    // The microphone panel is silent at rest: one row, no meter, no standing
    // instruction. It was four stacked rows above the two choices that matter.
    micRowInline: getComputedStyle(document.getElementById('mic-select').parentElement).display,
    micMeterHidden: document.getElementById('mic-meter-wrap').hidden,
    micHintHidden: document.getElementById('mic-hint').hidden,

    // Record belongs to the screen it records, and importing to the video card.
    startInsideScreenCard: document
      .getElementById('display-list')
      .closest('.panel')
      .contains(document.getElementById('start')),
    choices: document.querySelectorAll('#state-ready .panel.choice').length,
    dividerText: (document.querySelector('#state-ready .or') || {}).textContent || '',

    // The line introducing the screens used to sit directly on top of the first
    // card with nothing between them.
    hintGap: parseFloat(
      getComputedStyle(document.querySelector('#state-ready .hint.spaced')).marginBottom
    )
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

  // The first screen is what somebody uses every time; appearance, language and
  // the save folder are set once. Moving them behind a gear is only an
  // improvement if they are all still there to be found.
  check(
    'settings are behind the gear rather than on the first screen',
    !state.settingsOpen && state.settingsHolds === 3,
    `${state.settingsHolds}/3 settings inside the dialog, open=${state.settingsOpen}`
  );
  check(
    'the microphone is one row, with no meter or standing instruction at rest',
    state.micRowInline === 'flex' && state.micMeterHidden && state.micHintHidden,
    `row=${state.micRowInline}, meter hidden=${state.micMeterHidden}, hint hidden=${state.micHintHidden}`
  );
  check(
    'recording a screen and importing a video read as two choices',
    state.choices === 2 && /or/i.test(state.dividerText) && state.startInsideScreenCard,
    `${state.choices} choice(s), divider "${state.dividerText.trim()}", Record in the screen card: ${state.startInsideScreenCard}`
  );
  check(
    'the line above the screens is not touching the first one',
    state.hintGap >= 8,
    `${state.hintGap}px`
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
  //
  // Driven from synthetic options rather than from whatever this machine has:
  // a CI runner reports one audioinput with an empty deviceId, which is the
  // no-microphone case, so the real device list cannot demonstrate both states.
  const mic = await window.webContents.executeJavaScript(`(() => {
    const select = document.getElementById('mic-select');
    const start = document.getElementById('start');
    const saved = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }));
    const savedValue = select.value;

    const put = (options) => {
      select.replaceChildren();
      options.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.text;
        select.appendChild(option);
      });
      select.dispatchEvent(new Event('change'));
    };

    // A microphone the app could actually open: openMicStream needs a device id
    // and returns null without one, so this is the same test it makes.
    put([{ value: 'a-real-device-id', text: 'Some microphone' }]);
    const withMic = { disabled: start.disabled, label: start.textContent.trim() };

    // Exactly what refreshMicrophones() leaves behind on a machine with none.
    put([{ value: '', text: 'No microphone found' }]);
    const withoutMic = { disabled: start.disabled, label: start.textContent.trim() };

    put(saved);
    select.value = savedValue;
    select.dispatchEvent(new Event('change'));
    return { withMic, withoutMic };
  })()`);
  check(
    'a screen can still be recorded when there is no microphone',
    !mic.withoutMic.disabled,
    mic.withoutMic.disabled ? 'Record was disabled with no reason given' : 'Record stayed reachable'
  );
  check(
    'the button says the recording will have no narration, before it is made',
    /without narration/i.test(mic.withoutMic.label),
    `"${mic.withoutMic.label}"`
  );
  check(
    'the button is plain Record when there is a microphone to open',
    mic.withMic.label === 'Record' && !mic.withMic.disabled,
    `"${mic.withMic.label}"`
  );

  // ------------------------------------------------------------ accessibility

  // The bar is the only control while a recording runs, and it can end up on a
  // screen nobody is looking at. Set-up is the last moment the way back to it
  // can be read, because by then the main window is hidden.
  //
  // Asserted as an invariant rather than as a fixed string: whether the
  // combination can be taken depends on what else is running, and a headless
  // runner is exactly the machine where it might not be. What must always hold
  // is that the app promises it only when it can keep the promise.
  const shortcut = await window.webContents.executeJavaScript(`(async () => {
    const stop = await window.feedback.stopShortcut();
    return {
      accelerator: stop.accelerator,
      label: stop.label,
      available: stop.available,
      hint: document.getElementById('stop-shortcut').textContent.trim()
    };
  })()`);
  check(
    'the way to stop from anywhere is named on set-up exactly when it can be had',
    shortcut.available ? shortcut.hint.includes(shortcut.label) : shortcut.hint === '',
    shortcut.available
      ? `available, hint reads "${shortcut.hint}"`
      : `not available on this machine, and nothing was promised (hint "${shortcut.hint}")`
  );
  check(
    'it takes enough modifiers not to steal a key from the app being reviewed',
    shortcut.accelerator.split('+').length >= 4,
    shortcut.accelerator
  );

  // Measured from what the stylesheet actually paints, in both palettes, rather
  // than asserted against a colour value somebody could change and re-assert.
  // The dark palette's error text was 4.43:1 against its panel, just under AA
  // for the 12px it is used at.
  const contrast = await window.webContents.executeJavaScript(`(() => {
    const parse = (value) => value.match(/[0-9.]+/g).slice(0, 3).map(Number);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a, b) => {
      const l1 = lum(a); const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const panel = document.querySelector('#state-ready .panel');
    const probe = document.createElement('p');
    probe.className = 'hint bad';
    probe.textContent = 'probe';
    panel.appendChild(probe);

    const saved = document.documentElement.dataset.theme;
    const out = {};
    ['dark', 'light'].forEach((theme) => {
      document.documentElement.dataset.theme = theme;
      const value = ratio(parse(getComputedStyle(probe).color), parse(getComputedStyle(panel).backgroundColor));
      out[theme] = Math.round(value * 100) / 100;
    });
    document.documentElement.dataset.theme = saved;
    probe.remove();
    return out;
  })()`);
  check(
    'error text clears AA against its panel in both palettes',
    contrast.dark >= 4.5 && contrast.light >= 4.5,
    `dark ${contrast.dark}:1, light ${contrast.light}:1`
  );

  const focusRules = await window.webContents.executeJavaScript(`(() => {
    const found = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (error) { continue; }
      for (const rule of rules) {
        if (rule.selectorText && rule.selectorText.includes(':focus-visible')) {
          found.push({ selector: rule.selectorText, outline: rule.style.outline });
        }
      }
    }
    return found;
  })()`);
  check(
    'keyboard focus is given a visible ring of its own',
    focusRules.some((rule) => rule.outline && rule.outline !== 'none'),
    focusRules.length ? focusRules.map((r) => r.selector).join(' / ') : '(no :focus-visible rule at all)'
  );

  const aria = await window.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('#display-list .display'));
    return {
      cardsWithState: cards.filter((c) => c.hasAttribute('aria-pressed')).length,
      cardCount: cards.length,
      pressed: cards.filter((c) => c.getAttribute('aria-pressed') === 'true').length,
      // The tick beside the selected card's name, so selection is not carried
      // by a border colour alone.
      tick: cards.length
        ? getComputedStyle(cards.find((c) => c.classList.contains('selected')).querySelector('.label'), '::before').content
        : '',
      currentStep: (document.querySelector('#steps li[aria-current="step"]') || {}).textContent || '',
      announced: document.getElementById('state-announcer').textContent,
      liveRegions: document.querySelectorAll('[aria-live]').length
    };
  })()`);
  check(
    'the selected screen is exposed, not only coloured',
    aria.cardsWithState === aria.cardCount && aria.pressed === 1,
    `${aria.cardsWithState}/${aria.cardCount} carry aria-pressed, ${aria.pressed} selected`
  );
  check(
    'selection is also marked without relying on colour',
    aria.tick.includes('✓'),
    `label prefix ${aria.tick}`
  );
  check(
    'the step being worked on is named, not just drawn',
    aria.currentStep === 'Set up',
    `aria-current is on "${aria.currentStep}"`
  );
  check(
    'moving between states is announced',
    aria.announced.length > 0 && aria.liveRegions >= 3,
    `"${aria.announced}", ${aria.liveRegions} live region(s)`
  );

  // prefers-reduced-motion cannot be set from the page, so it is emulated the
  // way the browser would report it.
  await window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  const motion = await window.webContents.executeJavaScript(`(() => {
    const pulse = document.querySelector('#state-recording .pulse');
    const item = document.createElement('li');
    item.className = 'pending';
    document.getElementById('progress').appendChild(item);
    const spinner = getComputedStyle(item, '::before');
    const result = {
      honoured: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      pulse: getComputedStyle(pulse).animationName,
      spinner: spinner.animationName,
      // A ring that has stopped turning says nothing, so the pending step is
      // marked with a glyph instead.
      marker: spinner.content
    };
    item.remove();
    return result;
  })()`);
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.webContents.debugger.detach();

  check(
    'the recording pulse stops when the system asks for less motion',
    motion.honoured && motion.pulse === 'none',
    `animation-name: ${motion.pulse}`
  );
  check(
    'the spinner is replaced rather than left frozen mid-rotation',
    motion.spinner === 'none' && motion.marker.includes('…'),
    `animation-name: ${motion.spinner}, marker ${motion.marker}`
  );

  // The previews were a photograph from whenever the window was last opened or
  // focused. A picker that shows pictures so two similar monitors can be told
  // apart by what is on them is no use showing what was on them ten minutes
  // ago — and the only way to refresh it was to leave the app and come back.
  //
  // Driven from a stub rather than the real screen: a test window that is never
  // shown looks at a desktop which may not change at all, so real thumbnails
  // could be identical for reasons that have nothing to do with this.
  let tick = 0;
  const stubScreen = (id, name) => ({
    id,
    sourceId: `screen:${id}`,
    name,
    resolution: '1920 × 1080',
    isPrimary: id === 'stub-1',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    captureWidth: 1920,
    captureHeight: 1080,
    // Different bytes every time it is asked, which is what a live screen is.
    thumbnail: `data:image/svg+xml;base64,${Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20"><rect width="32" height="20" fill="#${(
        (tick * 40) % 900 + 100
      ).toString().padStart(3, '0')}"/></svg>`
    ).toString('base64')}`,
    thumbnailBlank: false
  });

  ipcMain.removeHandler('displays:list');
  ipcMain.handle('displays:list', () => {
    tick += 1;
    return [stubScreen('stub-1', 'Stub one'), stubScreen('stub-2', 'Stub two')];
  });

  const live = new BrowserWindow({
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
  await live.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  // These windows are never shown, so the page is told it has focus the way the
  // browser would report it. The refresh is deliberately gated on focus —
  // reading three screens costs about 170 ms, and a picker nobody is looking at
  // is not worth that every two seconds — which without this would make the
  // behaviour under test never run at all.
  await live.webContents.debugger.attach('1.3');
  await live.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Pick the screen that is not the default, and mark the card, so a rebuild
  // can be told apart from a repaint: an attribute set here does not survive
  // one and the chosen screen does not stay chosen through one either.
  const before = await live.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('#display-list .display'));
    cards[1].click();
    cards.forEach((card, i) => { card.dataset.probe = 'card-' + i; });
    return {
      cards: cards.length,
      src: cards[0].querySelector('img').getAttribute('src'),
      selected: (document.querySelector('#display-list .display.selected') || {}).dataset.displayId
    };
  })()`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const after = await live.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('#display-list .display'));
    return {
      src: cards[0].querySelector('img').getAttribute('src'),
      kept: cards.every((card, i) => card.dataset.probe === 'card-' + i),
      selected: (document.querySelector('#display-list .display.selected') || {}).dataset.displayId
    };
  })()`);

  check(
    'the screen previews retake themselves without being asked',
    before.cards === 2 && after.src !== before.src,
    after.src === before.src ? 'the preview never changed' : 'the preview changed on its own'
  );
  check(
    'refreshing repaints the picker rather than rebuilding it',
    after.kept,
    after.kept ? 'the cards survived' : 'the cards were replaced, which drops focus mid-interaction'
  );
  // The refresh used to read the saved setting, which a click does not write,
  // so it put the selection back — once on every trip away from the app, and
  // now it would have been every couple of seconds.
  check(
    'a chosen screen stays chosen while the previews refresh',
    before.selected === 'stub-2' && after.selected === 'stub-2',
    `chose ${before.selected}, ended on ${after.selected}`
  );
  live.webContents.debugger.detach();
  live.destroy();

  // A sheet taller than the window used to run past the bottom edge and cut its
  // own buttons in half. It has to hold every control it offers, or scroll.
  const sheet = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.getElementById('settings-dialog');
    document.getElementById('open-settings').click();
    const box = dialog.getBoundingClientRect();
    const body = dialog.querySelector('.sheet-body');
    const last = document.getElementById('folder-default').getBoundingClientRect();
    const result = {
      open: dialog.open,
      withinWindow: box.top >= 0 && box.bottom <= window.innerHeight + 1,
      scrolls: body.scrollHeight > body.clientHeight
        ? 'the body scrolls'
        : 'everything fits without scrolling',
      // Whatever is last must be reachable: on screen already, or scrollable to.
      lastReachable:
        last.bottom <= body.getBoundingClientRect().bottom + 1 ||
        body.scrollHeight > body.clientHeight
    };
    dialog.close();
    return result;
  })()`);
  check(
    'the settings sheet stays inside the window and keeps its buttons whole',
    sheet.open && sheet.withinWindow && sheet.lastReachable,
    `${sheet.scrolls}, inside the window: ${sheet.withinWindow}`
  );

  clearTimeout(failsafe);
  report(0);
});