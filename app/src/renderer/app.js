'use strict';

const api = window.feedback;
const lib = api.lib;

const el = (id) => document.getElementById(id);
const STATES = ['ready', 'recording', 'importing', 'framing', 'processing', 'done'];

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

const ui = {
  micSelect: el('mic-select'),
  micMeter: el('mic-meter'),
  micHint: el('mic-hint'),
  micTest: el('mic-test'),
  displayList: el('display-list'),
  permissionPanel: el('permission-panel'),
  permissionList: el('permission-list'),
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
  frameStrip: el('frame-strip'),
  summary: el('summary'),
  warnings: el('warnings'),
  packagePath: el('package-path'),
  copyPrompt: el('copy-prompt'),
  copyNote: el('copy-note'),
  reveal: el('reveal'),
  again: el('again'),
  video: el('source'),
  dropzone: el('dropzone'),
  chooseVideo: el('choose-video'),
  videoFile: el('video-file'),
  importNote: el('import-note'),
  importProgress: el('import-progress'),
  appVersion: el('app-version'),
  exportButton: el('export'),
  exportVideo: el('export-video'),
  exportVideoLabel: el('export-video-label'),
  exportAudio: el('export-audio'),
  exportAudioLabel: el('export-audio-label'),
  exportNote: el('export-note'),
  recordStep: document.querySelector('#steps li[data-step="recording"]')
};

const session = {
  displays: [],
  selectedDisplayId: null,
  settings: null,
  micStream: null,
  micAnalyser: null,
  meterTimer: null,
  recorder: null,
  chunks: [],
  displayStream: null,
  startedAt: 0,
  tickTimer: null,
  run: null,
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
  frameUrls: [],
  stopping: false
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

  // An imported video occupies the same slot in the flow as recording one, but
  // saying "Record" while it is being read would describe something the app is
  // not doing.
  if (ui.recordStep) ui.recordStep.textContent = name === 'importing' ? 'Import' : 'Record';

  const step = STEP_OF[name];
  const reached = STEP_ORDER.indexOf(step);
  document.querySelectorAll('#steps li').forEach((node) => {
    const index = STEP_ORDER.indexOf(node.dataset.step);
    node.classList.toggle('active', index === reached);
    node.classList.toggle('past', index < reached);
  });
}

function note(target, text, tone) {
  target.textContent = text || '';
  target.className = tone ? `hint ${tone}` : 'hint';
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

async function refreshPermissions() {
  const state = await api.permissions();
  session.platform = state.platform;
  const rows = [];

  if (!state.microphone.granted || state.microphone.hint) {
    rows.push({ kind: 'microphone', label: 'Microphone', status: state.microphone.status, hint: state.microphone.hint });
  }
  if (!state.screen.granted) {
    rows.push({ kind: 'screen', label: 'Screen recording', status: state.screen.status, hint: state.screen.hint });
  }

  ui.permissionPanel.hidden = rows.length === 0;
  ui.permissionList.replaceChildren();

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

    if (state.platform === 'darwin') {
      const button = document.createElement('button');
      button.className = 'secondary wide';
      button.textContent = 'Open system settings';
      button.addEventListener('click', async () => {
        await api.openPermissionSettings(row.kind);
      });
      wrap.appendChild(button);
    }

    ui.permissionList.appendChild(wrap);
  });

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
      ? 'The language is detected from what you say. Naming it is more reliable when you already know it.'
      : `Your narration is transcribed as ${lib.describeLanguage(code)}. This is remembered for next time.`;
  note.textContent = describeChoice(current);
  ui.transcriberPanel.appendChild(note);

  select.addEventListener('change', async () => {
    const chosen = lib.normalizeLanguage(select.value);
    note.textContent = describeChoice(chosen);
    session.settings = await api.saveSettings({ language: chosen });
  });
}

async function refreshMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((device) => device.kind === 'audioinput');
  ui.micSelect.replaceChildren();

  if (!mics.length) {
    const option = document.createElement('option');
    option.textContent = 'No microphone found';
    option.value = '';
    ui.micSelect.appendChild(option);
    ui.micSelect.disabled = true;
    return;
  }

  ui.micSelect.disabled = false;
  mics.forEach((mic, index) => {
    const option = document.createElement('option');
    option.value = mic.deviceId;
    option.textContent = mic.label || `Microphone ${index + 1}`;
    ui.micSelect.appendChild(option);
  });

  const preferred = session.settings && session.settings.microphoneId;
  if (preferred && mics.some((mic) => mic.deviceId === preferred)) ui.micSelect.value = preferred;
}

async function refreshDisplays() {
  session.displays = await api.listDisplays();
  ui.displayList.replaceChildren();

  const preferred = session.settings && session.settings.displayId;
  const known = session.displays.some((item) => item.id === preferred);
  session.selectedDisplayId = known ? preferred : (session.displays[0] || {}).id || null;

  session.displays.forEach((display) => {
    const button = document.createElement('button');
    button.className = `display${display.id === session.selectedDisplayId ? ' selected' : ''}`;
    button.type = 'button';

    const image = document.createElement('img');
    if (display.thumbnail) image.src = display.thumbnail;
    image.alt = display.name;
    button.appendChild(image);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = display.name;
    button.appendChild(label);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = display.resolution || '';
    button.appendChild(sub);

    button.addEventListener('click', () => {
      session.selectedDisplayId = display.id;
      Array.from(ui.displayList.children).forEach((child) => child.classList.remove('selected'));
      button.classList.add('selected');
      updateReadiness();
    });

    ui.displayList.appendChild(button);
  });

  // A blank preview means the screen could not be read, which has a different
  // cause on each platform and is worth naming rather than showing an empty box.
  if (session.displays.some((display) => display.thumbnailBlank)) {
    note(
      ui.readyNote,
      session.platform === 'darwin'
        ? 'The screen previews are blank, which means macOS has not granted Screen Recording yet. Approve it in System Settings, then quit and reopen FeedbackRecorder.'
        : 'The screen previews are blank, so Windows refused to read the screen. This happens while the session is locked, in some remote desktop sessions, and on windows that block capture. Recording now would produce a black video.',
      'warn'
    );
  } else {
    note(ui.readyNote, '');
  }
}

async function openMicStream() {
  stopMicStream();
  const deviceId = ui.micSelect.value;
  if (!deviceId) return null;

  try {
    session.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  } catch (error) {
    note(ui.micHint, `The microphone could not be opened: ${error.message}`, 'bad');
    return null;
  }

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

function currentLevel() {
  if (!session.micAnalyser) return 0;
  const { analyser, buffer } = session.micAnalyser;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function paintMeter(node, level) {
  const width = Math.min(1, level * 6);
  node.style.width = `${Math.round(width * 100)}%`;
  node.className = 'meter-fill';
  if (level <= 0.005) node.classList.add('none');
  else if (level < 0.02) node.classList.add('low');
}

async function testMicrophone() {
  ui.micTest.disabled = true;
  ui.micTest.textContent = 'Listening…';
  const stream = await openMicStream();
  if (!stream) {
    ui.micTest.disabled = false;
    ui.micTest.textContent = 'Test microphone';
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
      note(
        ui.micHint,
        verdict.level === 'ok'
          ? `Heard you clearly. Only the microphone is recorded; system audio never is.`
          : `${verdict.summary} ${verdict.advice}`,
        verdict.level === 'ok' ? '' : 'warn'
      );
      ui.micTest.disabled = false;
      ui.micTest.textContent = 'Test microphone';
      stopMicStream();
      paintMeter(ui.micMeter, 0);
      session.micConfirmed = true;
      updateReadiness();
    }
  }, 60);
}

function updateReadiness() {
  ui.start.disabled = !session.selectedDisplayId || !ui.micSelect.value;
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

async function startRecording() {
  ui.start.disabled = true;
  const display = session.displays.find((item) => item.id === session.selectedDisplayId);

  let begun;
  try {
    begun = await api.beginRecording({
      displayId: session.selectedDisplayId,
      microphoneId: ui.micSelect.value
    });
  } catch (error) {
    note(ui.readyNote, `Recording could not start: ${error.message}`, 'bad');
    ui.start.disabled = false;
    return;
  }

  session.run = begun;
  session.degraded = [];
  if (begun.fellBack) {
    session.degraded.push(
      `The chosen display was gone when recording started, so ${begun.display.name} was recorded instead.`
    );
  }
  if (begun.barOnRecordedDisplay) {
    session.degraded.push(
      'The recording controls were on the recorded screen, so they appear in the video. Crop them out when framing if they are in the way.'
    );
  }

  const wanted = display || begun.display;
  let displayStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: wanted.captureWidth },
        height: { ideal: wanted.captureHeight },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
  } catch (error) {
    await api.recordingFinished(begun.runId);
    note(ui.readyNote, `The screen could not be captured: ${error.message}`, 'bad');
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
  if (actual.width && actual.width < wanted.captureWidth * 0.95) {
    session.degraded.push(
      `The screen was captured at ${actual.width}x${actual.height} instead of ${wanted.captureWidth}x${wanted.captureHeight}, so small text in the keyframes may be hard to read.`
    );
  }

  const micStream = await openMicStream();
  if (!micStream) {
    session.degraded.push('No microphone was captured, so this recording has no narration.');
  }

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
  session.recorder.onstop = () => finishRecording();

  // A screen that disappears mid-recording ends the track. The review cannot be
  // performed again from memory, so what was captured is kept and processed.
  videoTrack.addEventListener('ended', () => {
    if (session.stopping) return;
    session.degraded.push('The recorded screen disappeared during the recording, so it stops early.');
    stopRecording();
  });

  session.startedAt = Date.now();
  session.recorder.start(2000);
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

async function finishRecording() {
  session.duration = (Date.now() - session.startedAt) / 1000;
  if (session.displayStream) {
    session.displayStream.getTracks().forEach((track) => track.stop());
    session.displayStream = null;
  }

  session.blob = new Blob(session.chunks, { type: session.chunks[0] ? session.chunks[0].type : 'video/webm' });
  session.chunks = [];

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
      addProgress(`Processing failed: ${error.message}`, 'bad');
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

function signatureOf(video, work) {
  const context = work.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, work.width, work.height);
  const data = context.getImageData(0, 0, work.width, work.height).data;
  const signature = new Uint8Array(work.width * work.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    signature[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return signature;
}

function canvasToBytes(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), 'image/png');
  });
}

async function processRecording() {
  showState('processing');
  ui.progress.replaceChildren();

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
  work.width = 32;
  work.height = 18;

  const samples = [];
  for (let time = 0; time < session.duration; time += interval) {
    const actual = await seekTo(video, time);
    samples.push({ time: actual, signature: signatureOf(video, work) });
  }

  const chosen = lib.selectKeyframes(samples);
  scanning.textContent = `Found ${chosen.length} moment${chosen.length === 1 ? '' : 's'} where the screen changed.`;
  scanning.className = '';

  // Pass two: render the chosen moments at full resolution, cropped. Cropping a
  // frame is free; cropping the video would mean re-encoding all of it for a
  // file no agent opens.
  const rendering = addProgress('Extracting keyframes…', 'pending');
  const out = document.createElement('canvas');
  out.width = region.width;
  out.height = region.height;
  const outContext = out.getContext('2d');

  session.frameUrls.forEach((url) => URL.revokeObjectURL(url));
  session.frameUrls = [];

  const frames = [];
  for (const item of chosen) {
    await seekTo(video, item.time);
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
    frames.push({ time: item.time, score: item.score, data });
    session.frameUrls.push(URL.createObjectURL(new Blob([data], { type: 'image/png' })));
  }

  const written = await api.saveFrames(session.run.runId, frames);
  rendering.textContent = `Saved ${written.length} keyframe${written.length === 1 ? '' : 's'} at ${region.width} × ${region.height}.`;
  rendering.className = '';

  addProgress(session.narration ? session.narration.summary : 'Narration level was not measured.');

  const waiting = addProgress('Transcribing your narration…', 'pending');
  const transcript = await session.transcriptPromise;
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

  const result = await api.finalize(session.run.runId, {
    durationSeconds: session.duration,
    frameSize: session.frameSize,
    region: cropped ? region : null,
    keyframes: written,
    narration: session.narration,
    transcript,
    display: session.run.display,
    degraded: session.degraded
  });

  session.prompt = result.prompt;
  renderDone(result);
}

// --------------------------------------------------------------- Done state

function renderDone(result) {
  const run = result.run;

  // The frames are what is being handed over. Showing them is the only way the
  // user can tell they captured the right thing before sending it.
  ui.frameStrip.replaceChildren();
  session.frameUrls.forEach((url, index) => {
    const image = document.createElement('img');
    image.src = url;
    image.alt = `Keyframe ${index + 1}`;
    ui.frameStrip.appendChild(image);
  });

  const transcript = run.transcript || {};
  const segments = transcript.segments || [];
  const spokenIn =
    transcript.available && segments.length && transcript.language
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
    ['Keyframes', String(run.keyframes.length)],
    [
      'Narration',
      transcript.available && segments.length
        ? `${segments.length} segment${segments.length === 1 ? '' : 's'} transcribed${spokenIn}`
        : 'not transcribed',
      transcript.available && segments.length ? 'good' : 'warn'
    ]
  ];

  ui.summary.replaceChildren();
  rows.forEach(([term, value, tone]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (tone) dd.className = tone;
    ui.summary.append(dt, dd);
  });

  ui.warnings.replaceChildren();
  const notes = [];
  if (run.narration && run.narration.level !== 'ok') {
    notes.push([run.narration.summary, run.narration.advice].filter(Boolean).join(' '));
  }
  (run.degraded || []).forEach((text) => notes.push(text));
  notes.forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    ui.warnings.appendChild(item);
  });

  ui.packagePath.textContent = result.dir;
  showState('done');
  describeExport();
}

// The video and the audio are what make an export big, and the audio is the
// user's own voice, so both are opt-in and each says what it would add rather
// than leaving that to be found out from the resulting file.
async function describeExport() {
  note(ui.exportNote, '');
  ui.exportButton.disabled = false;
  ui.exportVideo.checked = false;
  ui.exportAudio.checked = false;

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
    const plan = await api.exportPlan(session.run.runId);
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
  ui.exportButton.disabled = true;
  const wasLabel = ui.exportButton.textContent;
  ui.exportButton.textContent = 'Saving…';
  note(ui.exportNote, `Writing the zip —${exportSizeHint()}.`);

  try {
    const result = await api.exportSave(session.run.runId, {
      includeVideo: ui.exportVideo.checked,
      includeAudio: ui.exportAudio.checked
    });

    if (result.canceled) {
      note(ui.exportNote, '');
    } else {
      note(
        ui.exportNote,
        `Saved ${result.entries} file${result.entries === 1 ? '' : 's'} as ${lib.formatBytes(result.bytes)}: ${result.path}`,
        'good'
      );
    }
  } catch (error) {
    note(ui.exportNote, `The zip could not be written: ${error.message}`, 'bad');
  } finally {
    ui.exportButton.textContent = wasLabel;
    ui.exportButton.disabled = false;
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

ui.copyPrompt.addEventListener('click', async () => {
  await api.copy(session.prompt);
  ui.copyPrompt.textContent = 'Copied — paste it to your agent';
  setTimeout(() => {
    ui.copyPrompt.textContent = 'Copy prompt for an agent';
  }, 2200);
});
ui.reveal.addEventListener('click', () => api.reveal(session.run.dir));
ui.exportButton.addEventListener('click', () => exportZip());
ui.exportVideo.addEventListener('change', () => {
  if (ui.exportNote.textContent) note(ui.exportNote, '');
});
ui.exportAudio.addEventListener('change', () => {
  if (ui.exportNote.textContent) note(ui.exportNote, '');
});
ui.again.addEventListener('click', () => {
  session.frameUrls.forEach((url) => URL.revokeObjectURL(url));
  session.frameUrls = [];
  if (session.videoUrl) URL.revokeObjectURL(session.videoUrl);
  session.videoUrl = null;
  ui.video.removeAttribute('src');
  session.run = null;
  session.blob = null;
  session.prompt = '';
  session.exportPlan = null;
  note(ui.importNote, '');
  note(ui.exportNote, '');
  showState('ready');
  refreshDisplays().then(updateReadiness);
});

api.onStopRequested(() => stopRecording());
installFramingHandlers();

(async function boot() {
  await showVersion();
  session.settings = await api.loadSettings();
  await refreshPermissions();
  await refreshTranscriber();

  // Device labels stay empty until a capture has been permitted once.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());
  } catch (error) {
    note(ui.micHint, `The microphone is not available: ${error.message}`, 'bad');
  }

  await refreshMicrophones();
  await refreshDisplays();
  updateReadiness();
  showState('ready');
})();
