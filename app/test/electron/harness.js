'use strict';

// Exercises the whole browser-side media pipeline against a synthetic recording:
// MediaRecorder, the WebM duration trap, seeking, frame signatures, keyframe
// selection, cropping to PNG, and audio decode to a 16 kHz mono WAV.
//
// It uses a canvas and an oscillator instead of a real screen and microphone, so
// it runs on a locked machine and in CI. What it proves is the part this project
// was unsure about: whether Chromium alone can do everything FFmpeg was doing.

const api = window.feedback;
const lib = api.lib;

const WIDTH = 1280;
const HEIGHT = 720;
const SECONDS = 6;
const SCENE_MS = 1500;
const REGION = { x: 200, y: 100, width: 640, height: 360 };

const findings = [];
function record(name, value) {
  findings.push({ name, value });
}

function drawScene(context, index) {
  const palette = ['#101820', '#2d1b4e', '#0f3b2e', '#4a1d1d', '#1b2f4a'];
  context.fillStyle = palette[index % palette.length];
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = '#ffffff';
  context.font = 'bold 120px sans-serif';
  context.fillText(`scene ${index}`, 220, 380);

  // A block inside the crop region, so a cropped frame is verifiably different
  // from an uncropped one.
  context.fillStyle = index % 2 === 0 ? '#ff5c5c' : '#5cff9d';
  context.fillRect(REGION.x + 40, REGION.y + 40, 160, 160);
}

async function recordSynthetic() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');

  let scene = 0;
  drawScene(context, scene);
  const painter = setInterval(() => {
    scene += 1;
    drawScene(context, scene);
  }, SCENE_MS);

  const videoStream = canvas.captureStream(30);

  // About -27 dBFS, which is what real narration measured in this project.
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  gain.gain.value = 0.063;
  oscillator.frequency.value = 220;
  const destination = audioContext.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();

  const combined = new MediaStream([
    videoStream.getVideoTracks()[0],
    destination.stream.getAudioTracks()[0]
  ]);

  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
    (type) => MediaRecorder.isTypeSupported(type)
  );
  record('mimeType', mimeType);

  const chunks = [];
  const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 4e6 });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start(1000);
  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
  recorder.stop();
  await stopped;

  clearInterval(painter);
  oscillator.stop();
  await audioContext.close();
  videoStream.getTracks().forEach((track) => track.stop());

  return new Blob(chunks, { type: mimeType });
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
    video.currentTime = time;
  });
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

async function run() {
  const blob = await recordSynthetic();
  record('videoBytes', blob.size);

  const video = document.getElementById('source');
  video.src = URL.createObjectURL(blob);
  await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));

  // The trap: WebM from MediaRecorder carries no duration in its header.
  record('durationBeforeSeek', video.duration);
  if (!Number.isFinite(video.duration) || video.duration <= 0) await seekTo(video, 1e6);
  record('durationAfterSeek', video.duration);
  record('videoWidth', video.videoWidth);
  record('videoHeight', video.videoHeight);

  const duration = video.duration;
  const interval = lib.sampleIntervalSeconds(duration);
  record('sampleInterval', interval);

  const work = document.createElement('canvas');
  work.width = 32;
  work.height = 18;

  const samples = [];
  for (let time = 0; time < duration; time += interval) {
    const actual = await seekTo(video, time);
    samples.push({ time: actual, signature: signatureOf(video, work) });
  }
  record('sampleCount', samples.length);

  const chosen = lib.selectKeyframes(samples);
  record('keyframeCount', chosen.length);
  record('keyframeTimes', chosen.map((item) => Number(item.time.toFixed(3))));

  const region = lib.clampRegion(REGION, video.videoWidth, video.videoHeight);
  const out = document.createElement('canvas');
  out.width = region.width;
  out.height = region.height;
  const outContext = out.getContext('2d');

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
    frames.push(await canvasToBytes(out));
  }
  record('frameByteSizes', frames.map((frame) => frame.length));
  record('firstFrameSignature', Array.from(frames[0].slice(0, 8)));

  // A cropped frame must not be the whole frame with a different name.
  const notBlank = (() => {
    const data = outContext.getImageData(0, 0, region.width, region.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum > 0;
  })();
  record('croppedFrameHasContent', notBlank);

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
  const channels = [];
  for (let i = 0; i < decoded.numberOfChannels; i += 1) channels.push(decoded.getChannelData(i));
  const mono = lib.mixToMono(channels);
  await audioContext.close();

  record('audioSampleRate', decoded.sampleRate);
  record('audioSampleCount', mono.length);

  const levels = lib.measureLevels(mono);
  const verdict = lib.classifyNarration(levels);
  record('narrationLevel', verdict.level);
  record('narrationRms', Number(levels.rmsDbfs.toFixed(2)));

  const wav = lib.encodeWav(mono, 16000);
  record('wavBytes', wav.length);
  record('wavHeader', String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12)));

  return findings;
}

run().then(
  (result) => window.harnessBridge.done({ ok: true, findings: result }),
  (error) => window.harnessBridge.done({ ok: false, error: error.message, stack: error.stack, findings })
);
