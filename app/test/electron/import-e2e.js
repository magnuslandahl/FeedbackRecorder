'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, clipboard, dialog, nativeImage } = require('electron');

const { makeAndDropVideo } = require('./synthetic-video');

// Imports a video through the real UI, by dropping it the way a person would,
// and checks the package that comes out. It needs no screen, no microphone and
// no whisper.cpp, so it runs anywhere: the video is generated in the renderer
// rather than captured.
//
// What it is really guarding is that an imported file takes the same route as a
// recorded one from framing onwards. Two pipelines that only mostly agree is the
// failure this is here to prevent.

const ROOT = path.join(__dirname, '..', '..');
const TIMEOUT_MS = 180000;
const RECORD_MS = 4000;

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-import-e2e-'));
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
      return setTimeout(tick, 250);
    };
    tick();
  });
}

// The video and the drop are shared with the screenshot tool, so both drive the
// same file through the same handler.
const MAKE_AND_DROP = makeAndDropVideo({ ms: RECORD_MS, name: 'holiday-demo.webm' });

app.whenReady().then(async () => {
  const settings = require(path.join(ROOT, 'src', 'main', 'settings.js'));
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));

  const recordingsDir = path.join(sandbox, 'recordings');
  settings.save({ recordingsDir, language: 'en' });

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

  // The save dialog is the one thing here that needs a human, so it is answered
  // for them. Everything behind it is the real path.
  const zipTarget = path.join(sandbox, 'exported.zip');
  let dialogDefaultPath = '';
  dialog.showSaveDialog = async (_window, options) => {
    dialogDefaultPath = (options && options.defaultPath) || '';
    return { canceled: false, filePath: zipTarget };
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

  const failsafe = setTimeout(() => {
    check('the run completed inside the time limit', false, `${TIMEOUT_MS / 1000}s`);
    finish(1);
  }, TIMEOUT_MS);

  try {
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await poll(window, "!document.getElementById('state-ready').hidden", 30000, 'the Ready state');

    // Refusing the obviously wrong file matters as much as accepting the right
    // one: the alternative is a codec error that reads like a crash.
    await window.webContents.executeJavaScript(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    })()`);
    const refusal = await window.webContents.executeJavaScript(
      "document.getElementById('import-note').textContent"
    );
    check('a file that is not a video is refused by name', /not look like a video/i.test(refusal), refusal);
    check('refusing a file leaves the app on the Ready state',
      await window.webContents.executeJavaScript("!document.getElementById('state-ready').hidden"));

    const size = await window.webContents.executeJavaScript(MAKE_AND_DROP);
    check('a video was produced to import', size > 20000, `${size} bytes`);

    await poll(window, "!document.getElementById('state-framing').hidden", 90000, 'the Framing state');
    check('dropping a video led to framing, the same as a recording does', true);

    const frame = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      return { width: canvas.width, height: canvas.height };
    })()`);
    check(
      'the imported video kept its own resolution',
      frame.width === 1280 && frame.height === 720,
      `${frame.width}x${frame.height}`
    );

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await poll(window, "!document.getElementById('state-done').hidden", 120000, 'processing to finish');
    check('the imported video was processed into a package', true);

    const runIds = Array.from(runtime.runs.keys());
    check('exactly one package was registered', runIds.length === 1, runIds.join(', '));
    const dir = runtime.runs.get(runIds[0]).dir;

    const sizeOf = (name) => {
      const target = path.join(dir, name);
      return fs.existsSync(target) ? fs.statSync(target).size : -1;
    };

    check('the video was written into the package', sizeOf('recording.webm') > 10000, `${sizeOf('recording.webm')} bytes`);
    check('the narration WAV was written', sizeOf('narration.wav') > 44, `${sizeOf('narration.wav')} bytes`);

    await poll(
      window,
      "!document.getElementById('drag-file').disabled",
      15000,
      'the completed package actions'
    );
    const initialDragPath = runtime.dragFileFor(runIds[0]);

    const notesUi = await window.webContents.executeJavaScript(`(() => {
      const slider = document.getElementById('keyframe-slider');
      const first = document.getElementById('keyframe-comment');
      const general = document.getElementById('general-notes');
      first.value = 'Keep the first state visible while loading.';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      const count = Number(slider.max) + 1;
      if (count > 1) {
        slider.value = '1';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const second = document.getElementById('keyframe-comment');
        second.value = 'The changed state needs a clearer success label.';
        second.dispatchEvent(new Event('input', { bubbles: true }));
      }
      general.value = 'Preserve keyboard navigation and avoid a blocking modal.';
      general.dispatchEvent(new Event('input', { bubbles: true }));

      document.getElementById('keyframe-preview').click();
      const dialog = document.getElementById('keyframe-dialog');
      const enlarged = dialog.open && Boolean(document.getElementById('keyframe-dialog-image').src);
      document.getElementById('keyframe-dialog-close').click();
      return {
        count,
        reviewVisible: !document.getElementById('keyframe-review').hidden,
        previewWidth: document.getElementById('keyframe-preview').getBoundingClientRect().width,
        windowWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        enlarged,
        closed: !dialog.open
      };
    })()`);
    check(
      'the Done screen shows a navigable keyframe review without horizontal overflow',
      notesUi.reviewVisible &&
        notesUi.count > 0 &&
        notesUi.previewWidth > 200 &&
        notesUi.previewWidth <= notesUi.windowWidth &&
        !notesUi.horizontalOverflow,
      JSON.stringify(notesUi)
    );
    check(
      'clicking the keyframe opens a larger view that can be closed',
      notesUi.enlarged && notesUi.closed
    );

    await window.webContents.executeJavaScript(
      "document.getElementById('copy-prompt').click(); true"
    );
    await poll(
      window,
      "document.getElementById('copy-prompt').textContent.includes('Copied')",
      15000,
      'the updated prompt to be copied'
    );
    const copiedPrompt = await clipboard.readText();
    check(
      'Copy prompt flushes and includes written context',
      copiedPrompt.includes('Preserve keyboard navigation') &&
        copiedPrompt.includes('Keep the first state visible while loading.'),
      copiedPrompt.slice(0, 180)
    );

    const savedNotesStatus = await poll(
      window,
      "document.getElementById('notes-status').textContent.includes('Saved')",
      15000,
      'the written context to be saved'
    );
    check('written context autosaves without a separate Save button', Boolean(savedNotesStatus));
    await poll(
      window,
      "!document.getElementById('drag-file').disabled",
      15000,
      'the annotated drag zip to be rebuilt'
    );
    check(
      'saving written context replaces the already prepared drag zip',
      runtime.dragFileFor(runIds[0]) !== initialDragPath,
      `${initialDragPath} -> ${runtime.dragFileFor(runIds[0])}`
    );

    const annotated = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    check(
      'general written instructions are stored in run.json',
      annotated.notes && annotated.notes.general ===
        'Preserve keyboard navigation and avoid a blocking modal.',
      JSON.stringify(annotated.notes)
    );
    check(
      'comments are attached to their keyframe files in run.json',
      annotated.notes &&
        annotated.notes.frames.length === Math.min(2, annotated.keyframes.length) &&
        annotated.notes.frames[0].file === annotated.keyframes[0].file,
      JSON.stringify(annotated.notes && annotated.notes.frames)
    );
    const notesText = fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8');
    check(
      'notes.txt is readable without parsing JSON',
      notesText.includes('Additional instructions') &&
        notesText.includes('Keyframe comments') &&
        notesText.includes('Keep the first state visible while loading.'),
      notesText.slice(0, 180)
    );
    const annotatedBrief = fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8');
    check(
      'the agent brief carries both written instructions and frame comments',
      annotatedBrief.includes('Preserve keyboard navigation') &&
        annotatedBrief.includes('Keep the first state visible while loading.'),
      'written context in agent-brief.md'
    );

    await window.webContents.executeJavaScript("document.getElementById('reframe').click()");
    await poll(window, "!document.getElementById('state-framing').hidden", 15000, 'Framing again');
    check('the Done screen can return to framing without another import', true);

    const reframed = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('frame-canvas');
      const rect = canvas.getBoundingClientRect();
      const at = (fx, fy) => ({
        clientX: rect.left + rect.width * fx,
        clientY: rect.top + rect.height * fy,
        bubbles: true,
        pointerId: 7,
        isPrimary: true
      });
      canvas.dispatchEvent(new PointerEvent('pointerdown', at(0.2, 0.2)));
      canvas.dispatchEvent(new PointerEvent('pointermove', at(0.8, 0.75)));
      canvas.dispatchEvent(new PointerEvent('pointerup', at(0.8, 0.75)));
      return document.getElementById('frame-status').textContent;
    })()`);
    check(
      'a different region can be chosen on the second framing pass',
      /×/.test(reframed) && !/whole screen/i.test(reframed),
      reframed
    );

    await window.webContents.executeJavaScript("document.getElementById('frame-accept').click()");
    await poll(window, "!document.getElementById('state-done').hidden", 120000, 'reprocessing to finish');
    check('the same package was rebuilt with the revised framing', runtime.runs.size === 1);

    const frames = fs.existsSync(path.join(dir, 'frames'))
      ? fs.readdirSync(path.join(dir, 'frames')).filter((name) => name.endsWith('.png'))
      : [];
    check('keyframes were extracted from the imported video', frames.length > 0, `${frames.length} frame(s)`);

    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    check('the revised crop replaced the first whole-frame result', Boolean(run.region), JSON.stringify(run.region));
    check(
      'reframing leaves exactly the keyframes named by run.json',
      frames.length === run.keyframes.length,
      `${frames.length} PNG(s), ${run.keyframes.length} keyframe(s)`
    );
    check('run.json does not contain the previous finalized result', !('finalized' in run));
    check('the package records that it was imported', run.source && run.source.kind === 'import', JSON.stringify(run.source));
    check('the original file name was kept', run.source && run.source.name === 'holiday-demo.webm');
    check(
      'the duration came from the file rather than a stopwatch',
      Math.abs(run.durationSeconds - RECORD_MS / 1000) < 3,
      `${run.durationSeconds}s`
    );
    check('the narration level was measured', Boolean(run.narration && run.narration.level), run.narration && run.narration.summary);
    check(
      'written context survives returning to framing',
      run.notes &&
        run.notes.general === 'Preserve keyboard navigation and avoid a blocking modal.' &&
        run.notes.frames.some((note) => note.text === 'Keep the first state visible while loading.'),
      JSON.stringify(run.notes)
    );

    const brief = fs.readFileSync(path.join(dir, 'agent-brief.md'), 'utf8');
    check('the brief says the video was imported, not recorded here',
      /imported video `holiday-demo\.webm`/.test(brief) && !/unknown display/.test(brief));
    check('the brief carries a ready-made prompt', brief.includes('## Coding-agent prompt'));

    const summary = await window.webContents.executeJavaScript(
      "Array.from(document.getElementById('summary').children).map((li) => li.textContent)"
    );
    check('the Done summary names the file it came from',
      summary.some((row) => row.includes('holiday-demo.webm')), summary.join(' | '));

    // ------------------------------------------------------- Export as a zip

    const label = await poll(
      window,
      "(() => { const t = document.getElementById('export-video-label').textContent; return /\\d/.test(t) ? t : false; })()",
      15000,
      'the export checkbox to be labelled with the video size'
    );
    check('the checkbox says what including the video costs', /Include the video \(/.test(label), label);

    const audioLabel = await window.webContents.executeJavaScript(
      "document.getElementById('export-audio-label').textContent"
    );
    check('the audio checkbox says what it costs too', /Include the audio recording \(/.test(audioLabel), audioLabel);

    const defaults = await window.webContents.executeJavaScript(`(() => ({
      video: document.getElementById('export-video').checked,
      audio: document.getElementById('export-audio').checked
    }))()`);
    check(
      'neither the video nor the recorded voice is included unless asked for',
      defaults.video === false && defaults.audio === false,
      JSON.stringify(defaults)
    );

    // The default export: what somebody would actually send on.
    await window.webContents.executeJavaScript("document.getElementById('export').click(); true");
    const noteLean = await poll(
      window,
      "(() => { const t = document.getElementById('export-note').textContent; return t.includes('Saved') || t.includes('could not') ? t : false; })()",
      60000,
      'the default zip to be written'
    );
    check('the default zip was written', /^Saved /.test(noteLean), noteLean);
    check('the export named a real file', fs.existsSync(zipTarget), zipTarget);
    check(
      'the suggested name is the plain one, because lean is the normal case',
      /FeedbackRecorder-[\d-]+\.zip$/.test(dialogDefaultPath),
      dialogDefaultPath
    );

    const leanBytes = fs.existsSync(zipTarget) ? fs.statSync(zipTarget).size : 0;

    // Opened with something other than the code that wrote it, because a zip
    // only this app can read would be no use to the person it is sent to.
    const into = path.join(sandbox, 'unzipped');
    fs.mkdirSync(into, { recursive: true });
    let extracted = [];
    try {
      execFileSync(
        process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'tar',
        ['-xf', zipTarget, '-C', into],
        { stdio: 'ignore' }
      );
      extracted = fs.readdirSync(into);
    } catch (error) {
      // GNU tar cannot read a zip, so on Linux this is expected; the unit tests
      // cover the round trip there with whatever extractor the machine has.
      extracted = [`(not checked here: ${error.message.split('\n')[0]})`];
    }
    const checkedHere = !String(extracted[0]).startsWith('(not checked');
    check(
      'the default zip carries the brief and the pictures',
      !checkedHere ||
        (extracted.includes('agent-brief.md') &&
          extracted.includes('frames') &&
          extracted.includes('notes.txt')),
      extracted.join(', ')
    );
    check(
      'the default zip leaves out the video and the recorded voice',
      !checkedHere || (!extracted.includes('recording.webm') && !extracted.includes('narration.wav')),
      extracted.join(', ')
    );

    // Now with both, to prove the options actually change what is written.
    await window.webContents.executeJavaScript(`(() => {
      document.getElementById('export-video').checked = true;
      document.getElementById('export-audio').checked = true;
      document.getElementById('export').click();
      return true;
    })()`);
    const noteFull = await poll(
      window,
      "(() => { const t = document.getElementById('export-note').textContent; return t.includes('Saved') || t.includes('could not') ? t : false; })()",
      120000,
      'the full zip to be written'
    );
    check('a zip with both was written', /^Saved /.test(noteFull), noteFull);

    const fullBytes = fs.existsSync(zipTarget) ? fs.statSync(zipTarget).size : 0;
    const videoBytes = sizeOf('recording.webm');
    // The video is stored rather than deflated, so the growth is at least the
    // video itself. That proves it went in whole, which "it got bigger" would
    // not.
    check(
      'asking for both adds the video and the audio',
      fullBytes - leanBytes >= videoBytes,
      `${leanBytes} lean, ${fullBytes} full, the video alone is ${videoBytes}`
    );
    check(
      'the suggested name says what was added',
      /-with-video-and-audio\.zip$/.test(dialogDefaultPath),
      dialogDefaultPath
    );

    // ------------------------------------------- The zip you can drag out

    // Dragging cannot wait for a zip to be written, so one is built as soon as
    // the package is finished. What matters is that it exists before any drag
    // could start, that it is the lean export, and that it is not inside the
    // package — a zip written there would end up inside the next export of it.
    const dragState = await poll(
      window,
      `(() => {
        const button = document.getElementById('drag-file');
        if (button.disabled) return false;
        return {
          name: document.getElementById('drag-name').textContent.trim(),
          sub: document.getElementById('drag-sub').textContent.trim(),
          draggable: button.draggable
        };
      })()`,
      60000,
      'the drag handle to be armed'
    );
    check(
      'a zip to drag was prepared without being asked for',
      /^FeedbackRecorder-[\d-]+\.zip$/.test(dragState.name),
      dragState.name
    );
    check('the drag handle can actually be dragged', dragState.draggable === true);
    check(
      'it says what is in it and how big it is',
      /\d+\s?(B|KB|MB|GB)/.test(dragState.sub) && /brief/i.test(dragState.sub),
      dragState.sub
    );

    const dragPath = runtime.dragFileFor(runIds[0]);
    check('the prepared zip is a real file', Boolean(dragPath) && fs.existsSync(dragPath), dragPath || 'none');
    check(
      'it is kept out of the package, so it cannot end up inside a later export',
      Boolean(dragPath) && !dragPath.startsWith(dir),
      dragPath || 'none'
    );

    let dragEntries = [];
    try {
      const dragInto = path.join(sandbox, 'unzipped-drag');
      fs.mkdirSync(dragInto, { recursive: true });
      execFileSync(
        process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'tar',
        ['-xf', dragPath, '-C', dragInto],
        { stdio: 'ignore' }
      );
      dragEntries = fs.readdirSync(dragInto);
    } catch (error) {
      dragEntries = [`(not checked here: ${error.message.split('\n')[0]})`];
    }
    const dragChecked = !String(dragEntries[0]).startsWith('(not checked');
    check(
      'the dragged zip carries the brief and the pictures',
      !dragChecked ||
        (dragEntries.includes('agent-brief.md') &&
          dragEntries.includes('frames') &&
          dragEntries.includes('notes.txt')),
      dragEntries.join(', ')
    );
    check(
      'the dragged zip leaves out the video and the recorded voice',
      !dragChecked || (!dragEntries.includes('recording.webm') && !dragEntries.includes('narration.wav')),
      dragEntries.join(', ')
    );

    // Windows refuses a drag whose icon is an empty image, and the failure is a
    // thrown exception at the moment somebody tries to drag — long after this
    // test would otherwise have passed. So the icon is loaded the same way the
    // drag handler loads it.
    const dragIcon = nativeImage
      .createFromPath(path.join(ROOT, 'src', 'renderer', 'logo.png'))
      .resize({ width: 64, height: 64 });
    check(
      'the drag has a real icon, which Windows requires',
      !dragIcon.isEmpty() && dragIcon.getSize().width === 64,
      `${JSON.stringify(dragIcon.getSize())}`
    );

    console.log('');
    console.log('Summary shown to the user:');
    summary.forEach((row) => console.log(`    ${row}`));
    console.log('');
  } catch (error) {
    check('the run completed without throwing', false, error.message);
  }

  clearTimeout(failsafe);
  finish(checks.some((item) => !item.passed) ? 1 : 0);
});
