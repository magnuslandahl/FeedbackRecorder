'use strict';

// Which frames end up in the package.
//
// Evenly spaced screenshots mostly show the same screen several times and miss
// the moment something changed. The renderer samples the video at a fixed
// interval and reduces each sampled frame to a small grayscale signature; this
// module decides which of those samples are worth keeping, using nothing but
// those signatures, so the decision is testable without a video.

const DEFAULTS = {
  threshold: 0.055, // mean per-pixel change, 0..1
  minGapSeconds: 1.2,
  maxCount: 12,
  minCount: 4
};

// Mean absolute difference between two equally sized signatures, 0..1.
function frameDistance(a, b) {
  if (!a || !b) return 1;
  const length = Math.min(a.length, b.length);
  if (!length) return 1;

  let total = 0;
  for (let i = 0; i < length; i += 1) {
    total += Math.abs(a[i] - b[i]);
  }
  return total / length / 255;
}

function evenlySpacedIndices(count, wanted) {
  if (count <= 0 || wanted <= 0) return [];
  if (wanted >= count) return Array.from({ length: count }, (_, i) => i);
  const picked = [];
  for (let i = 0; i < wanted; i += 1) {
    const index = Math.round((i * (count - 1)) / (wanted - 1 || 1));
    if (!picked.includes(index)) picked.push(index);
  }
  return picked;
}

// samples: [{ time: seconds, signature: Uint8Array }]
// Returns the chosen samples in time order, each with the change score that got
// it chosen, so the brief can say why a frame is there.
function selectKeyframes(samples, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return [];
  if (list.length === 1) return [{ index: 0, time: list[0].time, score: 1 }];

  const chosen = [{ index: 0, time: list[0].time, score: 1 }];
  let last = list[0];

  for (let i = 1; i < list.length; i += 1) {
    const sample = list[i];
    const score = frameDistance(last.signature, sample.signature);
    const gap = sample.time - last.time;
    if (score >= opts.threshold && gap >= opts.minGapSeconds) {
      chosen.push({ index: i, time: sample.time, score });
      last = sample;
    }
  }

  let result = chosen;

  if (result.length > opts.maxCount) {
    // Keep the first frame plus the biggest changes, back in time order.
    const rest = result
      .slice(1)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(opts.maxCount - 1, 0))
      .sort((a, b) => a.index - b.index);
    result = [result[0]].concat(rest);
  }

  if (result.length < opts.minCount && list.length > result.length) {
    // A recording of a screen that barely changed still needs frames in it.
    const used = new Set(result.map((item) => item.index));
    const wanted = Math.min(opts.minCount, list.length);
    for (const index of evenlySpacedIndices(list.length, wanted)) {
      if (used.has(index)) continue;
      used.add(index);
      result.push({ index, time: list[index].time, score: 0 });
      if (result.length >= wanted) break;
    }
    result.sort((a, b) => a.index - b.index);
  }

  return result;
}

// Sampling every frame is wasted work; sampling too rarely misses the change.
// Roughly one sample per second, tightened for short recordings so a 10 second
// review still has something to choose from.
function sampleIntervalSeconds(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 0) return 1;
  if (duration <= 20) return 0.5;
  if (duration <= 120) return 1;
  return Math.min(duration / 120, 5);
}

module.exports = {
  DEFAULTS,
  frameDistance,
  selectKeyframes,
  evenlySpacedIndices,
  sampleIntervalSeconds
};
