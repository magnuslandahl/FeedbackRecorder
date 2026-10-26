'use strict';

// Decode forward in sparse batches instead of seeking back to a codec keyframe
// for every analysis image. Draw through an HTMLVideoElement: drawing a
// VideoFrame directly uses different downsampling and changes the selection.
const videoSampling = (() => {
  const OPAQUE_FORMATS = new Set(['I420', 'NV12']);

  function sameSignature(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function sameColor(a, b) {
    return ['primaries', 'transfer', 'matrix', 'fullRange'].every((key) => a[key] === b[key]);
  }

  function ambiguousTime(time, sample, previous, nominalDuration) {
    // Chromium's nominal duration and explicit WebM packet durations can
    // differ. Seek whenever either interpretation has a gap or overlap; using
    // only the initial frame's duration misses variable-timing boundaries.
    if (!(sample.duration > 0) || !Number.isFinite(sample.duration) ||
        time >= sample.timestamp + Math.min(nominalDuration, sample.duration)) return true;
    if (!previous) return false;
    return !(previous.duration > 0) || !Number.isFinite(previous.duration) ||
      time <= previous.timestamp + Math.max(nominalDuration, previous.duration);
  }

  function seekTime(time) {
    // Blink normalizes a seek with MediaTimeForTimeValue, then the player
    // converts that value to microseconds again in Seek. Both truncate. A
    // single conversion differs by a microsecond at some floating-point edges.
    const normalized = Math.trunc(time * 1e6) / 1e6;
    return Math.trunc(normalized * 1e6) / 1e6;
  }

  async function simpleBlockTiming(blob, read = (part) => part.arrayBuffer(), check = () => {}) {
    // Mediabunny normalizes BlockDuration to the next packet timestamp. Native
    // seeking can honor the original duration, so those files must stay on the
    // seek path. Inspect only EBML headers, skipping all encoded payloads.
    const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, BLOCK_GROUP = 0xa0;
    const segmentChildren = new Set([CLUSTER, 0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770]);
    let cache = new Uint8Array(), cacheAt = -1;
    const header = async (at, limit) => {
      check();
      if (at < cacheAt || at + Math.min(12, limit - at) > cacheAt + cache.length) {
        cache = new Uint8Array(await read(blob.slice(at, Math.min(blob.size, at + 1024 * 1024))));
        cacheAt = at;
        check();
      }
      let cursor = at - cacheAt;
      const vint = (id) => {
        const first = cache[cursor++];
        let width = 1;
        while (width <= (id ? 4 : 8) && !(first & (1 << (8 - width)))) width += 1;
        if (width > (id ? 4 : 8) || cacheAt + cursor + width - 1 > limit) throw new Error('webm-header');
        const mask = (1 << (8 - width)) - 1;
        let value = id ? first : first & mask;
        let unknown = !id && value === mask;
        for (let i = 1; i < width; i += 1) {
          const byte = cache[cursor++];
          unknown &&= byte === 255;
          value = value * 256 + byte;
        }
        return { value, unknown };
      };
      const id = vint(true).value, size = vint(false);
      const start = cacheAt + cursor;
      const end = size.unknown ? limit : start + size.value;
      if (!Number.isSafeInteger(end) || end > limit || end <= at) throw new Error('webm-size');
      return { id, start, end, unknown: size.unknown };
    };
    let sawCluster = false;
    let at = 0;
    while (at < blob.size) {
      const top = await header(at, blob.size);
      if (top.id !== SEGMENT) {
        if (top.unknown) return false;
        at = top.end;
        continue;
      }
      at = top.start;
      while (at < top.end) {
        const item = await header(at, top.end);
        if (item.id !== CLUSTER) {
          if (item.unknown) return false;
          at = item.end;
          continue;
        }
        sawCluster = true;
        at = item.start;
        while (at < item.end) {
          const child = await header(at, item.end);
          // Streaming WebM can leave cluster sizes unknown. A level-one
          // element ends that cluster; its encoded payloads were skipped.
          if (item.unknown && segmentChildren.has(child.id)) break;
          if (child.id === BLOCK_GROUP || child.unknown) return false;
          at = child.end;
        }
      }
    }
    return sawCluster;
  }

  async function scanBySeeking({ video, times, seek, signature, check, onProgress }) {
    const samples = [];
    for (const time of times) {
      check();
      const actual = await seek(video, time);
      check();
      samples.push({ time: actual, signature: signature(video) });
      onProgress(samples.length / times.length);
    }
    return { samples, mode: 'seek', fallbackSamples: samples.length };
  }

  async function scanForward(options) {
    const { video: source, blob, times, seek, signature, check, onProgress, cancelled } = options;
    const media = globalThis.Mediabunny;
    if (!media || !globalThis.VideoFrame || !globalThis.MediaStreamTrackGenerator || !blob) {
      throw new Error('forward-unavailable');
    }

    const snapshot = new VideoFrame(source);
    let duration, color;
    try {
      duration = snapshot.duration / 1e6;
      color = snapshot.colorSpace.toJSON();
      if (!OPAQUE_FORMATS.has(snapshot.format) || !(duration > 0)) throw new Error('source-format');
    } finally {
      snapshot.close();
    }

    let stopped = false;
    const cancellation = cancelled && cancelled.then(() => {
      check();
      throw new Error('cancelled');
    });
    // A cancellation can arrive between waits. Attach a handler immediately.
    cancellation?.catch(() => {});
    const wait = async (operation, timeoutMs = 10000) => {
      let timer;
      try {
        return await Promise.race([
          operation,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('forward-timeout')), timeoutMs); }),
          ...(cancellation ? [cancellation] : [])
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    const input = new media.Input({ source: new media.BlobSource(blob), formats: [media.WEBM] });
    let generator, writer, video, iterator, pendingSample;
    try {
      const track = await wait(input.getPrimaryVideoTrack());
      // Keep other codecs, transformed pictures and HDR on the existing path.
      if (!track || await wait(track.getCodec()) !== 'vp9' || !await wait(track.canDecode()) ||
          await wait(track.hasHighDynamicRange())) throw new Error('track-format');
      const matrix = await wait(track.getTransformationMatrix());
      if (!matrix.every((value, index) => value === (index % 4 === 0 ? 1 : 0)) ||
          await wait(track.getCodedWidth()) !== source.videoWidth ||
          await wait(track.getCodedHeight()) !== source.videoHeight ||
          await wait(track.getSquarePixelWidth()) !== source.videoWidth ||
          await wait(track.getSquarePixelHeight()) !== source.videoHeight) throw new Error('track-transform');

      const first = await wait(track.getFirstTimestamp());
      const tick = 1 / await wait(track.getTimeResolution());
      if (!Number.isFinite(first) || first < 0 || !(tick > 0)) throw new Error('track-timing');
      if (!await simpleBlockTiming(blob, (part) => wait(part.arrayBuffer()), check)) throw new Error('block-timing');
      const packets = new media.EncodedPacketSink(track);
      const sink = new media.VideoSampleSink(track, { hardwareAcceleration: 'prefer-software' });
      const sampleTimes = times.map(seekTime);
      iterator = sink.samplesAtTimestamps(sampleTimes.map((time) => Math.max(time, first)))[Symbol.asyncIterator]();

      generator = new MediaStreamTrackGenerator({ kind: 'video' });
      writer = generator.writable.getWriter();
      video = document.createElement('video');
      video.muted = true;
      video.className = 'sampling-source';
      video.setAttribute('aria-hidden', 'true');
      document.body.appendChild(video);
      video.srcObject = new MediaStream([generator]);
      let playbackError;
      video.play().catch((error) => { playbackError = error; });

      const samples = [];
      let fallbackSamples = 0;
      let calibrated = false;
      for (let index = 0; index < times.length; index += 1) {
        check();
        const pending = iterator.next();
        // Disposal can overtake a decode that is still completing.
        pending.then((result) => {
          if (stopped) result.value?.close();
          else pendingSample = result.value;
        }, () => {});
        const { value: sample, done } = await wait(pending);
        pendingSample = null;
        if (done || !sample) throw new Error('missing-sample');
        let frame, callback;
        try {
          frame = sample.toVideoFrame();
          if (!OPAQUE_FORMATS.has(frame.format) || !sameColor(color, frame.colorSpace.toJSON()) ||
              frame.displayWidth !== source.videoWidth || frame.displayHeight !== source.videoHeight) {
            throw new Error('decoded-format');
          }
          if (playbackError) throw playbackError;
          // Chromium quantizes currentTime to integer microseconds. Retain that
          // grid without causing another source-video seek for each sample.
          const time = sampleTimes[index];
          const gap = ambiguousTime(time, sample, null, duration);
          const previous = !gap && sample.timestamp > first
            ? await wait(packets.getPacket(sample.timestamp - tick / 2, { metadataOnly: true })) : null;
          let rgb;
          if (ambiguousTime(time, sample, previous, duration)) {
            // Gaps and overlapping frame durations can make a seek select a
            // different picture. Preserve the original answer at those times.
            const actual = await seek(source, times[index]);
            check();
            if (actual !== time) throw new Error('seek-timing');
            rgb = signature(source);
            fallbackSamples += 1;
          } else {
            const presented = new Promise((resolve) => { callback = video.requestVideoFrameCallback(resolve); });
            const copy = new VideoFrame(frame, { timestamp: Math.round(performance.now() * 1000) });
            try {
              await wait(Promise.all([writer.write(copy), presented]), 5000);
            } finally {
              copy.close();
            }
            check();
            rgb = signature(video);
            // Check the actual rendering path before trusting it, and again
            // periodically. A mismatch discards this pass and replays by seek.
            if (!calibrated || index % 100 === 0) {
              const actual = await seek(source, times[index]);
              check();
              if (actual !== time) throw new Error('seek-timing');
              const native = new VideoFrame(source);
              try {
                if (native.duration / 1e6 !== duration || !OPAQUE_FORMATS.has(native.format) ||
                    !sameColor(color, native.colorSpace.toJSON()) || !sameSignature(rgb, signature(source))) {
                  throw new Error('rendering-mismatch');
                }
              } finally {
                native.close();
              }
              calibrated = true;
            }
          }
          samples.push({ time, signature: rgb });
          onProgress(samples.length / times.length);
        } finally {
          if (callback !== undefined) video.cancelVideoFrameCallback(callback);
          frame?.close();
          sample.close();
        }
      }
      return { samples, mode: 'forward', fallbackSamples };
    } finally {
      stopped = true;
      pendingSample?.close();
      input.dispose();
      if (video) { video.pause(); video.srcObject = null; video.remove(); }
      generator?.stop();
      if (writer) await writer.abort().catch(() => {});
      // Input disposal stops any pending decode; don't strand its iterator.
      if (iterator) await iterator.return().catch(() => {});
    }
  }

  async function scan(options) {
    const defaults = { check: () => {}, onProgress: () => {} };
    const settings = { ...defaults, ...options };
    settings.check();
    try {
      return await scanForward(settings);
    } catch (error) {
      // Cancellation must leave the package untouched, not start another pass.
      settings.check();
      return { ...await scanBySeeking(settings), reason: error.message };
    }
  }

  return { scan, scanBySeeking, ambiguousTime, seekTime, simpleBlockTiming };
})();

if (typeof module !== 'undefined') module.exports = videoSampling;
