'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-pause-'));
app.setPath('userData', path.join(sandbox, 'userData'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
function check(name, passed, detail) {
  assert.ok(passed, `${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`);
  console.log(`ok ${++checks} ${name}`);
}

app.whenReady().then(async () => {
  let window;
  let bar;
  const failsafe = setTimeout(() => { console.error('Pause test timed out'); app.exit(1); }, 180000);
  let code = 0;
  try {
    // No real screen, microphone, input hooks, permissions, or transcriber is
    // used. The production renderer, recorder, preload and runtime still run.
    const display = {
      id: 'synthetic', name: 'Synthetic display', kind: 'screen',
      bounds: { x: 0, y: 0, width: 320, height: 180 },
      captureWidth: 320, captureHeight: 180, width: 320, height: 180, scaleFactor: 1
    };
    const displays = require('../../src/main/displays');
    displays.listDisplays = async () => [display];
    displays.resolveDisplay = async () => ({ display, fellBack: false });
    const permissions = require('../../src/main/permissions');
    permissions.prime = async () => true;
    permissions.describe = () => ({
      platform: process.platform, microphone: { granted: true }, screen: { granted: true }
    });
    require('../../src/main/whisper').transcribe = async () => ({
      available: true, segments: [
        { start: 0.2, end: 0.8, text: 'Before interruption.' },
        { start: 1.8, end: 2.1, text: 'After resuming, the green screen.' }
      ]
    });
    require('../../src/main/settings').save({
      recordingsDir: path.join(sandbox, 'recordings'),
      captureInputActivity: false, language: 'en'
    });
    const preferences = {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false
    };
    window = new BrowserWindow({ show: false, webPreferences: preferences });
    const windows = {
      hideMain() {}, showMain() {},
      openBar() {
        if (bar) bar.destroy();
        bar = new BrowserWindow({ width: 424, height: 44, frame: false, show: false, webPreferences: preferences });
        void bar.loadFile(path.join(ROOT, 'src', 'renderer', 'bar.html'));
        return { onRecordedDisplay: false };
      },
      closeBar() {},
      sendToMain: (channel, value) => window.webContents.send(channel, value),
      sendToBar: (channel, value) => bar?.webContents.send(channel, value)
    };
    const runtime = require('../../src/main/runtime').createRuntime({ appRoot: ROOT, windows });
    runtime.registerIpc();
    ipcMain.removeHandler('input:status');
    ipcMain.handle('input:status', () => ({ supported: false }));
    const run = (script) => window.webContents.executeJavaScript(script, true);
    async function waitFor(target, script) {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (await target.webContents.executeJavaScript(script)) return;
        await sleep(30);
      }
      throw new Error(`Timed out: ${script}`);
    }
    async function pause(paused) {
      await bar.webContents.executeJavaScript("document.getElementById('pause').click()");
      await waitFor(window, `session.paused === ${paused}`);
      await waitFor(bar, `document.getElementById('pause').textContent === '${paused ? 'Resume' : 'Pause'}' && !document.getElementById('pause').disabled`);
    }
    async function start(microphone = true) {
      await run(`(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ff0000';
        context.fillRect(0, 0, 320, 180);
        const audio = new AudioContext();
        await audio.resume();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0.15;
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        window.synthetic = {
          color: '#ff0000', audio, oscillator, stream: canvas.captureStream(30),
          phase(color, frequency) {
            this.color = color;
            oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
          }
        };
        synthetic.phase('#ff0000', 440);
        synthetic.paint = setInterval(() => {
          context.fillStyle = synthetic.color;
          context.fillRect(0, 0, 320, 180);
          context.fillStyle = '#ffffff';
          context.fillRect(280 + Math.floor(performance.now() / 20) % 30, 160, 4, 4);
        }, 20);
        // Warm the synthetic source so its first-frame startup is not mistaken
        // for time lost by Pause/Resume.
        const preview = document.createElement('video');
        preview.muted = true;
        preview.srcObject = synthetic.stream;
        await preview.play();
        await new Promise(resolve => preview.requestVideoFrameCallback(resolve));
        preview.pause();
        preview.srcObject = null;
        navigator.mediaDevices.getDisplayMedia = async () => synthetic.stream;
        navigator.mediaDevices.getUserMedia = async () => destination.stream;
        ui.micSelect.replaceChildren(new Option('Synthetic microphone', 'synthetic-mic'), new Option('No microphone', ''));
        ui.micSelect.value = ${JSON.stringify(microphone ? 'synthetic-mic' : '')};
        await startRecording();
      })()`);
      await waitFor(bar, "Boolean(document.getElementById('pause') && !document.getElementById('pause').disabled)");
    }
    async function releaseSource() {
      await run('clearInterval(synthetic.paint); synthetic.oscillator.stop(); synthetic.audio.close()');
    }
    await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await waitFor(window, "!document.getElementById('start').disabled");
    await start();
    await sleep(1200);
    let pauseRequests = 0;
    ipcMain.on('bar:pause', () => { pauseRequests += 1; });
    await bar.webContents.executeJavaScript("document.getElementById('pause').click(); document.getElementById('pause').click()");
    await waitFor(window, 'session.paused');
    await waitFor(bar, "!document.getElementById('pause').disabled");
    check('rapid clicks send a single pause request', pauseRequests === 1);
    const frozen = await run(`({
      elapsed: lib.recordingElapsed(recordingWallTime(), session.pauses),
      muted: session.micStream.getAudioTracks().every(track => !track.enabled),
      recorder: session.recorder.state
    })`);
    check('Pause suspends the real MediaRecorder and disables the microphone track', frozen.muted && frozen.recorder === 'paused', frozen);
    await run("synthetic.phase('#ff00ff', 1900)");
    await sleep(2200);
    const pausedState = await bar.webContents.executeJavaScript(`({
      time: document.getElementById('time').textContent,
      label: document.getElementById('recording-status').textContent,
      level: document.getElementById('mic-level').getAttribute('aria-valuenow'),
      mic: document.getElementById('mic-level').getAttribute('aria-label'),
      animation: getComputedStyle(document.querySelector('.dot')).animationName,
      stopEnabled: !document.getElementById('stop').disabled
    })`);
    const elapsed = await run('lib.recordingElapsed(recordingWallTime(), session.pauses)');
    check('paused time is frozen and the controller reports a muted microphone',
      Math.abs(elapsed - frozen.elapsed) < 0.01 && pausedState.label === 'Paused' &&
      pausedState.level === '0' && pausedState.mic === 'Microphone muted' &&
      pausedState.animation === 'none' && pausedState.stopEnabled, pausedState);
    await run("synthetic.phase('#00ff00', 880)");
    await sleep(80);
    await pause(false);
    check('Resume restores the same microphone and recording', await run("session.recorder.state === 'recording' && session.micStream.getAudioTracks().every(track => track.enabled)"));
    await sleep(1200);
    await pause(true);
    await run("synthetic.phase('#ff00ff', 1900)");
    await sleep(900);
    await run("synthetic.phase('#0000ff', 660)");
    await sleep(80);
    await pause(false);
    await sleep(1200);
    await pause(true);
    await run("synthetic.phase('#ff00ff', 1900)");
    await sleep(700);
    const expected = await run('lib.recordingElapsed(recordingWallTime(), session.pauses)');
    await bar.webContents.executeJavaScript("document.getElementById('stop').click()");
    await waitFor(window, "!document.getElementById('state-framing').hidden");
    await releaseSource();
    const media = await run(`(async () => {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await session.blob.arrayBuffer());
      const data = decoded.getChannelData(0);
      function amplitude(time, frequency) {
        const start = Math.floor(time * decoded.sampleRate);
        const length = Math.min(Math.floor(decoded.sampleRate * 0.15), data.length - start);
        let real = 0, imaginary = 0;
        for (let i = 0; i < length; i++) {
          const angle = 2 * Math.PI * frequency * i / decoded.sampleRate;
          real += data[start + i] * Math.cos(angle);
          imaginary += data[start + i] * Math.sin(angle);
        }
        return Math.hypot(real, imaginary) * 2 / length;
      }
      const centers = [
        session.pauses[0].start / 2,
        session.pauses[0].start + (session.pauses[1].start - session.pauses[0].end) / 2,
        lib.recordingElapsed(session.pauses[1].end, session.pauses) + 0.5
      ];
      const audio = centers.map((time, index) => amplitude(time, [440, 880, 660][index]));
      let privateAudio = 0;
      for (let time = 0; time <= decoded.duration - 0.15; time += 0.15) {
        privateAudio = Math.max(privateAudio, amplitude(time, 1900));
      }
      privateAudio = Math.max(privateAudio, amplitude(decoded.duration - 0.15, 1900));
      const colors = [];
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const drawing = canvas.getContext('2d');
      for (const time of centers) {
        await seekTo(ui.video, time);
        drawing.drawImage(ui.video, 0, 0, 1, 1);
        colors.push(Array.from(drawing.getImageData(0, 0, 1, 1).data).slice(0, 3));
      }
      let privateFrames = 0;
      let decodedFrames = 0;
      const input = new Mediabunny.Input({ source: new Mediabunny.BlobSource(session.blob), formats: [Mediabunny.WEBM] });
      try {
        const sink = new Mediabunny.VideoSampleSink(await input.getPrimaryVideoTrack());
        for await (const sample of sink.samples()) {
          try {
            sample.draw(drawing, 0, 0, 1, 1);
            const [r,g,b] = drawing.getImageData(0, 0, 1, 1).data;
            if (r > 150 && b > 150 && g < 80) privateFrames++;
            decodedFrames++;
          } finally {
            sample.close();
          }
        }
      } finally {
        input.dispose();
      }
      await context.close();
      return { duration: session.duration, audioDuration: decoded.duration, audio, privateAudio, colors, privateFrames, decodedFrames };
    })()`);
    check('saved video and decoded narration both exclude all pauses',
      Math.abs(media.duration - expected) < 0.35 && Math.abs(media.audioDuration - expected) < 0.35, { expected, ...media });
    check('narration before and after each resume stays on the video timeline', media.audio.every((level) => level > 0.08), media.audio);
    check('interruption-only audio is absent from the entire decoded narration', media.privateAudio < 0.01, media.privateAudio);
    check('active pictures are red, green, then blue at the matching narration times',
      media.colors.every((rgb, index) => rgb[index] > 180 && rgb.filter((_, channel) => channel !== index).every((value) => value < 60)), media.colors);
    check('interruption-only pictures are absent from every decoded video frame',
      media.privateFrames === 0 && media.decodedFrames > 20, media.decodedFrames);
    await run("document.getElementById('frame-accept').click()");
    await waitFor(window, "!document.getElementById('state-done').hidden");
    const completed = [...runtime.runs.values()][0];
    const saved = JSON.parse(fs.readFileSync(path.join(completed.dir, 'run.json'), 'utf8'));
    check('the finalized package uses the shortened duration', Math.abs(saved.durationSeconds - expected) < 0.35, saved.durationSeconds);
    const speech = saved.transcript.segments[1];
    const [blue, green, red] = nativeImage.createFromPath(path.join(completed.dir, speech.frame))
      .resize({ width: 1, height: 1 }).toBitmap();
    check('post-resume dictation references the matching green frame occurrence',
      green > 180 && red < 60 && blue < 60 && speech.frameTime <= speech.start, speech);
    check('Stop while paused releases capture tracks', await run('session.micStream === null && session.displayStream === null'));

    await start(false);
    await sleep(350);
    await pause(true);
    check('recording without a microphone can also pause', await run("session.paused && session.micStream === null && session.recorder.state === 'paused'"));
    await pause(false);
    await sleep(250);
    await pause(true);
    const discardId = await run('session.run.runId');
    window.webContents.send('recording:discardRequested');
    await waitFor(window, "!document.getElementById('state-ready').hidden && session.run === null");
    check('discarding while paused removes only that unfinished package',
      !fs.existsSync(path.join(sandbox, 'recordings', discardId)) && fs.existsSync(completed.dir));
    await releaseSource();
    await start();
    await sleep(300);
    await run("session.recorder.pause = () => { throw new Error('Synthetic encoder failure'); }; true");
    await bar.webContents.executeJavaScript("document.getElementById('pause').click()");
    await waitFor(window, "!document.getElementById('state-framing').hidden");
    check('a pause failure stops safely, releases the microphone, and explains the failure',
      await run("session.micStream === null && session.degraded.some(reason => reason.includes('Synthetic encoder failure'))"));
    await releaseSource();
    await start();
    await sleep(350);
    await pause(true);
    await run("session.recorder.resume = () => { throw new Error('Synthetic resume failure'); }; true");
    await bar.webContents.executeJavaScript("document.getElementById('pause').click()");
    await waitFor(window, "!document.getElementById('state-framing').hidden");
    check('a resume failure never unmutes the microphone or claims recording resumed',
      await run("session.paused && session.micStream === null && session.degraded.some(reason => reason.includes('Synthetic resume failure'))"));
    await releaseSource();
    await start();
    await sleep(350);
    ipcMain.removeHandler('recording:pauses');
    ipcMain.handle('recording:pauses', () => { throw new Error('Synthetic timing update failure'); });
    await bar.webContents.executeJavaScript("document.getElementById('pause').click()");
    await waitFor(window, "!document.getElementById('state-framing').hidden");
    check('a failed input-timing update stops safely and is reported instead of ignored',
      await run("session.micStream === null && session.degraded.some(reason => reason.includes('Synthetic timing update failure'))"));
    await releaseSource();
    console.log(`${checks}/${checks} pause checks passed`);
  } catch (error) {
    code = 1;
    console.error(error.stack);
  } finally {
    clearTimeout(failsafe);
    if (bar && !bar.isDestroyed()) bar.destroy();
    if (window && !window.isDestroyed()) window.destroy();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (error) { /* held until exit on Windows */ }
    app.exit(code);
  }
});
