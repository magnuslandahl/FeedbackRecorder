'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, clipboard, dialog, nativeImage, shell } = require('electron');

// Opens earlier recordings the way somebody would after restarting the app:
// the packages are already on disk before the window loads, and nothing about
// them is held in memory. Then it edits one, checks the edit reaches every
// file the brief is handed over in, and deletes two.
//
// The Recycle Bin and Explorer are stood in for, so running this leaves
// nothing behind on the machine and opens no windows.

const ROOT = path.join(__dirname, '..', '..');
const TIMEOUT_MS = 120000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-history-e2e-'));
app.setPath('userData', path.join(sandbox, 'userData'));

function finish(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);

  try {
    fs.rmSync(path.join(sandbox, 'recordings'), { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    /* userData is held by this process until it exits; it is under TEMP */
  }

  app.exit(code);
}

function poll(window, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let value = false;
      try {
        value = await window.webContents.executeJavaScript(expression);
      } catch (error) {
        return reject(error);
      }
      if (value) return resolve(value);
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${label}`));
      return setTimeout(tick, 200);
    };
    tick();
  });
}

function solidPng(width, height, [red, green, blue]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = blue;
    pixels[offset + 1] = green;
    pixels[offset + 2] = red;
    pixels[offset + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width, height }).toPNG();
}

// A finished package written by the same code that writes a real one, so a
// change to the package format is a change this test sees.
function writePackage(pkg, root, date, options) {
  const created = pkg.createPackage(root, date);
  const keyframes = pkg.writeFrames(
    created.dir,
    options.colours.map((colour, index) => ({
      time: 0.5 + index * 2,
      score: 1 - index * 0.1,
      data: solidPng(options.width || 320, options.height || 200, colour)
    }))
  );
  const events = options.events || [];
  const input = options.events
    ? pkg.writeInputEvents(created.dir, events, { pointer: true, keyboard: true })
    : { available: false, reason: 'Not applicable to an imported video.' };
  const notes = {
    general: options.general || '',
    frames: (options.comments || []).map(([index, text]) => ({ file: keyframes[index].file, text }))
  };
  pkg.finalize(created.dir, {
    id: created.id,
    packagePath: created.dir,
    startedAt: date.toISOString(),
    durationSeconds: options.colours.length * 2 + 1,
    frameSize: { width: options.width || 320, height: options.height || 200 },
    region: null,
    display: options.source ? null : { name: 'Main display' },
    source: options.source || { kind: 'recording' },
    keyframes,
    revisits: (options.revisits || []).map(([index, time]) => ({ file: keyframes[index].file, time })),
    input,
    inputEvents: events,
    narration: null,
    transcript: {
      available: true,
      language: 'en',
      requestedLanguage: 'en',
      engine: 'whisper.cpp (ggml-small.bin)',
      segments: [{ start: 0.6, end: 2.4, text: options.spoken }, ...(options.laterSpeech || [])]
    },
    notes,
    degraded: []
  });
  return created;
}

// bsdtar reads a zip (Windows and macOS); GNU tar on Linux does not, so unzip
// is tried there. Returns false only when nothing on the machine can open it.
function unzip(file, into) {
  fs.mkdirSync(into, { recursive: true });
  const tar = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'tar';
  const extractors = [
    [tar, ['-xf', file, '-C', into]],
    ['unzip', ['-qq', '-o', file, '-d', into]]
  ];
  for (const [command, args] of extractors) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
      return true;
    } catch (error) {
      // Try the next one.
    }
  }
  return false;
}

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const pkg = require(path.join(ROOT, 'src', 'main', 'package-writer.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));

  const recordingsDir = path.join(sandbox, 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  settings.save({ recordingsDir, language: 'en' });

  // Written before the app starts, as a previous session would have left them.
  const imported = writePackage(pkg, recordingsDir, new Date(2026, 9, 12, 8, 15, 10), {
    source: { kind: 'import', name: 'checkout-flow.webm' },
    colours: [[200, 60, 60], [60, 160, 90]],
    general: 'Old general note about the checkout.',
    comments: [[1, 'The pay button is hidden on small screens.']],
    spoken: 'Here the pay button disappears',
    width: 180,
    height: 340
  });
  const recorded = writePackage(pkg, recordingsDir, new Date(2026, 9, 13, 16, 12, 45), {
    colours: [[40, 90, 200], [230, 180, 40], [120, 120, 120]],
    events: [
      { time: 1.1, kind: 'click', detail: 'click', screen: 'recorded', x: 40, y: 60 },
      { time: 2.4, kind: 'shortcut', detail: 'Ctrl+Shift+P' }
    ],
    comments: [[1, 'Spinner never stops here.']],
    spoken: 'The settings page jumps when the list loads',
    revisits: [[0, 3.5], [1, 5.5], [0, 6.5]],
    laterSpeech: [
      { start: 3.6, end: 4.2, text: 'The first page is back for a second attempt.' },
      { start: 5.6, end: 6.4, text: 'The spinner is back again.' },
      { start: 6.6, end: 6.9, text: 'The first page is back for a third attempt.' },
      { start: 4.2, end: 5.8, text: 'This sentence spans a screen change.' }
    ]
  });
  const legacyRun = JSON.parse(fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8'));
  legacyRun.transcript.segments = legacyRun.transcript.segments.map(({ start, end, text }) => ({ start, end, text }));
  fs.writeFileSync(path.join(recorded.dir, 'run.json'), JSON.stringify(legacyRun, null, 2));
  const beforeOpening = fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8');
  const unfinished = pkg.createPackage(recordingsDir, new Date(2026, 9, 14, 9, 0, 0));
  fs.writeFileSync(path.join(unfinished.dir, 'recording.webm'), Buffer.alloc(64));
  const broken = pkg.createPackage(recordingsDir, new Date(2026, 9, 11, 7, 0, 0));
  fs.writeFileSync(path.join(broken.dir, 'run.json'), '{ cut off', 'utf8');
  fs.mkdirSync(path.join(recordingsDir, 'not-a-recording'));

  const windows = {
    hideMain() {},
    showMain() {},
    openBar() {
      return { onRecordedDisplay: false };
    },
    closeBar() {},
    sendToBar() {},
    sendToMain() {}
  };

  const runtime = createRuntime({ appRoot: ROOT, windows });
  runtime.registerIpc();

  const questions = [];
  dialog.showMessageBox = async (...args) => {
    questions.push(args[args.length - 1]);
    return { response: 1, checkboxChecked: false };
  };
  const trashed = [];
  shell.trashItem = async (target) => {
    trashed.push(target);
    fs.rmSync(target, { recursive: true, force: true });
  };
  const opened = [];
  shell.openPath = async (target) => {
    opened.push(target);
    return '';
  };

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
  const js = (expression) => window.webContents.executeJavaScript(expression);
  const visible = (state) => js(`!document.getElementById('state-${state}').hidden`);
  const rowIds = () =>
    js("[...document.querySelectorAll('#history-list .history-item')].map((row) => row.dataset.id)");
  // Waits for this visit's listing, not the rows left from the last one.
  const openList = async (count) => {
    await js("document.getElementById('open-history').click(); true");
    await poll(
      window,
      `!document.getElementById('state-history').hidden &&
        !document.getElementById('history-status').textContent.startsWith('Reading') &&
        document.querySelectorAll('#history-list .history-item').length === ${count}`,
      15000,
      'the list'
    );
  };

  const failsafe = setTimeout(() => {
    check('the run completed inside the time limit', false, `${TIMEOUT_MS / 1000}s`);
    finish(1);
  }, TIMEOUT_MS);

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await poll(window, "!document.getElementById('state-ready').hidden", 30000, 'the Ready state');

    check(
      'the Recordings button is offered on the Ready screen',
      await js("!document.getElementById('open-history').hidden")
    );

    // ------------------------------------------------------------ The list
    await openList(4);
    check('the Recordings screen opens from the header', await visible('history'));
    check(
      'no step is marked current while the list is up',
      await js("!document.querySelector('#steps li.active')")
    );

    const ids = await rowIds();
    check(
      'every package folder is listed, newest first, and other folders are not',
      JSON.stringify(ids) === JSON.stringify([unfinished.id, recorded.id, imported.id, broken.id]),
      ids.join(', ')
    );

    const rows = await js(`[...document.querySelectorAll('#history-list .history-item')].map((row) => ({
      id: row.dataset.id,
      status: row.dataset.status,
      title: row.querySelector('.history-title').textContent,
      meta: row.querySelector('.history-meta').textContent,
      snippet: row.querySelector('.history-snippet').textContent,
      openable: !row.querySelector('.history-open').disabled,
      label: row.querySelector('.history-open').getAttribute('aria-label'),
      deleteLabel: row.querySelector('.history-delete').getAttribute('aria-label')
    }))`);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    check(
      'a finished recording says how long, from where, and how many keyframes and notes',
      /^7 s · /.test(byId[recorded.id].meta) &&
        /Main display/.test(byId[recorded.id].meta) &&
        /3 keyframes/.test(byId[recorded.id].meta) &&
        /1 note\b/.test(byId[recorded.id].meta),
      byId[recorded.id].meta
    );
    check(
      'an imported video is named as imported',
      /Imported checkout-flow\.webm/.test(byId[imported.id].meta) && /2 notes/.test(byId[imported.id].meta),
      byId[imported.id].meta
    );
    check(
      'the snippet is what the person wrote, before what they said',
      byId[imported.id].snippet === 'Old general note about the checkout.' &&
        byId[recorded.id].snippet === 'Spinner never stops here.',
      `${byId[imported.id].snippet} | ${byId[recorded.id].snippet}`
    );
    check(
      'a package that never finished is listed but cannot be opened',
      !byId[unfinished.id].openable && /Never finished/.test(byId[unfinished.id].meta),
      byId[unfinished.id].meta
    );
    check(
      'a package with a damaged run.json is listed but cannot be opened',
      byId[broken.id].status === 'unreadable' && !byId[broken.id].openable,
      byId[broken.id].meta
    );
    check(
      'rows are dated in words and their buttons are named for screen readers',
      /2026/.test(byId[recorded.id].title) &&
        /^Open the recording from /.test(byId[recorded.id].label) &&
        /^Delete the recording from /.test(byId[recorded.id].deleteLabel),
      `${byId[recorded.id].title} | ${byId[recorded.id].label}`
    );
    check(
      'the count says how many and how much space they take',
      /^4 recordings · [\d.]+ (B|KB|MB)$/.test(await js("document.getElementById('history-count').textContent")),
      await js("document.getElementById('history-count').textContent")
    );

    await poll(window, "document.querySelectorAll('.history-thumb.loaded').length === 2", 15000, 'thumbnails');
    const thumbs = await js(`[...document.querySelectorAll('.history-thumb.loaded img')].map((img) => ({
      src: img.src.slice(0, 5),
      width: img.naturalWidth
    }))`);
    check(
      'finished recordings get a small thumbnail of their first keyframe, as a blob',
      thumbs.every((thumb) => thumb.src === 'blob:' && thumb.width === 192),
      JSON.stringify(thumbs)
    );

    // ------------------------------------------------------------ Search
    const search = async (text) => {
      await js(`(() => {
        const field = document.getElementById('history-search');
        field.value = ${JSON.stringify(text)};
        field.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      return rowIds();
    };
    check('search finds a recording by a keyframe comment', (await search('spinner')).join() === recorded.id);
    check('search finds one by its narration', (await search('pay button')).join() === imported.id);
    check('search finds one by the name of the imported file', (await search('CHECKOUT-flow')).join() === imported.id);
    check('every word has to match', (await search('spinner checkout')).length === 0);
    check(
      'a search with no results says so',
      /Nothing matches/.test(await js("document.getElementById('history-status').textContent"))
    );
    check('clearing the search lists everything again', (await search('')).length === 4);

    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
    check('Escape goes back to where the list was opened from', await visible('ready'));

    // ------------------------------------------------------------ Opening
    await openList(4);
    await js(
      `document.querySelector('.history-item[data-id="${recorded.id}"] .history-open').click(); true`
    );
    await poll(window, "!document.getElementById('state-done').hidden", 15000, 'the Done screen');
    await poll(window, "!document.getElementById('drag-file').disabled", 15000, 'the drag zip');

    const done = await js(`(() => {
      const slider = document.getElementById('keyframe-slider');
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        frames: Number(slider.max) + 1,
        image: document.getElementById('keyframe-image').src.slice(0, 5),
        comment: document.getElementById('keyframe-comment').value,
        path: document.getElementById('package-path').textContent,
        reframeHidden: document.getElementById('reframe').hidden,
        framingStep: document.querySelector('#steps li[data-step="framing"] .step').disabled,
        readyStep: document.querySelector('#steps li[data-step="ready"] .step').disabled,
        summary: document.getElementById('summary').textContent,
        transcript: document.getElementById('transcript-preview').textContent,
        engine: document.getElementById('transcript-engine').textContent
      };
    })()`);
    check(
      'an earlier recording opens with every visit, including reused keyframe images',
      done.frames === 6 && done.image === 'blob:',
      JSON.stringify({ frames: done.frames, image: done.image })
    );
    check('its saved keyframe comment is back in place', done.comment === 'Spinner never stops here.', done.comment);
    check(
      'opening an older package derives associations without rewriting its run.json',
      fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8') === beforeOpening
    );
    check('it names the package folder it came from', done.path === recorded.dir, done.path);
    check(
      'it cannot be reframed, because its video is not loaded, and the header agrees',
      done.reframeHidden && done.framingStep && !done.readyStep,
      JSON.stringify(done)
    );
    check('the summary is the package’s own', /Main display/.test(done.summary) && /3/.test(done.summary));
    check(
      'Package details shows the actual dictation text and model',
      done.transcript.includes('The settings page jumps when the list loads') &&
        done.engine.includes('ggml-small.bin')
    );

    const visits = await js(`(() => {
      const slider = document.getElementById('keyframe-slider');
      return [0, 2, 5].map((index) => {
        slider.value = String(index);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          image: document.getElementById('keyframe-image').src,
          position: document.getElementById('keyframe-position').textContent,
          speech: document.getElementById('frame-narration').textContent,
          comment: document.getElementById('keyframe-comment').value
        };
      });
    })()`);
    check(
      'three visits reuse one image but have separate timeline positions and dictation',
      new Set(visits.map((visit) => visit.image)).size === 1 &&
        /Frame 1 of 6/.test(visits[0].position) &&
        /Frame 3 of 6/.test(visits[1].position) &&
        /Frame 6 of 6/.test(visits[2].position) &&
        visits[0].speech.includes('settings page jumps') &&
        !visits[0].speech.includes('second attempt') &&
        visits[1].speech.includes('second attempt') &&
        visits[1].speech.includes('(spans a screen change)') &&
        !visits[1].speech.includes('third attempt') &&
        visits[2].speech.includes('third attempt') &&
        visits.every((visit) => visit.comment === ''),
      JSON.stringify(visits)
    );

    const zoom = await js(`(() => {
      const preview = document.getElementById('keyframe-preview');
      const viewport = document.getElementById('keyframe-viewport');
      const control = document.getElementById('keyframe-zoom');
      const before = preview.getBoundingClientRect();
      control.value = '200';
      control.dispatchEvent(new Event('input', { bubbles: true }));
      const after = preview.getBoundingClientRect();
      viewport.scrollLeft = 40;
      viewport.scrollTop = 40;
      return {
        widthRatio: after.width / before.width, heightRatio: after.height / before.height,
        scrollable: viewport.scrollLeft > 0 && viewport.scrollTop > 0,
        label: document.getElementById('keyframe-zoom-value').value,
        resize: getComputedStyle(viewport).resize,
        modal: document.getElementById('keyframe-dialog').open,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()`);
    check(
      'inline zoom doubles the picture with scrolling, vertical resizing and no modal or page overflow',
      zoom.widthRatio > 1.8 && zoom.heightRatio > 1.8 && zoom.scrollable &&
        zoom.label === '200%' && zoom.resize === 'vertical' && !zoom.modal && !zoom.overflow,
      JSON.stringify(zoom)
    );
    await js(`(() => {
      const control = document.getElementById('keyframe-zoom');
      control.value = '100';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const resizeHandle = await js(`(() => {
      const viewport = document.getElementById('keyframe-viewport');
      viewport.scrollIntoView({ block: 'start' });
      const rect = viewport.getBoundingClientRect();
      return { x: Math.round(rect.right - 4), y: Math.round(rect.bottom - 4), height: rect.height };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', x: resizeHandle.x, y: resizeHandle.y, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: resizeHandle.x, y: resizeHandle.y + 100, modifiers: ['leftButtonDown'] });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: resizeHandle.x, y: resizeHandle.y + 100, button: 'left', clickCount: 1 });
    await poll(
      window,
      `document.getElementById('keyframe-viewport').getBoundingClientRect().height > ${resizeHandle.height + 50}`,
      5000,
      'the inline preview to grow after dragging its resize handle'
    );
    check(
      'dragging the inline resize handle really grows the preview without opening the lightbox',
      await js("!document.getElementById('keyframe-dialog').open")
    );
    await js("document.getElementById('keyframe-viewport').style.height = ''; true");

    // ------------------------------------------------------------ Editing
    const dragBefore = runtime.dragFileFor(recorded.id);
    await js(`(() => {
      const slider = document.getElementById('keyframe-slider');
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const comment = document.getElementById('keyframe-comment');
      comment.value = 'Added after reopening.';
      comment.dispatchEvent(new Event('input', { bubbles: true }));
      const general = document.getElementById('general-notes');
      general.value = 'Reopened and annotated later.';
      general.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('package-details').open = true;
      document.querySelector('#summary button[aria-controls="transcript-editor"]').click();
      const transcript = document.getElementById('transcript-segment-0');
      transcript.value = 'The settings page stays steady when the list loads.';
      transcript.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await poll(window, "document.getElementById('notes-status').textContent.includes('Saved')", 15000, 'the notes');
    await poll(window, "!document.getElementById('drag-file').disabled", 15000, 'the rebuilt drag zip');

    const run = JSON.parse(fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8'));
    check(
      'the edit is written to run.json, beside the comment that was already there',
      run.notes.general === 'Reopened and annotated later.' &&
        run.notes.frames.map((note) => note.text).join(' | ') === 'Added after reopening. | Spinner never stops here.',
      JSON.stringify(run.notes)
    );
    check('run.json still has no copy of the input chronology', !('inputEvents' in run));
    check(
      'a transcript correction preserves its timestamp, language and model',
      run.transcript.edited &&
        run.transcript.segments[0].text === 'The settings page stays steady when the list loads.' &&
        run.transcript.segments[0].start === 0.6 && run.transcript.segments[0].end === 2.4 &&
        run.transcript.engine === 'whisper.cpp (ggml-small.bin)' &&
        run.transcript.language === 'en'
    );
    check(
      'both transcript files contain the corrected words',
      fs.readFileSync(path.join(recorded.dir, 'transcript.txt'), 'utf8').includes('stays steady') &&
        JSON.parse(fs.readFileSync(path.join(recorded.dir, 'transcript.json'), 'utf8')).segments[0].text.includes('stays steady')
    );
    const notesText = fs.readFileSync(path.join(recorded.dir, 'notes.txt'), 'utf8');
    check(
      'notes.txt is rewritten with both comments',
      notesText.includes('Added after reopening.') && notesText.includes('Spinner never stops here.')
    );
    const brief = fs.readFileSync(path.join(recorded.dir, 'agent-brief.md'), 'utf8');
    check(
      'the brief carries the new comment and still has the input chronology',
      brief.includes('Added after reopening.') && brief.includes('Ctrl+Shift+P') &&
        brief.includes('stays steady') && !brief.includes('page jumps when'),
      brief.slice(0, 120)
    );

    const dragAfter = runtime.dragFileFor(recorded.id);
    check('the prepared drag zip was rebuilt after the edit', Boolean(dragAfter) && dragAfter !== dragBefore);
    const into = path.join(sandbox, 'unzipped');
    if (!unzip(dragAfter, into)) {
      console.log('skip the dragged zip carries the edit — no zip extractor on this machine');
    } else {
      const zipped = fs.readFileSync(path.join(into, 'notes.txt'), 'utf8');
      const zippedBrief = fs.readFileSync(path.join(into, 'agent-brief.md'), 'utf8');
      const zippedTranscript = fs.readFileSync(path.join(into, 'transcript.txt'), 'utf8');
      check(
        'the dragged zip carries the edit and the input chronology',
        zipped.includes('Added after reopening.') && zippedBrief.includes('Ctrl+Shift+P') &&
          zippedTranscript.includes('stays steady')
      );
    }

    await js("document.getElementById('copy-prompt').click(); true");
    await poll(window, "document.getElementById('copy-prompt').textContent.includes('Copied')", 15000, 'copying');
    const copied = String(await clipboard.readText());
    check('the copied prompt names the package where it is', copied.includes(recorded.dir), copied.slice(0, 160));
    check('the copied prompt includes the corrected transcript', copied.includes('stays steady') && !copied.includes('page jumps when'));

    const beforeInvalidEdit = fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8');
    const invalidEdit = await js(`(async () => {
      try {
        await window.feedback.saveEdits('${recorded.id}', { transcriptTexts: ['one', 'two'] });
        return '';
      } catch (error) { return error.message; }
    })()`);
    check(
      'mismatched transcript edits are refused before any package file is changed',
      /segments have changed/.test(invalidEdit) &&
        fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8') === beforeInvalidEdit
    );

    const finalize = pkg.finalize;
    pkg.finalize = () => { throw new Error('Synthetic package write failure'); };
    try {
      await clipboard.writeText('Unchanged while saving fails.');
      await js(`(() => {
        const transcript = document.getElementById('transcript-segment-0');
        transcript.value = 'The settings page stays steady after correction.';
        transcript.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('copy-prompt').click();
      })()`);
      await poll(window, "document.getElementById('transcript-status').textContent.includes('Could not save before copying')", 15000, 'the save error');
      const failedSave = {
        clipboard: await clipboard.readText(),
        dragDisabled: await js("document.getElementById('drag-file').disabled"),
        draft: await js("document.getElementById('transcript-segment-0').value")
      };
      check(
        'a failed save is visible and blocks copying and dragging stale text',
        failedSave.clipboard === 'Unchanged while saving fails.' && failedSave.dragDisabled &&
          failedSave.draft === 'The settings page stays steady after correction.',
        JSON.stringify(failedSave)
      );
    } finally {
      pkg.finalize = finalize;
    }
    await js(`(() => {
      const transcript = document.getElementById('transcript-segment-0');
      transcript.value = 'The settings page stays steady when the list loads.';
      transcript.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('transcript-done').click();
    })()`);
    await poll(window, "document.getElementById('transcript-editor').hidden && document.getElementById('transcript-status').textContent.includes('Saved')", 15000, 'the corrected transcript to save');
    check('Done editing returns to the readable transcript after saving', await js("!document.getElementById('transcript-preview').hidden"));

    await js(`(() => {
      const slider = document.getElementById('keyframe-slider');
      const comment = document.getElementById('keyframe-comment');
      for (const [index, text] of [[2, 'Second visit has its own instructions.'], [5, 'Third visit has different instructions.']]) {
        slider.value = String(index);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        comment.value = text;
        comment.dispatchEvent(new Event('input', { bubbles: true }));
      }
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    check(
      'typing on later visits never overwrites the first visit draft',
      (await js("document.getElementById('keyframe-comment').value")) === 'Added after reopening.'
    );
    await poll(window, "document.getElementById('notes-status').textContent.includes('Saved') && !document.getElementById('drag-file').disabled", 15000, 'occurrence comments and zip');
    const withVisits = JSON.parse(fs.readFileSync(path.join(recorded.dir, 'run.json'), 'utf8'));
    const sameImageNotes = withVisits.notes.frames.filter((note) => note.file === withVisits.keyframes[0].file);
    check(
      'run.json keeps three comments for the same image at the correct visit times',
      JSON.stringify(sameImageNotes.map((note) => note.time)) === '[0.5,3.5,6.5]' &&
        sameImageNotes.map((note) => note.text).join('|') ===
          'Added after reopening.|Second visit has its own instructions.|Third visit has different instructions.',
      JSON.stringify(sameImageNotes)
    );
    check(
      'dictation JSON identifies the second and third visits, not just the reused image',
      withVisits.transcript.segments[1].frameOccurrence === 3 &&
        withVisits.transcript.segments[1].frameTime === 3.5 &&
        withVisits.transcript.segments[3].frameOccurrence === 6 &&
        withVisits.transcript.segments[3].frameTime === 6.5
    );
    check(
      'a sentence crossing screen changes keeps all overlapping visits without changing its timing or text',
      JSON.stringify(withVisits.transcript.segments[4].frameOccurrences.map((frame) => frame.occurrence)) === '[3,4,5]' &&
        withVisits.transcript.segments[4].start === 4.2 && withVisits.transcript.segments[4].end === 5.8 &&
        withVisits.transcript.segments[4].text === 'This sentence spans a screen change.'
    );
    const visitZip = path.join(sandbox, 'visit-zip');
    if (!unzip(runtime.dragFileFor(recorded.id), visitZip)) {
      check('the occurrence zip can be independently extracted', false, 'no zip extractor');
    } else {
      const zippedRun = JSON.parse(fs.readFileSync(path.join(visitZip, 'run.json'), 'utf8'));
      const zippedSpeech = JSON.parse(fs.readFileSync(path.join(visitZip, 'transcript.json'), 'utf8'));
      const zippedNotes = fs.readFileSync(path.join(visitZip, 'notes.txt'), 'utf8');
      const zippedBrief = fs.readFileSync(path.join(visitZip, 'agent-brief.md'), 'utf8');
      check(
        'the zip preserves separate visit notes, their timeline and dictation associations',
        JSON.stringify(zippedRun.notes) === JSON.stringify(withVisits.notes) &&
          zippedNotes.includes('Second visit has its own instructions.') &&
          zippedNotes.includes('Third visit has different instructions.') &&
          zippedBrief.includes('Frame 6 at **00:06.50**') &&
          zippedSpeech.segments[3].frameOccurrence === 6
      );
    }

    // ------------------------------------------------------------ Back and forth
    await openList(4);
    const current = await js(`(() => {
      const row = document.querySelector('.history-item.current');
      return row ? { id: row.dataset.id, badge: row.querySelector('.history-badge').textContent } : null;
    })()`);
    check(
      'the list marks the recording that is open',
      current && current.id === recorded.id && current.badge === 'Open now',
      JSON.stringify(current)
    );
    check(
      'the list shows the edit in the snippet',
      (await js(`document.querySelector('.history-item[data-id="${recorded.id}"] .history-snippet').textContent`)) ===
        'Reopened and annotated later.'
    );
    await js("document.getElementById('history-back').click(); true");
    check('Back returns to the recording that was open', await visible('done'));

    await openList(4);
    await js(`document.querySelector('.history-item[data-id="${recorded.id}"] .history-open').click(); true`);
    await poll(window, "!document.getElementById('state-done').hidden", 15000, 'the corrected recording to reopen');
    check(
      'reopening from disk shows the saved dictation correction',
      (await js("document.getElementById('transcript-preview').textContent")).includes('stays steady')
    );
    const restoredVisits = await js(`(() => {
      const slider = document.getElementById('keyframe-slider');
      return [0, 2, 5].map((index) => {
        slider.value = String(index);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return document.getElementById('keyframe-comment').value;
      });
    })()`);
    check(
      'all three comments remain independent after reopening from disk',
      restoredVisits.join('|') === 'Added after reopening.|Second visit has its own instructions.|Third visit has different instructions.',
      restoredVisits.join(' | ')
    );

    await openList(4);
    await js(`document.querySelector('.history-item[data-id="${imported.id}"] .history-open').click(); true`);
    await poll(
      window,
      `document.getElementById('package-path').textContent === ${JSON.stringify(imported.dir)}`,
      15000,
      'the other recording'
    );
    check(
      'another recording replaces the first on the Done screen',
      (await js("document.getElementById('general-notes').value")) === 'Old general note about the checkout.'
    );
    await poll(window, "document.getElementById('keyframe-image').naturalWidth === 180", 5000, 'the portrait image');
    for (const width of [520, 900]) {
      window.setContentSize(width, 760);
      await poll(window, `Math.abs(window.innerWidth - ${width}) <= 2`, 5000, 'the resized viewport');
      const portrait = await js(`(() => {
        const viewport = document.getElementById('keyframe-viewport');
        const preview = document.getElementById('keyframe-preview');
        const zoom = document.getElementById('keyframe-zoom');
        viewport.style.height = '400px';
        zoom.value = '200';
        zoom.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          height: viewport.getBoundingClientRect().height,
          pictureHeight: preview.getBoundingClientRect().height,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          modal: document.getElementById('keyframe-dialog').open
        };
      })()`);
      check(
        `a portrait preview can be taller and zoomed inline at ${width}px without page overflow`,
        portrait.height > 390 && portrait.pictureHeight > 700 && !portrait.horizontalOverflow && !portrait.modal,
        JSON.stringify(portrait)
      );
    }

    // ------------------------------------------------------------ Folders
    await openList(4);
    await js(`document.querySelector('.history-item[data-id="${broken.id}"] .history-reveal').click(); true`);
    await js("document.getElementById('history-folder').click(); true");
    await poll(window, 'true', 500, 'a moment');
    check(
      'a row opens its own folder and the footer opens the recordings folder',
      opened[0] === broken.dir && opened[1] === recordingsDir,
      opened.join(' | ')
    );

    // ------------------------------------------------------------ Deleting
    await js(`document.querySelector('.history-item[data-id="${unfinished.id}"] .history-delete').click(); true`);
    await poll(window, "document.querySelectorAll('#history-list .history-item').length === 3", 15000, 'the delete');
    check('deleting asks first', questions.length === 1 && /Delete this recording/.test(questions[0].message));
    check(
      'it moves the folder to the Recycle Bin rather than erasing it',
      trashed[0] === unfinished.dir && !fs.existsSync(unfinished.dir),
      trashed.join(' | ')
    );
    check(
      'the list says where it went',
      /Moved to the (Recycle Bin|Trash)/.test(await js("document.getElementById('history-status').textContent"))
    );

    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    await js(`document.querySelector('.history-item[data-id="${recorded.id}"] .history-delete').click(); true`);
    await poll(window, 'true', 500, 'a moment');
    check(
      'cancelling the question keeps the recording',
      fs.existsSync(recorded.dir) && (await rowIds()).includes(recorded.id)
    );

    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await js(`document.querySelector('.history-item[data-id="${imported.id}"] .history-delete').click(); true`);
    await poll(window, "document.querySelectorAll('#history-list .history-item').length === 2", 15000, 'the delete');
    await js("document.getElementById('history-back').click(); true");
    check(
      'after deleting the open recording, Back goes to a new recording rather than to it',
      (await visible('ready')) && !(await visible('done'))
    );

    let refused = '';
    try {
      await js("window.feedback.openRecording('..')");
    } catch (error) {
      refused = error.message;
    }
    let outside = '';
    try {
      await js(`window.feedback.deleteRecording(${JSON.stringify(path.join('..', path.basename(recordingsDir)))})`);
    } catch (error) {
      outside = error.message;
    }
    check(
      'a name that is not a recording is refused before anything is read or deleted',
      /not the name of a recording/.test(refused) && /not the name of a recording/.test(outside),
      `${refused} | ${outside}`
    );
    check('nothing else was moved to the Recycle Bin', trashed.length === 2, trashed.join(' | '));
  } catch (error) {
    check('the run completed without throwing', false, error.message);
  }

  clearTimeout(failsafe);
  finish(checks.some((item) => !item.passed) ? 1 : 0);
});
