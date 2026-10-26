'use strict';

async function testVideoSampling() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d', { alpha: false });
  const output = new Mediabunny.Output({ format: new Mediabunny.WebMOutputFormat(), target: new Mediabunny.BufferTarget() });
  const encoder = new Mediabunny.CanvasSource(canvas, { codec: 'vp9', bitrate: 2000000 });
  output.addVideoTrack(encoder, { frameRate: 30 });
  await output.start();
  for (let i = 0; i < 120; i += 1) {
    context.fillStyle = ['#1b2130', '#f2f3f7', '#1b2130', '#8fa4d4'][Math.floor(i / 30)];
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#3788b8';
    context.fillRect(70 + Math.floor(i / 15) * 20, 80, 2, 200);
    context.fillStyle = '#39466b';
    for (let x = 10; x < 640; x += 40) context.fillRect(x, 300, 20, 20);
    await encoder.add(i / 30, 1 / 30);
  }
  await output.finalize();
  const blob = new Blob([output.target.buffer], { type: 'video/webm' });
  const video = document.getElementById('source');
  const url = URL.createObjectURL(blob);
  const seek = (source, time) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { source.removeEventListener('seeked', done); reject(new Error('seek timeout')); }, 5000);
    const done = () => { clearTimeout(timer); source.removeEventListener('seeked', done); resolve(source.currentTime); };
    source.addEventListener('seeked', done);
    source.currentTime = time;
  });
  try {
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; video.src = url; });
    const work = document.createElement('canvas');
    work.width = 192; work.height = 108;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    // Include normal samples and codec timestamp/duration boundaries.
    const times = [0];
    for (let time = 0.017; time < 3.98; time += 0.07113) times.push(time);
    const signature = (source) => {
      ctx.drawImage(source, 20, 10, 600, 340, 0, 0, 192, 108);
      const rgba = ctx.getImageData(0, 0, 192, 108).data;
      const rgb = new Uint8Array(192 * 108 * 3);
      for (let p = 0, q = 0; p < rgba.length; p += 4) {
        rgb[q++] = rgba[p]; rgb[q++] = rgba[p + 1]; rgb[q++] = rgba[p + 2];
      }
      return rgb;
    };
    const options = { video, blob, times, seek, signature, check() {}, onProgress() {} };
    const reference = await videoSampling.scanBySeeking(options);
    const candidate = await videoSampling.scan(options);
    const equal = (samples) => samples.length === reference.samples.length && samples.every((sample, i) =>
      sample.time === reference.samples[i].time && sample.signature.every((value, p) => value === reference.samples[i].signature[p]));
    const result = { mode: candidate.mode, samples: candidate.samples.length, identical: equal(candidate.samples), fallbackSamples: candidate.fallbackSamples, reason: candidate.reason };

    // Exercise failure after decoding has started, not just feature detection.
    const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
    try {
      HTMLVideoElement.prototype.requestVideoFrameCallback = () => { throw new Error('presentation failed'); };
      const fallback = await videoSampling.scan(options);
      result.errorFallback = fallback.mode === 'seek' && equal(fallback.samples);
    } finally { HTMLVideoElement.prototype.requestVideoFrameCallback = request; }

    let cancelled = false;
    let cancel;
    let callbacks = 0;
    const cancellation = new Promise((resolve) => { cancel = resolve; });
    try {
      await videoSampling.scan({ ...options, cancelled: cancellation,
        check: () => { if (cancelled) throw new Error('cancelled by user'); },
        onProgress: () => { callbacks += 1; cancelled = true; cancel(); }
      });
      result.cancelled = false;
    } catch (error) {
      result.cancelled = error.message === 'cancelled by user' && callbacks === 1;
    }

    // Also interrupt a wait for a compositor frame, rather than only the
    // boundary between two iterations. Cleanup must release the pending write.
    let pendingCancelled = false;
    let interrupt;
    const pendingCancellation = new Promise((resolve) => { interrupt = resolve; });
    try {
      HTMLVideoElement.prototype.requestVideoFrameCallback = () => {
        setTimeout(() => { pendingCancelled = true; interrupt(); }, 0);
        return 0;
      };
      await videoSampling.scan({ ...options, cancelled: pendingCancellation,
        check: () => { if (pendingCancelled) throw new Error('cancelled during presentation'); }
      });
      result.cancelledPending = false;
    } catch (error) {
      result.cancelledPending = error.message === 'cancelled during presentation';
    } finally { HTMLVideoElement.prototype.requestVideoFrameCallback = request; }
    result.released = document.querySelectorAll('.sampling-source').length === 0;
    const repeated = await videoSampling.scan(options);
    result.retry = repeated.mode === 'forward' && equal(repeated.samples);
    // Return owned buffers to the main process for the unchanged selector.
    return { result, reference: reference.samples, candidate: candidate.samples };
  } finally {
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
