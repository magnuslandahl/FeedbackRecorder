'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { selectKeyframes } = require('../../src/shared/keyframes');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-video-sampling-'));
app.setPath('userData', path.join(sandbox, 'userData'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const failsafe = setTimeout(() => { console.error('Video sampling timed out'); app.exit(1); }, 120000);
  let code = 0;
  try {
    await window.loadFile(path.join(__dirname, 'video-sampling.html'));
    const { result, reference, candidate } = await window.webContents.executeJavaScript('testVideoSampling()');
    console.log(JSON.stringify(result));
    assert.equal(result.mode, 'forward');
    assert.equal(result.identical, true, 'sample RGB and timestamps must match seeking');
    assert.equal(result.errorFallback, true, 'a failed presentation must replay the original sampler');
    assert.equal(result.cancelled, true, 'cancelling must not restart via fallback');
    assert.equal(result.cancelledPending, true, 'cancelling a pending presentation must release its write');
    assert.equal(result.released, true, 'cancel/error must remove the presentation video');
    assert.equal(result.retry, true, 'a subsequent scan must still work');
    assert.deepEqual(selectKeyframes(candidate), selectKeyframes(reference));
    console.log('8/8 video sampling checks passed');
    const variable = await window.webContents.executeJavaScript('testVariableVideoSampling()');
    console.log('variable timing', JSON.stringify(variable));
    assert.equal(variable.mode, 'seek');
    assert.equal(variable.reason, 'block-timing');
    assert.equal(variable.identical, true, 'variable frame durations must preserve native pictures and times');
    assert.ok(variable.seekTimes.includes(0.08), 'a short frame followed by a gap must use the seek renderer');
    assert.ok(variable.seekTimes.includes(0.205), 'an overlapping preceding frame must use the seek renderer');
    console.log('5/5 variable-timing checks passed');
  } catch (error) {
    code = 1;
    console.error(error.stack);
  } finally {
    clearTimeout(failsafe);
    window.destroy();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (error) { /* held until exit on Windows */ }
    app.exit(code);
  }
});
