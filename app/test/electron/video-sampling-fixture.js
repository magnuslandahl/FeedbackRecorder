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

// Keep this fixture generated: five independent VP9 pictures with explicit
// WebM BlockDuration values. The normal muxer writes SimpleBlocks and discards
// their durations, which would silently remove the gap/overlap under test.
function withBlockDurations(buffer, durations) {
  const bytes = new Uint8Array(buffer);
  const join = (...parts) => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  };
  const vint = (value) => {
    let width = 1;
    while (value >= 2 ** (7 * width) - 1) width += 1;
    const result = new Uint8Array(width);
    for (let i = width - 1; i >= 0; i -= 1) { result[i] = value % 256; value = Math.floor(value / 256); }
    result[0] |= 1 << (8 - width);
    return result;
  };
  const element = (id, data) => join(new Uint8Array(id), vint(data.length), data);
  const readVint = (at, id) => {
    let width = 1;
    while (!(bytes[at] & (1 << (8 - width)))) width += 1;
    let value = id ? bytes[at] : bytes[at] & ((1 << (8 - width)) - 1);
    for (let i = 1; i < width; i += 1) value = value * 256 + bytes[at + i];
    return { width, value };
  };
  const elements = (start, end) => {
    const result = [];
    for (let at = start; at < end;) {
      const id = readVint(at, true);
      const size = readVint(at + id.width, false);
      const dataAt = at + id.width + size.width;
      const next = Math.min(end, dataAt + size.value);
      result.push({ id: id.value, data: bytes.slice(dataAt, next), raw: bytes.slice(at, next), dataAt, end: next });
      at = next;
    }
    return result;
  };
  const top = elements(0, bytes.length);
  const segment = top.find((item) => item.id === 0x18538067);
  const children = elements(segment.dataAt, segment.end);
  const cluster = children.find((item) => item.id === 0x1f43b675);
  let index = 0;
  const blocks = elements(cluster.dataAt, cluster.end).map((item) => {
    if (item.id !== 0xa3) return item.raw;
    item.data[3] &= 0x7f; // Block has no SimpleBlock keyframe flag.
    return element([0xa0], join(element([0xa1], item.data), element([0x9b], new Uint8Array([durations[index++]]))));
  });
  if (index !== durations.length) throw new Error('Unexpected generated block count');
  // Drop the old seek/cue offsets because replacing blocks changes positions.
  const metadata = children.filter((item) => item.id === 0x1549a966 || item.id === 0x1654ae6b).map((item) => item.raw);
  return join(top[0].raw, element([0x18, 0x53, 0x80, 0x67], join(...metadata, element([0x1f, 0x43, 0xb6, 0x75], join(...blocks)))));
}

async function testVariableVideoSampling() {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d', { alpha: false });
  const output = new Mediabunny.Output({ format: new Mediabunny.WebMOutputFormat(), target: new Mediabunny.BufferTarget() });
  const encoder = new Mediabunny.CanvasSource(canvas, { codec: 'vp9', bitrate: 1000000 });
  output.addVideoTrack(encoder);
  await output.start();
  const frames = [[0, 0.05], [0.05, 0.02], [0.15, 0.06], [0.18, 0.09], [0.3, 0.05]];
  for (let i = 0; i < frames.length; i += 1) {
    ctx.fillStyle = ['#bd3030', '#30bd30', '#3030bd', '#bdbd30', '#bd30bd'][i];
    ctx.fillRect(0, 0, 320, 180);
    await encoder.add(...frames[i], { keyFrame: true });
  }
  await output.finalize();
  const blob = new Blob([withBlockDurations(output.target.buffer, [50, 20, 60, 90, 50])], { type: 'video/webm' });
  const video = document.getElementById('source');
  const url = URL.createObjectURL(blob);
  const seek = (source, time) => new Promise((resolve) => {
    source.addEventListener('seeked', () => resolve(source.currentTime), { once: true }); source.currentTime = time;
  });
  try {
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; video.src = url; });
    const work = document.createElement('canvas'); work.width = 192; work.height = 108;
    const context = work.getContext('2d', { willReadFrequently: true }); context.imageSmoothingQuality = 'high';
    const signature = (source) => {
      context.drawImage(source, 0, 0, 320, 180, 0, 0, 192, 108);
      return new Uint8Array(context.getImageData(0, 0, 192, 108).data);
    };
    const times = [0, 0.061, 0.08, 0.16, 0.19, 0.205, 0.25, 0.32];
    const options = { video, blob, times, signature, seek, check() {}, onProgress() {} };
    const reference = await videoSampling.scanBySeeking(options);
    await seek(video, 0);
    const seekTimes = [];
    const candidate = await videoSampling.scan({ ...options, seek: async (source, time) => { seekTimes.push(time); return seek(source, time); } });
    return {
      mode: candidate.mode, reason: candidate.reason, seekTimes,
      identical: candidate.samples.every((sample, i) => sample.time === reference.samples[i].time &&
        sample.signature.every((value, p) => value === reference.samples[i].signature[p]))
    };
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
