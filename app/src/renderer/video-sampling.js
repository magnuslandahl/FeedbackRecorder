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

  function ambiguousTime(time, timestamp, precedingTimestamp, duration) {
    return time >= timestamp + duration ||
      (precedingTimestamp !== null && time <= precedingTimestamp + duration);
  }

  function seekTime(time) {
    // Blink normalizes a seek with MediaTimeForTimeValue, then the player
    // converts that value to microseconds again in Seek. Both truncate. A
    // single conversion differs by a microsecond at some floating-point edges.
    const normalized = Math.trunc(time * 1e6) / 1e6;
    return Math.trunc(normalized * 1e6) / 1e6;
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
          const gap = time >= sample.timestamp + duration;
          const previous = !gap && sample.timestamp > first
            ? await wait(packets.getPacket(sample.timestamp - tick / 2, { metadataOnly: true })) : null;
          let rgb;
          if (ambiguousTime(time, sample.timestamp, previous?.timestamp ?? null, duration)) {
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

  return { scan, scanBySeeking, ambiguousTime, seekTime };
})();

if (typeof module !== 'undefined') module.exports = videoSampling;
