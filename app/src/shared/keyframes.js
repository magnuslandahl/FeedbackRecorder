'use strict';

// Which frames end up in the package.
//
// The renderer samples the video and reduces each sample to a small color
// signature; this module decides which of those samples are worth keeping,
// using nothing but those signatures, so the decision is testable without a
// video.
//
// Four things it has to get right, in the order they bite:
//
//   1. Notice the change at all. Averaging the difference across the whole
//      picture hides anything that is not full-screen: a dialog covering an
//      eighth of the screen moves the average by an eighth of its own
//      contrast, which lands under any threshold loose enough to ignore video
//      noise. Score the whole frame, the tiles that changed most, and sparse
//      color detail such as selection outlines; any can ask for a frame.
//
//   2. Take the picture once the change has finished. A page load, a fade or a
//      scroll spans several samples, so the first sample over the threshold is
//      the middle of it and the frame that gets kept is half-drawn. After a
//      change is noticed the selector walks forward to the first sample that
//      is quiet again and keeps that one instead.
//
//   3. Not store the same picture twice. Clicking away and coming back is
//      normal in a walkthrough, and the second visit is the same screen. It is
//      recorded as a revisit of a frame already kept, so narration spoken over
//      it still has a picture to point at without a duplicate PNG. Coming back
//      to a screen is also evidence it matters, so a revisited frame is never
//      the one dropped when the budget is tight.
//
//   4. Keep enough of them. The budget scales with how long the recording ran,
//      because a fixed count means a long walkthrough is summarised by a
//      handful of frames minutes apart.

// The grid every signature is reduced to, and the tiles the focus score is
// measured over. The renderer builds signatures to this shape; both ends read
// it from here so they cannot drift apart.
const SIGNATURE = { width: 192, height: 108, channels: 3, columns: 12, rows: 9 };

const DEFAULTS = {
  // Mean absolute difference, 0..1, at which a change is worth a frame.
  threshold: 0.04,
  // A change confined to a small part of the screen has to be that much
  // stronger to count, which is what keeps a cursor or a spinner out.
  focusWeight: 0.3,
  // The share of the frame the focus score is measured over. Roughly the size
  // of the smallest thing worth a picture — a dropdown, not a caret.
  focusShare: 0.03,

  // Thin selection/focus outlines have little area, but change many pixels
  // across an object. Ignore codec noise and compact patches such as pointers.
  detailPixelThreshold: 12,
  detailMinSpan: 12,
  detailWeight: 32,

  // The picture has stopped moving when consecutive samples are this close.
  settleThreshold: 0.02,
  // How long to keep waiting for it to settle before taking what is there.
  maxSettleSeconds: 2.5,

  // Two signatures this close are the same screen seen twice. Tight on
  // purpose: the same page scrolled somewhere else is new information.
  revisitMean: 0.02,
  revisitFocus: 0.09,

  minGapSeconds: 0.6,
  // null means "work it out from how long the recording ran".
  maxCount: null,
  minCount: 4,
  signature: SIGNATURE
};

function signatureFromRgba(data) {
  const signature = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, p = 0; i < data.length; i += 4) {
    signature[p++] = data[i];
    signature[p++] = data[i + 1];
    signature[p++] = data[i + 2];
  }
  return signature;
}

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

// How far apart two samples are, measured three ways.
//
//   mean  — over the whole picture. Catches a page swap.
//   focus — over only the tiles that changed most, so a change confined to a
//           small part of the screen is reported at its own strength instead
//           of being divided by all the pixels that stayed still.
//   detail — the share of pixels with a significant color change, provided
//            they span enough distinct rows or columns to exclude pointers.
//
// Signatures that are not the expected shape cannot be tiled, so they fall
// back to the mean for both. That keeps the function total rather than making
// every caller check.
function compareFrames(a, b, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const shape = opts.signature || SIGNATURE;
  const mean = frameDistance(a, b);

  const pixels = shape.width * shape.height;
  const channels = shape.channels || 1;
  const expected = pixels * channels;
  if (!a || !b || a.length !== expected || b.length !== expected) {
    return { mean, focus: mean, detail: 0 };
  }

  const tiles = shape.columns * shape.rows;
  const tileWidth = shape.width / shape.columns;
  const tileHeight = shape.height / shape.rows;
  const totals = new Float64Array(tiles);
  const counts = new Float64Array(tiles);
  const columns = new Uint8Array(shape.width);
  const rows = new Uint8Array(shape.height);
  let changed = 0;

  for (let i = 0; i < pixels; i += 1) {
    const x = i % shape.width;
    const y = (i / shape.width) | 0;
    const column = Math.min(shape.columns - 1, (x / tileWidth) | 0);
    const row = Math.min(shape.rows - 1, (y / tileHeight) | 0);
    const tile = row * shape.columns + column;
    let maximum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const at = i * channels + channel;
      const delta = Math.abs(a[at] - b[at]);
      totals[tile] += delta;
      maximum = Math.max(maximum, delta);
    }
    counts[tile] += channels;
    if (maximum >= opts.detailPixelThreshold) {
      changed += 1;
      columns[x] = 1;
      rows[y] = 1;
    }
  }

  const means = [];
  for (let tile = 0; tile < tiles; tile += 1) {
    if (counts[tile]) means.push(totals[tile] / counts[tile] / 255);
  }
  means.sort((x, y) => y - x);

  const take = Math.max(1, Math.ceil(means.length * opts.focusShare));
  let sum = 0;
  for (let i = 0; i < take; i += 1) sum += means[i];

  const spread = Math.max(
    columns.reduce((total, value) => total + value, 0),
    rows.reduce((total, value) => total + value, 0)
  );
  return { mean, focus: sum / take, detail: spread >= opts.detailMinSpan ? changed / pixels : 0 };
}

// One number for "how much changed", so frames can be ranked against each
// other when the budget is tight.
function severity(change, opts) {
  return Math.max(change.mean, change.focus * opts.focusWeight, change.detail * opts.detailWeight);
}

function changeScore(a, b, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  return severity(compareFrames(a, b, opts), opts);
}

// How many pictures a recording of this length is allowed. A fixed number is
// what made long walkthroughs unusable: twelve frames over ten minutes is one
// picture per fifty seconds, and everything in between is lost.
function frameBudget(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 0) return 12;
  return Math.max(12, Math.min(80, Math.round(duration / 5)));
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

// From a sample that has just changed, walk forward to the first one where the
// picture has stopped moving. Returns the index to keep.
function settleIndex(list, from, opts) {
  const limit = list[from].time + opts.maxSettleSeconds;
  let i = from;
  while (i + 1 < list.length && list[i + 1].time <= limit) {
    const step = compareFrames(list[i].signature, list[i + 1].signature, opts);
    if (severity(step, opts) < opts.settleThreshold) return i;
    i += 1;
  }
  return i;
}

// The frame already kept that is the same screen as this one, or null.
//
// Returns the record rather than a position: positions move when frames are
// dropped or inserted later on, and every renumbering is a chance to point a
// revisit at the wrong picture. Ordinals are worked out once, at the end.
function findRevisit(pictures, signature, opts) {
  let best = null;
  let closest = Infinity;
  for (const picture of pictures) {
    const change = compareFrames(picture.signature, signature, opts);
    if (change.mean > opts.revisitMean || change.focus > opts.revisitFocus) continue;
    if (change.detail * opts.detailWeight >= opts.threshold) continue;
    if (change.mean < closest) {
      closest = change.mean;
      best = picture;
    }
  }
  return best;
}

function isPicture(entry) {
  return entry.target === null;
}

// Walks the samples once and returns everything worth an entry, in time order.
function walk(list, opts) {
  const first = { index: 0, time: list[0].time, score: 1, target: null };
  const entries = [first];
  const pictures = [{ signature: list[0].signature, entry: first }];

  let reference = list[0];
  let i = 1;

  while (i < list.length) {
    const change = compareFrames(reference.signature, list[i].signature, opts);
    if (severity(change, opts) < opts.threshold) {
      i += 1;
      continue;
    }

    const at = settleIndex(list, i, opts);
    const sample = list[at];
    const score = severity(compareFrames(reference.signature, sample.signature, opts), opts);
    if (score < opts.threshold) {
      i = at + 1;
      continue;
    }

    // Too soon after the last entry. Leave the reference alone so the change is
    // not forgotten — it gets recorded as soon as the gap allows.
    if (sample.time - entries[entries.length - 1].time < opts.minGapSeconds) {
      i = at + 1;
      continue;
    }

    const target = findRevisit(pictures, sample.signature, opts);
    const entry = { index: at, time: sample.time, score, target };
    entries.push(entry);
    if (target === null) pictures.push({ signature: sample.signature, entry });

    reference = sample;
    i = at + 1;
  }

  return entries;
}

// Drops pictures until the budget is met. The first frame and any frame
// somebody came back to are never dropped: a screen worth returning to is
// evidence about what mattered, not a candidate for removal.
//
// Which means the budget can be exceeded, in the one case where more frames
// than the budget were all returned to. Going over is the better failure: the
// alternative is deleting a picture the brief still points at.
function trimPictures(entries, budget) {
  const pictures = entries.filter(isPicture);
  if (pictures.length <= budget) return entries;

  const keep = new Set([pictures[0]]);
  entries.forEach((entry) => {
    if (entry.target) keep.add(entry.target.entry);
  });

  pictures
    .filter((entry) => !keep.has(entry))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(budget - keep.size, 0))
    .forEach((entry) => keep.add(entry));

  return entries.filter((entry) => keep.has(isPicture(entry) ? entry : entry.target.entry));
}

// Give a sparse recording another chance to supply distinct pictures. Matching
// the last known screen is not a return: narration already resolves to it.
function addFloor(entries, list, opts, budget) {
  const wanted = Math.min(opts.minCount, list.length, budget);
  if (entries.length >= wanted) return entries;

  const pictures = entries
    .filter(isPicture)
    .map((entry) => ({ signature: list[entry.index].signature, entry }));
  const used = new Set(entries.map((entry) => entry.index));
  const added = entries.slice();

  for (const candidate of evenlySpacedIndices(list.length, wanted)) {
    if (used.has(candidate)) continue;
    const index = settleIndex(list, candidate, opts);
    if (used.has(index)) continue;
    used.add(index);

    const signature = list[index].signature;
    const target = findRevisit(pictures, signature, opts);
    const previous = added.reduce(
      (last, entry) => entry.index < index && (!last || entry.index > last.index) ? entry : last,
      null
    );
    const previousPicture = previous && (previous.target ? previous.target.entry : previous);
    if (target !== null && (target.entry === previousPicture || target.entry.index > index)) continue;
    const entry = { index, time: list[index].time, score: 0, target };
    added.push(entry);
    if (target === null) pictures.push({ signature, entry });

    if (added.length >= wanted) break;
  }

  return added.sort((a, b) => a.index - b.index);
}

// The one place positions are worked out, once everything that could move a
// frame has already happened.
function numberRevisits(entries) {
  const ordinals = new Map();
  entries.filter(isPicture).forEach((entry, ordinal) => ordinals.set(entry, ordinal));

  return entries
    .filter((entry) => isPicture(entry) || ordinals.has(entry.target.entry))
    .map((entry) => ({
      index: entry.index,
      time: entry.time,
      score: entry.score,
      revisitOf: isPicture(entry) ? null : ordinals.get(entry.target.entry)
    }));
}

// samples: [{ time: seconds, signature: Uint8Array }]
//
// Returns the chosen samples in time order. An entry with revisitOf === null is
// a picture to render and save; an entry with a number is that same screen seen
// again, and the number is the position of the picture it repeats.
function selectKeyframes(samples, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return [];
  if (list.length === 1) return [{ index: 0, time: list[0].time, score: 1, revisitOf: null }];

  const span = list[list.length - 1].time - list[0].time;
  const budget = opts.maxCount == null ? frameBudget(span) : opts.maxCount;

  let entries = walk(list, opts);
  entries = trimPictures(entries, budget);
  entries = addFloor(entries, list, opts, budget);
  return numberRevisits(entries);
}

// Sampling every frame is wasted work; sampling too rarely misses the change
// entirely, and a change that comes and goes between two samples never happened
// as far as the package is concerned. So the interval is bounded at both ends
// rather than being allowed to grow with the recording the way it used to.
//
// What that costs, measured on a 1080p WebM: a seek plus a decode plus a
// downsample is about 40 ms, so 900 samples is a little under 40 seconds. Up to
// half an hour the sample count is what is capped and the scan stays around
// that. Past half an hour the interval has hit its 2 s ceiling instead, so the
// count grows with the recording — an hour costs about 75 seconds, two hours
// about 150. That is the deliberate trade: the alternative is going back to
// intervals that step over whole changes, and on a recording that long the
// transcription it runs beside takes far longer anyway.
function sampleIntervalSeconds(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 0) return 0.25;
  const wanted = duration / 900;
  return Math.min(2, Math.max(0.25, wanted));
}

// What to tell the person waiting, in one line.
function summarize(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const pictures = list.filter((entry) => entry.revisitOf === null).length;
  const revisits = list.length - pictures;
  const frames = `${pictures} moment${pictures === 1 ? '' : 's'} where the screen changed`;
  if (!revisits) return `Found ${frames}.`;
  return `Found ${frames}, and ${revisits} return${revisits === 1 ? '' : 's'} to a screen already captured.`;
}

module.exports = {
  SIGNATURE,
  DEFAULTS,
  signatureFromRgba,
  frameDistance,
  compareFrames,
  changeScore,
  frameBudget,
  selectKeyframes,
  evenlySpacedIndices,
  sampleIntervalSeconds,
  summarize
};
