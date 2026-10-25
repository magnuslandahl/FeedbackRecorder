'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, clipboard, dialog, nativeImage, shell } = require('electron');

// Exercise the real renderer, preload, package writer and IPC with disposable,
// synthetic recordings. No screen, microphone or external service is needed.
const ROOT = path.join(__dirname, '..', '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-handover-e2e-'));
app.setPath('userData', path.join(sandbox, 'userData'));
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const output = outArg ? outArg.slice('--out='.length) : null;
let passed = 0;

function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok   ${name}`);
}

function extract(file, into) {
  fs.mkdirSync(into, { recursive: true });
  try {
    const tar = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'tar';
    execFileSync(tar, ['-xf', file, '-C', into], { stdio: 'pipe' });
  } catch {
    execFileSync('unzip', ['-qq', '-o', file, '-d', into], { stdio: 'pipe' });
  }
  return fs.readdirSync(into);
}

app.whenReady().then(async () => {
  const settings = require('../../src/main/settings');
  const pkg = require('../../src/main/package-writer');
  const exporter = require('../../src/main/exporter');
  const { createRuntime } = require('../../src/main/runtime');
  const recordingsDir = path.join(sandbox, 'recordings with spaces');
  fs.mkdirSync(recordingsDir);
  settings.save({ recordingsDir, language: 'en' });

  function fixture(date, silent) {
    const created = pkg.createPackage(recordingsDir, date);
    const png = nativeImage.createFromBuffer(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'
    )).resize({ width: 320, height: 200 }).toPNG();
    const frames = pkg.writeFrames(created.dir, [{ time: 0, data: png, score: 1 }]);
    const events = [{ time: 0.5, kind: 'shortcut', detail: 'Ctrl+S' }];
    const input = pkg.writeInputEvents(created.dir, events, { pointer: true, keyboard: true });
    if (!silent) {
      fs.writeFileSync(path.join(created.dir, 'recording.webm'), 'synthetic video fixture');
      fs.writeFileSync(path.join(created.dir, 'narration.wav'), 'synthetic audio fixture');
    }
    pkg.finalize(created.dir, {
      id: created.id, packagePath: created.dir, startedAt: date.toISOString(), durationSeconds: 8,
      frameSize: { width: 320, height: 200 }, region: null, keyframes: frames, revisits: [],
      source: { kind: 'import', name: 'walkthrough.webm' }, input, inputEvents: events,
      narration: null, transcript: silent
        ? { available: false, reason: 'This fixture has no narration.', segments: [] }
        : { available: true, language: 'en', segments: [{ start: 0, end: 2, text: 'Keep the save button visible.' }] },
      notes: { general: 'Preserve keyboard navigation.', frames: [{ file: frames[0].file, time: 0, text: 'The save button moves here.' }] },
      degraded: silent ? ['No narration was transcribed.'] : []
    });
    return created;
  }
  const recording = fixture(new Date(2026, 9, 20, 10, 0, 0), false);
  const silent = fixture(new Date(2026, 9, 20, 11, 0, 0), true);
  const runtime = createRuntime({ appRoot: ROOT, windows: {
    hideMain() {}, showMain() {}, openBar() {}, closeBar() {}, sendToBar() {}, sendToMain() {}
  } });
  runtime.registerIpc();
  let target = path.join(sandbox, 'saved.zip');
  let canceled = false;
  dialog.showSaveDialog = async () => ({ canceled, filePath: target });
  const opened = [];
  shell.openPath = async (folder) => { opened.push(folder); return ''; };
  const window = new BrowserWindow({
    width: 720, height: 900, useContentSize: true, show: false,
    webPreferences: { preload: path.join(ROOT, 'src/preload/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  const js = (source) => window.webContents.executeJavaScript(source);
  const drags = [];
  window.webContents.startDrag = (item) => { drags.push(item); };
  const click = (id) => js(`document.getElementById(${JSON.stringify(id)}).click(); true`);
  async function poll(source, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = await js(source);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function open(record) {
    await click('open-history');
    await poll(`document.querySelector('.history-item[data-id="${record.id}"] .history-open') !== null`, 'history row');
    await js(`document.querySelector('.history-item[data-id="${record.id}"] .history-open').click(); true`);
    await poll("!document.getElementById('state-done').hidden && !document.getElementById('drag-file').disabled", 'handover ready');
  }
  async function save() {
    await click('export');
    await poll("document.getElementById('export-note').textContent.startsWith('Saved ')", 'saved ZIP');
    return fs.readFileSync(target);
  }
  async function screenshot(name) {
    if (!output) return;
    fs.mkdirSync(output, { recursive: true });
    const visible = window.isVisible();
    // A hidden macOS window can return only the last damaged compositor tiles.
    // Show without activation while capturing the actual, settled screen.
    if (!visible) window.showInactive();
    await js('document.querySelector("main").scrollTop = 0; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    window.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 900));
    fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    if (!visible) window.hide();
  }
  const timer = setTimeout(() => { console.error('FAIL handover timed out'); app.exit(1); }, 120000);
  try {
    await window.loadFile(path.join(ROOT, 'src/renderer/index.html'));
    await open(recording);
    check('handover opens on the local route with review collapsed', await js(`
      document.getElementById('handover-local').getAttribute('aria-pressed') === 'true' &&
      document.getElementById('handover-attachment-panel').hidden && !document.getElementById('recording-review').open`));
    check('review summary describes saved instructions and comments', await js(
      "document.getElementById('review-summary').textContent.includes('Written instructions · 1 comment')"));
    await click('copy-prompt');
    await poll("document.getElementById('copy-prompt').textContent.includes('Copied')", 'local clipboard');
    const local = await clipboard.readText();
    check('local prompt names the real persistent folder, including spaces', local.includes(JSON.stringify(recording.dir)) && !local.includes('feedbackrecorder-drag-'));
    check('local prompt is short and points to evidence with a file-access fallback', local.length < 700 && local.includes('agent-brief.md') && local.includes('ask me to attach the ZIP') && !local.includes('Keep the save button visible.'));
    await screenshot('local-dark');

    // Switching routes must not reset an in-progress comment or frame position.
    await js(`(() => {
      document.getElementById('recording-review').open = true;
      const notes = document.getElementById('general-notes');
      notes.value = 'Fresh instructions before copying.';
      notes.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('handover-attachment').click();
    })()`);
    check('switching routes preserves the current draft and review state', await js(
      "document.getElementById('general-notes').value === 'Fresh instructions before copying.' && document.getElementById('recording-review').open"));
    check('attachment instructions are optional and collapsed', await js(`
      document.getElementById('copy-attachment').closest('details').open === false &&
      document.getElementById('handover-attachment-panel').innerText.includes('Drag the ZIP into your chat.')`));
    await js("document.getElementById('copy-attachment').closest('details').open = true; true");
    await click('copy-attachment');
    await poll("document.getElementById('copy-attachment').textContent.includes('Copied')", 'attachment clipboard');
    const attachment = await clipboard.readText();
    check('attachment instructions use the extracted folder and contain no local path', attachment.includes('extracted folder as the root') && !attachment.includes(recording.dir) && !attachment.includes(sandbox));
    check('copying immediately after edits flushes them to the evidence', fs.readFileSync(path.join(recording.dir, 'agent-brief.md'), 'utf8').includes('Fresh instructions before copying.'));
    await poll("!document.getElementById('drag-file').disabled", 'edited ZIP');

    // Read the actual archive with an independent unzip implementation.
    for (const [video, audio] of [[false, false], [true, false], [false, true], [true, true]]) {
      await js(`(() => {
        const video = document.getElementById('export-video');
        const audio = document.getElementById('export-audio');
        video.checked = ${video}; audio.checked = ${audio};
        video.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await poll("!document.getElementById('drag-file').disabled", 'selected ZIP');
      const prepared = runtime.dragFileFor(recording.id);
      const names = extract(prepared, path.join(sandbox, `unpacked-${video}-${audio}`));
      check(`ZIP media selection: video=${video}, audio=${audio}`, names.includes('recording.webm') === video && names.includes('narration.wav') === audio && names.includes('agent-brief.md') && names.includes('frames'));
      await js(`(async () => {
        document.getElementById('drag-file').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
        await window.feedback.exportPlan(${JSON.stringify(recording.id)});
        return true;
      })()`);
      check(`drag gesture hands the selected archive and icon to the OS: video=${video}, audio=${audio}`,
        drags.at(-1).file === prepared && !drags.at(-1).icon.isEmpty());
      const count = drags.length;
      await js(`(async () => {
        window.feedback.startDrag(${JSON.stringify(recording.id)}, { includeVideo: ${!video}, includeAudio: ${audio} });
        await window.feedback.exportPlan(${JSON.stringify(recording.id)});
        return true;
      })()`);
      check(`a drag request for different media cannot hand out the old archive: video=${video}, audio=${audio}`, drags.length === count);
      target = path.join(sandbox, `saved-${video}-${audio}.zip`);
      const saved = await save();
      check(`saving copies the exact prepared ZIP: video=${video}, audio=${audio}`, saved.equals(fs.readFileSync(prepared)));
    }
    await js("document.getElementById('recording-review').open = false; document.getElementById('copy-attachment').closest('details').open = false; true");
    await screenshot('attachment-dark');

    canceled = true;
    await click('export');
    await poll("!document.getElementById('export').disabled && document.getElementById('export-note').textContent === ''", 'canceled save');
    check('canceling a save keeps the prepared ZIP ready', await js("!document.getElementById('drag-file').disabled"));
    canceled = false;

    // Fail while there are unsaved edits: clipboard and drag must not expose
    // the old revision, and the visible error must survive collapsed review.
    const finalize = pkg.finalize;
    pkg.finalize = () => { throw new Error('Synthetic write failure'); };
    await clipboard.writeText('unchanged');
    await js(`(() => {
      const notes = document.getElementById('general-notes');
      notes.value = 'Retry this edit.';
      notes.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('copy-prompt').click();
    })()`);
    await poll("document.getElementById('notes-status').textContent.includes('Could not save before copying')", 'save failure');
    check('failed edits block copying and dragging and show an unfolded error', (await clipboard.readText()) === 'unchanged' && await js(
      "document.getElementById('drag-file').disabled && !document.getElementById('notes-status').closest('details')"));
    pkg.finalize = finalize;
    await click('copy-prompt');
    await poll("document.getElementById('notes-status').textContent.includes('Saved') && !document.getElementById('drag-file').disabled", 'edit recovery');
    check('a retry saves the draft and rebuilds the ZIP', fs.readFileSync(path.join(recording.dir, 'agent-brief.md'), 'utf8').includes('Retry this edit.'));

    const writeText = clipboard.writeText;
    clipboard.writeText = () => { throw new Error('Synthetic clipboard failure'); };
    await click('copy-attachment');
    await poll("document.getElementById('export-note').textContent.includes('Could not copy')", 'clipboard failure');
    check('clipboard errors are visible and leave the copy action usable', await js("!document.getElementById('copy-attachment').disabled"));
    clipboard.writeText = writeText;

    // A failure before ZIP writing starts must not cache a rejected promise.
    const mkdtemp = fs.mkdtempSync;
    fs.mkdtempSync = (prefix, ...args) => {
      if (String(prefix).includes('feedbackrecorder-drag-')) throw new Error('Synthetic temporary-folder failure');
      return mkdtemp(prefix, ...args);
    };
    await js(`(() => {
      const audio = document.getElementById('export-audio'); audio.checked = false;
      audio.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await poll("document.getElementById('drag-name').textContent.includes('could not')", 'temporary-folder failure');
    check('temporary-folder failures leave an explicit retry path', await js(
      "document.getElementById('drag-file').disabled && !document.getElementById('export').disabled"));
    fs.mkdtempSync = mkdtemp;
    target = path.join(sandbox, 'recovered-allocation.zip');
    await save();
    check('the same media selection can recover after a temporary-folder failure',
      await poll("!document.getElementById('drag-file').disabled", 'allocation recovery'));

    // An export failure cannot leave the previous archive draggable.
    const exporterSave = exporter.save;
    exporter.save = async () => { throw new Error('Synthetic ZIP failure'); };
    await js(`(() => {
      const video = document.getElementById('export-video'); video.checked = false;
      video.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await poll("document.getElementById('drag-name').textContent.includes('could not')", 'ZIP failure');
    check('ZIP failure removes stale drag contents and offers a save retry', !runtime.dragFileFor(recording.id) && await js("document.getElementById('drag-file').disabled && !document.getElementById('export').disabled"));
    exporter.save = exporterSave;
    target = path.join(sandbox, 'recovered.zip');
    await save();
    check('saving retries a failed preparation and restores dragging', fs.existsSync(target) &&
      await poll("!document.getElementById('drag-file').disabled", 'drag recovery'));

    await js("document.getElementById('handover-more').open = true; true");
    await click('reveal');
    await poll('true', 'folder action');
    check('Open recording folder opens the original package', opened.includes(recording.dir));
    await click('copy-full-brief');
    await poll("document.getElementById('copy-full-brief').textContent.includes('Copied')", 'full brief');
    check('full text brief remains available with narration and notes', (await clipboard.readText()).includes('Keep the save button visible.') && (await clipboard.readText()).includes('Retry this edit.'));

    // A delayed preparation must not publish an archive after an edit invalidates it.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    exporter.save = async (options) => { await gate; return exporterSave(options); };
    await js(`window.feedback.prepareDrag(${JSON.stringify(recording.id)}, { includeVideo: true }).then(file => { window.handoverStaleResult = file; }); true`);
    await js(`(async () => { await window.feedback.saveEdits(${JSON.stringify(recording.id)}, { notes: { general: 'New revision wins.', frames: [] } }); return true; })()`);
    release();
    await poll('window.handoverStaleResult !== undefined', 'stale preparation result');
    check('an invalidated preparation never becomes the draggable archive', await js('window.handoverStaleResult.stale === true') && !runtime.dragFileFor(recording.id));
    exporter.save = exporterSave;

    // Large media copies run asynchronously. Editing during a copy retires
    // the old drag archive, but cannot remove the file being saved underneath it.
    const prepared = await js(`window.feedback.prepareDrag(${JSON.stringify(recording.id)}, {})`);
    const expected = fs.readFileSync(prepared.path);
    const copyFile = fs.promises.copyFile;
    let copiedFrom;
    let finishCopy;
    const copyGate = new Promise((resolve) => { finishCopy = resolve; });
    fs.promises.copyFile = async (source, destination) => {
      copiedFrom = source;
      await copyGate;
      return copyFile(source, destination);
    };
    target = path.join(sandbox, 'copy-in-progress.zip');
    await js(`window.feedback.exportSave(${JSON.stringify(recording.id)}, {}).then(result => { window.handoverCopyResult = result; }); true`);
    const copyDeadline = Date.now() + 15000;
    while (!copiedFrom && Date.now() < copyDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    check('ZIP saving yields while the prepared archive is copied', copiedFrom === prepared.path);
    await js(`window.feedback.saveEdits(${JSON.stringify(recording.id)}, { notes: { general: 'Edited during saving.', frames: [] } })`);
    check('editing retires the drag archive without deleting an active copy source',
      !runtime.dragFileFor(recording.id) && fs.existsSync(prepared.path));
    finishCopy();
    await poll('window.handoverCopyResult !== undefined', 'copy completion');
    check('the copied snapshot stays intact and its retired temporary file is cleaned up',
      fs.readFileSync(target).equals(expected) && !fs.existsSync(prepared.path));
    fs.promises.copyFile = copyFile;

    await open(silent);
    check('silent recordings keep warnings visible while review is collapsed', await js(
      "!document.getElementById('recording-review').open && document.getElementById('warnings').innerText.includes('No narration')"));
    check('unavailable media options are disabled', await js(
      "document.getElementById('export-video').disabled && document.getElementById('export-audio').disabled"));
    check('reopened packages return to the local route without losing saved evidence', await js(
      "document.getElementById('handover-local').getAttribute('aria-pressed') === 'true' && document.getElementById('keyframe-slider').value === '0'"));

    // Check actual layout and focusable controls, rather than just class names.
    await js("document.documentElement.dataset.theme = 'light'; document.getElementById('handover-attachment').click(); true");
    window.setContentSize(420, 760);
    await poll('window.innerWidth === 420', 'narrow viewport');
    check('narrow attachment layout fits without horizontal overflow', await js(
      "document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth && document.documentElement.scrollWidth <= window.innerWidth"));
    await screenshot('attachment-light-narrow');
    window.show();
    window.webContents.focus();
    await js("document.getElementById('handover-local').focus(); true");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    check('Tab moves between the visible route controls', await poll("document.activeElement.id === 'handover-attachment'", 'keyboard route focus'));
    console.log(`\n${passed}/${passed} handover checks passed`);
    clearTimeout(timer);
    window.destroy();
    for (const run of [recording, silent]) {
      const prepared = runtime.dragFileFor(run.id);
      if (prepared) fs.rmSync(path.dirname(prepared), { recursive: true, force: true });
    }
    for (const name of fs.readdirSync(sandbox)) {
      if (name !== 'userData') fs.rmSync(path.join(sandbox, name), { recursive: true, force: true });
    }
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch (error) {
      // Windows holds Electron's userData files until this process exits.
      // All recording/archive fixtures are already gone; other errors still fail.
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
    }
    app.exit(0);
  } catch (error) {
    console.error(`FAIL ${error.stack}`);
    clearTimeout(timer);
    await screenshot('failure');
    window.destroy();
    app.exit(1);
  }
}).catch((error) => { console.error(error.stack); app.exit(1); });
