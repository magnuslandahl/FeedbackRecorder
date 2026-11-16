'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, clipboard, dialog, nativeImage, shell } = require('electron');
const { makeAndDropVideo } = require('./synthetic-video');
const windowChrome = require('../../src/main/window-chrome');

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
      source: { kind: 'import', name: 'walkthrough.webm' },
      input: silent ? { available: false } : input, inputEvents: silent ? [] : events,
      narration: null, transcript: silent
        ? { available: false, reason: 'This fixture has no narration.', segments: [] }
        : { available: true, language: 'en', segments: [{ start: 0, end: 2, text: 'Keep the save button visible.' }] },
      notes: { general: 'Preserve keyboard navigation.', frames: [{ file: frames[0].file, time: 0, text: 'The save button moves here.' }] },
      degraded: silent ? ['Synthetic package warning.'] : []
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
    ...windowChrome.options(process.platform, 'dark', false),
    webPreferences: { preload: path.join(ROOT, 'src/preload/preload.js'),
      additionalArguments: ['--feedback-integrated-titlebar'],
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  const js = (source) => window.webContents.executeJavaScript(source);
  const jsLiteral = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  const drags = [];
  window.webContents.startDrag = (item) => { drags.push(item); };
  const click = (id) => js(`document.getElementById(${jsLiteral(id)}).click(); true`);
  async function poll(source, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = typeof source === 'function' ? await source() : await js(source);
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
    await poll("!document.getElementById('export').disabled", 'save action ready');
    await click('export');
    await poll("document.getElementById('export-note').textContent.startsWith('Saved ')", 'saved ZIP');
    return fs.readFileSync(target);
  }
  async function fresh() {
    await js(makeAndDropVideo({ ms: 1200, name: 'safety-check.webm' }));
    await poll("!document.getElementById('state-framing').hidden", 'fresh recording framing');
    await click('frame-accept');
    await poll("!document.getElementById('state-done').hidden && !document.getElementById('drag-file').disabled", 'fresh handover');
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
    await fresh();
    await click('again');
    check('Record another explains History before anything is handed over', await js(
      "document.getElementById('record-another-dialog').open && document.activeElement.id === 'record-another-stay'"));
    await click('record-another-stay');
    check('Stay here keeps the recording open', await js(
      "!document.getElementById('record-another-dialog').open && !document.getElementById('state-done').hidden"));
    await click('again');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await poll("!document.getElementById('record-another-dialog').open", 'Escape dismisses safety sheet');
    check('Escape is the safe choice', await js("!document.getElementById('state-done').hidden"));
    await js(`(() => {
      const notes = document.getElementById('general-notes');
      notes.value = 'Saved before starting another recording.';
      notes.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const freshDir = [...runtime.runs.values()].at(-1).dir;
    await click('again');
    await click('record-another-confirm');
    await poll("!document.getElementById('state-ready').hidden", 'confirmed new recording');
    check('confirming Record another saves pending notes', fs.readFileSync(path.join(freshDir, 'agent-brief.md'), 'utf8').includes('Saved before starting another recording.'));
    await fresh();
    await click('prompt-expand');
    await click('copy-prompt');
    await poll("document.getElementById('copy-prompt').textContent.includes('Copied')", 'fresh prompt copied');
    await click('again');
    await poll("!document.getElementById('state-ready').hidden", 'copy skips safety sheet');
    check('Record another skips the popup after Copy prompt', await js("!document.getElementById('record-another-dialog').open"));

    await open(recording);
    check('handover opens on the local route with a separate hidden review view', await js(`
      document.getElementById('handover-local').getAttribute('aria-pressed') === 'true' &&
      document.getElementById('handover-attachment-panel').hidden && document.getElementById('recording-review').hidden`));
    check('handover shows only the duration and a single accessible screenshot review button', await js(`
      document.getElementById('handover-summary').textContent === '00:08 recording' &&
      document.getElementById('review-open').tagName === 'BUTTON' &&
      document.getElementById('review-open').getAttribute('aria-label') === 'Review 1 screenshot' &&
      !document.getElementById('review-summary') &&
      !document.querySelector('#review-open button')`));
    check('notes are optional and each new run hides the prompt', await js(`
      document.getElementById('notes-status').textContent === 'Optional' &&
      document.getElementById('local-prompt-preview').parentElement.hidden &&
      document.getElementById('prompt-expand').getAttribute('aria-expanded') === 'false'`));
    check('an imported video with a transcript needs no extra handover metadata or warnings', await js(
      "document.getElementById('warnings').children.length === 0 && !document.getElementById('handover-summary').textContent.includes('Imported')"));
    await click('review-open');
    check('review keeps note and speech badges in the filmstrip', await js(
      "Boolean(document.querySelector('#keyframe-filmstrip .badge-note')) && Boolean(document.querySelector('#keyframe-filmstrip .badge-speech'))"));
    check('Review opens its own view and stays on Hand over', await js(
      "!document.getElementById('recording-review').hidden && document.getElementById('handover-page').hidden && document.querySelector('#steps li.active').dataset.step === 'done'"));
    await click('review-done');
    await poll("document.getElementById('recording-review').hidden", 'review Done');
    check('Done returns to handover', await js("!document.getElementById('handover-page').hidden"));
    await click('copy-prompt');
    await poll("document.getElementById('copy-prompt').textContent.includes('Copied')", 'local clipboard');
    const local = await clipboard.readText();
    check('local prompt names the real persistent folder, including spaces', local.includes(JSON.stringify(recording.dir)) && !local.includes('feedbackrecorder-drag-'));
    check('local prompt is short and points to evidence with a file-access fallback', local.length < 700 && local.includes('agent-brief.md') && local.includes('ask me to attach the ZIP') && !local.includes('Keep the save button visible.'));
    await screenshot('local-dark');

    // Switching routes must not reset an in-progress comment or frame position.
    await js(`(() => {
      const notes = document.getElementById('general-notes');
      notes.value = 'Fresh instructions before copying.';
      notes.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('handover-attachment').click();
    })()`);
    check('switching routes preserves the current draft', await js(
      "document.getElementById('general-notes').value === 'Fresh instructions before copying.'"));
    check('saving notes is announced while the draft is pending', await js(
      "document.getElementById('notes-status').textContent === 'Saving…' && document.getElementById('notes-status').getAttribute('aria-live') === 'polite'"));
    check('attachment actions are visible without disclosures', await js(`
      !document.getElementById('copy-attachment').closest('details') &&
      !document.getElementById('copy-attachment').hidden && !document.getElementById('export').hidden &&
      !document.getElementById('copy-attachment').closest('.panel') &&
      !document.getElementById('export').closest('.panel') &&
      document.getElementById('handover-attachment-panel').innerText.includes('Drag the ZIP into your chat.')`));
    await click('copy-attachment');
    await poll("document.getElementById('copy-attachment').textContent.includes('Copied')", 'attachment clipboard');
    const attachment = await clipboard.readText();
    check('attachment instructions use the extracted folder and contain no local path', attachment.includes('extracted folder as the root') && !attachment.includes(recording.dir) && !attachment.includes(sandbox));
    check('copying immediately after edits flushes them to the evidence', fs.readFileSync(path.join(recording.dir, 'agent-brief.md'), 'utf8').includes('Fresh instructions before copying.'));
    await poll("!document.getElementById('drag-file').disabled", 'edited ZIP');
    check('saved notes briefly acknowledge success', await js(
      "document.getElementById('notes-status').textContent === '✓ Saved'"));
    await poll("document.getElementById('notes-status').textContent === 'Optional'", 'quiet saved notes');
    check('review retains its automatic-save acknowledgement after handover becomes quiet', await js(
      "document.getElementById('review-notes-status').textContent === 'Notes save automatically · ✓ Saved'"));
    check('ZIP contents stay available in its tooltip rather than an icons row', await js(`
      document.getElementById('drag-sub').textContent.includes('click to save a copy') &&
      !document.querySelector('#drag-sub svg') &&
      document.getElementById('drag-file').title.includes('Brief, Screenshots, Transcript, Notes')`));

    // Read the actual archive with an independent unzip implementation.
    for (const [video, audio] of [[false, false], [true, false], [false, true], [true, true]]) {
      await js(`(() => {
        const video = document.getElementById('export-video');
        const audio = document.getElementById('export-audio');
        video.checked = ${video}; audio.checked = ${audio};
        video.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await poll("!document.getElementById('drag-file').disabled", 'selected ZIP');
      check(`chips show sizes only for selected media: video=${video}, audio=${audio}`, await js(`
        document.getElementById('export-video-label').textContent.includes(' · ') === ${video} &&
        document.getElementById('export-audio-label').textContent.includes(' · ') === ${audio}`));
      const prepared = runtime.dragFileFor(recording.id);
      const names = extract(prepared, path.join(sandbox, `unpacked-${video}-${audio}`));
      check(`ZIP media selection: video=${video}, audio=${audio}`, names.includes('recording.webm') === video && names.includes('narration.wav') === audio && names.includes('agent-brief.md') && names.includes('frames'));
      await js(`(async () => {
        document.getElementById('drag-file').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
        await window.feedback.exportPlan(${jsLiteral(recording.id)});
        return true;
      })()`);
      check(`drag gesture hands the selected archive and icon to the OS: video=${video}, audio=${audio}`,
        drags.at(-1).file === prepared && !drags.at(-1).icon.isEmpty());
      const count = drags.length;
      await js(`(async () => {
        window.feedback.startDrag(${jsLiteral(recording.id)}, { includeVideo: ${!video}, includeAudio: ${audio} });
        await window.feedback.exportPlan(${jsLiteral(recording.id)});
        return true;
      })()`);
      check(`a drag request for different media cannot hand out the old archive: video=${video}, audio=${audio}`, drags.length === count);
      target = path.join(sandbox, `saved-${video}-${audio}.zip`);
      const saved = await save();
      check(`saving copies the exact prepared ZIP: video=${video}, audio=${audio}`, saved.equals(fs.readFileSync(prepared)));
    }
    await screenshot('attachment-dark');

    canceled = true;
    await poll("!document.getElementById('export').disabled", 'cancelable save ready');
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
    await js('new Promise(resolve => setTimeout(resolve, 2200))');
    check('save errors stay visible instead of falling back to Optional', await js(
      "document.getElementById('notes-status').textContent.includes('Could not save')"));
    pkg.finalize = finalize;
    await click('copy-prompt');
    await poll("document.getElementById('notes-status').textContent.includes('Saved') && !document.getElementById('drag-file').disabled", 'edit recovery');
    check('a retry saves the draft and rebuilds the ZIP', fs.readFileSync(path.join(recording.dir, 'agent-brief.md'), 'utf8').includes('Retry this edit.'));

    const writeText = clipboard.writeText;
    for (const button of ['copy-prompt', 'copy-attachment', 'copy-full-brief']) {
      await click(button === 'copy-prompt' ? 'handover-local' : 'handover-attachment');
      clipboard.writeText = () => { throw new Error('Synthetic clipboard failure'); };
      await click(button);
      await poll("document.getElementById('export-note').textContent.includes('Could not copy')", 'clipboard failure');
      check(`${button}: clipboard errors leave the copy action usable`, await js(`!document.getElementById(${jsLiteral(button)}).disabled`));
      clipboard.writeText = writeText;
      await clipboard.writeText('retry sentinel');
      await click(button);
      await poll(`!document.getElementById(${jsLiteral(button)}).disabled && document.getElementById('export-note').textContent === ''`, 'clipboard retry');
      check(`${button}: successful retry copies text and clears the old error`,
        (await clipboard.readText()) !== 'retry sentinel' && await js(`document.getElementById(${jsLiteral(button)}).textContent.includes('Copied')`));
    }

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

    await click('reveal');
    await poll('true', 'folder action');
    check('Open recording folder opens the original package', opened.includes(recording.dir));
    await click('copy-full-brief');
    await poll("document.getElementById('copy-full-brief').textContent.includes('Copied')", 'full brief');
    check('full text brief remains available with narration and notes', (await clipboard.readText()).includes('Keep the save button visible.') && (await clipboard.readText()).includes('Retry this edit.'));
    check('copying preserves the successful ZIP save status', await js("document.getElementById('export-note').textContent.startsWith('Saved ')"));

    // A delayed preparation must not publish an archive after an edit invalidates it.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    exporter.save = async (options) => { await gate; return exporterSave(options); };
    await js(`window.feedback.prepareDrag(${jsLiteral(recording.id)}, { includeVideo: true }).then(file => { window.handoverStaleResult = file; }); true`);
    await js(`(async () => { await window.feedback.saveEdits(${jsLiteral(recording.id)}, { notes: { general: 'New revision wins.', frames: [] } }); return true; })()`);
    release();
    await poll('window.handoverStaleResult !== undefined', 'stale preparation result');
    check('an invalidated preparation never becomes the draggable archive', await js('window.handoverStaleResult.stale === true') && !runtime.dragFileFor(recording.id));
    exporter.save = exporterSave;

    // A slow writer must not overlap replacements or start obsolete queued
    // selections. Edits and failed predecessors must also leave the queue usable.
    for (const scenario of ['selection', 'edit', 'failure']) {
      await js(`window.feedback.saveEdits(${jsLiteral(recording.id)}, { notes: { general: 'Queue test.', frames: [] } })`);
      await js('window.handoverQueue = {}; true');
      let releaseWriter;
      const writerGate = new Promise(resolve => { releaseWriter = resolve; });
      const writes = [];
      let active = 0;
      let peak = 0;
      exporter.save = async (options) => {
        if (options.dir !== recording.dir) return exporterSave(options);
        const first = writes.length === 0;
        writes.push(options);
        active += 1;
        peak = Math.max(peak, active);
        try {
          if (first) {
            await writerGate;
            if (scenario === 'failure') throw new Error('Synthetic queued ZIP failure');
          }
          return await exporterSave(options);
        } finally {
          active -= 1;
        }
      };
      const request = (key, options) => js(`
        window.feedback.prepareDrag(${jsLiteral(recording.id)}, ${jsLiteral(options)}).then(
          file => { window.handoverQueue[${jsLiteral(key)}] = file; },
          error => { window.handoverQueue[${jsLiteral(key)}] = { error: error.message }; }
        ); true`);
      await request('first', { includeVideo: true });
      await poll(() => writes.length === 1, 'first queued writer started');
      if (scenario === 'edit') {
        await js(`window.feedback.saveEdits(${jsLiteral(recording.id)}, { notes: { general: 'Latest revision wins.', frames: [] } })`);
      } else {
        await request('obsolete', { includeAudio: true });
      }
      const latest = { includeVideo: true, includeAudio: scenario !== 'edit' };
      await request('latest', latest);
      await request('duplicate', latest);
      // IPC barrier: all requests above reached the runtime while its first
      // writer is still gated, so the concurrency assertion cannot race them.
      await js(`window.feedback.exportPlan(${jsLiteral(recording.id)})`);
      check(`${scenario}: replacement requests wait for the active writer`, peak === 1 && writes.length === 1);
      if (scenario === 'selection') {
        await js(`window.feedback.openRecording(${jsLiteral(silent.id)})`);
        const independent = await js(`window.feedback.prepareDrag(${jsLiteral(silent.id)}, {})`);
        check('a blocked recording does not block another recording from preparing its ZIP', fs.existsSync(independent.path));
      }
      releaseWriter();
      const results = await poll(`(() => {
        const result = window.handoverQueue;
        return result.first && result.latest && result.duplicate && ${scenario === 'edit' ? 'true' : 'result.obsolete'} ? result : false;
      })()`, 'queued preparations complete');
      check(`${scenario}: only the latest queued selection is written once`,
        peak === 1 && writes.length === 2 && results.latest.path === results.duplicate.path &&
        (scenario === 'edit' || results.obsolete.stale === true));
      check(`${scenario}: obsolete work is cleaned up and only the current archive is draggable`,
        (scenario === 'failure' ? results.first.error.includes('Synthetic queued ZIP failure') : results.first.stale === true) &&
        !fs.existsSync(path.dirname(writes[0].target)) && runtime.dragFileFor(recording.id) === results.latest.path);
      const unpacked = path.join(sandbox, `queued-${scenario}`);
      const files = extract(results.latest.path, unpacked);
      check(`${scenario}: the queued ZIP contains the requested media and current notes`,
        files.includes('recording.webm') && files.includes('narration.wav') === latest.includeAudio &&
        fs.readFileSync(path.join(unpacked, 'agent-brief.md'), 'utf8').includes(scenario === 'edit' ? 'Latest revision wins.' : 'Queue test.'));
      exporter.save = exporterSave;
    }

    // Large media copies run asynchronously. Editing during a copy retires
    // the old drag archive, but cannot remove the file being saved underneath it.
    const prepared = await js(`window.feedback.prepareDrag(${jsLiteral(recording.id)}, {})`);
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
    await js(`window.feedback.exportSave(${jsLiteral(recording.id)}, {}).then(result => { window.handoverCopyResult = result; }); true`);
    const copyDeadline = Date.now() + 15000;
    while (!copiedFrom && Date.now() < copyDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    check('ZIP saving yields while the prepared archive is copied', copiedFrom === prepared.path);
    await js(`window.feedback.saveEdits(${jsLiteral(recording.id)}, { notes: { general: 'Edited during saving.', frames: [] } })`);
    check('editing retires the drag archive without deleting an active copy source',
      !runtime.dragFileFor(recording.id) && fs.existsSync(prepared.path));
    finishCopy();
    await poll('window.handoverCopyResult !== undefined', 'copy completion');
    check('the copied snapshot stays intact and its retired temporary file is cleaned up',
      fs.readFileSync(target).equals(expected) && !fs.existsSync(prepared.path));
    fs.promises.copyFile = copyFile;

    // Saving a large archive must not take ownership of a later recording's UI.
    for (const navigation of ['reset', 'other recording']) {
      await click('again');
      await open(recording);
      await click('handover-attachment');
      const destination = path.join(sandbox, `save-before-${navigation}.zip`);
      const archive = runtime.dragFileFor(recording.id);
      const snapshot = fs.readFileSync(archive);
      target = destination;
      const originalCopy = fs.promises.copyFile;
      let releaseCopy;
      let started = false;
      let completed = false;
      const pausedCopy = new Promise((resolve) => { releaseCopy = resolve; });
      fs.promises.copyFile = async (source, into) => {
        if (into === destination) {
          started = true;
          await pausedCopy;
        }
        await originalCopy(source, into);
        if (into === destination) completed = true;
      };
      await click('export');
      const deadline = Date.now() + 15000;
      while (!started && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(started, 'renderer save started before navigation');
      let expectedNote = '';
      if (navigation === 'reset') {
        await click('again');
        await poll("!document.getElementById('state-ready').hidden", 'new recording setup');
      } else {
        await open(silent);
        await click('handover-attachment');
        target = path.join(sandbox, 'save-on-new-recording.zip');
        await save();
        expectedNote = await js("document.getElementById('export-note').textContent");
      }
      releaseCopy();
      const completionDeadline = Date.now() + 15000;
      while (!completed && Date.now() < completionDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(completed, 'old recording copy completed');
      // Let the IPC response and the renderer's completion handler settle.
      await js('new Promise(resolve => setTimeout(resolve, 50))');
      check(`save completion preserves the current UI after ${navigation}`, await js(
        `document.getElementById('export-note').textContent === ${jsLiteral(expectedNote)} &&
         document.getElementById('export').textContent === 'Save ZIP…'`));
      check(`the original ZIP is saved intact after ${navigation}`, fs.readFileSync(destination).equals(snapshot));
      fs.promises.copyFile = originalCopy;
    }

    await click('again');
    await open(silent);
    check('silent recordings keep warnings visible while review is collapsed', await js(
      "document.getElementById('recording-review').hidden && document.getElementById('warnings').innerText.includes('No transcript') && document.getElementById('warnings').innerText.includes('Synthetic package warning.')"));
    check('unavailable media options are disabled', await js(
      "document.getElementById('export-video').disabled && document.getElementById('export-audio').disabled && document.getElementById('export-video').closest('label').title === 'No video in this package' && document.getElementById('export-audio').closest('label').title === 'No audio in this package'"));
    check('missing transcript warning remains visible without an imported-video input warning', await js(
      "document.getElementById('warnings').innerText.includes('No transcript') && !document.getElementById('warnings').innerText.includes('Input activity')"));
    check('reopened packages return to the local route without losing saved evidence', await js(
      "document.getElementById('handover-local').getAttribute('aria-pressed') === 'true' && document.querySelector('#keyframe-filmstrip [aria-pressed=\"true\"]').dataset.index === '0'"));

    const withoutInput = JSON.parse(fs.readFileSync(path.join(silent.dir, 'run.json'), 'utf8'));
    withoutInput.source = { kind: 'recording' };
    pkg.finalize(silent.dir, withoutInput);
    await click('again');
    await open(silent);
    check('recorded packages still warn about missing input alongside other warnings', await js(
      "document.getElementById('warnings').innerText.includes('Input activity was not captured.') && document.getElementById('warnings').innerText.includes('No transcript')"));

    await click('again');
    await open(recording);
    window.setContentSize(540, 700);
    await poll('window.innerWidth === 540 && window.innerHeight === 700', 'default viewport');
    await click('prompt-expand');
    check('the eye control exposes the full prompt', await js(
      "document.getElementById('prompt-expand').getAttribute('aria-expanded') === 'true' && !document.getElementById('local-prompt-preview').parentElement.hidden && document.getElementById('prompt-expand').textContent === 'Hide prompt' && getComputedStyle(document.getElementById('local-prompt-preview')).webkitLineClamp === 'none'"));
    await click('prompt-expand');
    check('the prompt can be hidden without losing its text or the copy action', await js(
      "document.getElementById('local-prompt-preview').parentElement.hidden && document.getElementById('local-prompt-preview').textContent.includes('agent-brief.md') && document.getElementById('prompt-expand').textContent === 'Show prompt'"));
    for (const theme of ['dark', 'light']) {
      for (const route of ['local', 'attachment']) {
        await js(`document.documentElement.dataset.theme = '${theme}'; document.getElementById('handover-${route}').click(); true`);
        const layout = await js(`(() => {
          const main = document.querySelector('main');
          return {
            height: main.clientHeight, content: main.scrollHeight,
            panels: [...document.querySelectorAll('#handover-page > *')].map(node => [node.className, Math.round(node.getBoundingClientRect().height)])
          };
        })()`);
        check(`${theme} ${route}: default handover fits without page scrolling (${JSON.stringify(layout)})`, layout.content <= layout.height);
      }
      await click('review-open');
      check(`${theme}: the default review fits with its note and speech`, await js(
        "document.querySelector('main').scrollHeight <= document.querySelector('main').clientHeight && !document.getElementById('frame-narration').parentElement.hidden"));
      await click('review-done');
      await poll("document.getElementById('recording-review').hidden", 'default review closed');
    }

    window.setContentSize(460, 560);
    await poll('window.innerWidth === 460 && window.innerHeight === 560', 'minimum viewport');
    for (const route of ['local', 'attachment']) {
      await click(`handover-${route}`);
      check(`minimum ${route}: no horizontal overflow and secondary actions remain reachable`, await js(`
        document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth &&
        !document.getElementById('copy-full-brief').hidden &&
        !document.getElementById('reveal').hidden`));
    }

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
