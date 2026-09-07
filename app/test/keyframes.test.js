'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  SIGNATURE,
  frameDistance,
  compareFrames,
  changeScore,
  frameBudget,
  selectKeyframes,
  sampleIntervalSeconds,
  summarize
} = require('../src/shared/keyframes');

const AREA = SIGNATURE.width * SIGNATURE.height;

// The old tests used flat arrays of one value, which cannot tell a dialog from
// a full-screen change: every pixel differs by the same amount either way. The
// signatures here are laid out like a screen, so a change can be given a size
// and a place, which is the whole point of what is being tested.

function screen(background) {
  return new Uint8Array(AREA).fill(background);
}

// Paints a rectangle given in fractions of the screen — 0.14 x 0.2 is about a
// dropdown, 0.3 x 0.3 about a dialog, 0.012 x 0.02 about a mouse pointer.
function paint(base, area) {
  const out = Uint8Array.from(base);
  const left = Math.round(area.x * SIGNATURE.width);
  const top = Math.round(area.y * SIGNATURE.height);
  const right = Math.min(SIGNATURE.width, Math.round((area.x + area.w) * SIGNATURE.width));
  const bottom = Math.min(SIGNATURE.height, Math.round((area.y + area.h) * SIGNATURE.height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      out[row * SIGNATURE.width + column] = area.value;
    }
  }
  return out;
}

// What a codec does to a picture that did not change: everything moves a
// little. Deterministic so a failure is reproducible.
function noisy(base, amount) {
  const out = Uint8Array.from(base);
  for (let i = 0; i < out.length; i += 1) {
    const wobble = ((i * 2654435761) % 1000) / 1000; // 0..1, no RNG
    out[i] = Math.max(0, Math.min(255, out[i] + Math.round((wobble - 0.5) * 2 * amount)));
  }
  return out;
}

function flat(value, length) {
  return new Uint8Array(length || 64).fill(value);
}

function samplesOf(entries) {
  return entries.map(([time, signature]) => ({ time, signature }));
}

function pictures(chosen) {
  return chosen.filter((entry) => entry.revisitOf === null);
}

// ------------------------------------------------------------------ scoring

test('identical frames are zero apart and opposites are one', () => {
  assert.strictEqual(frameDistance(flat(10), flat(10)), 0);
  assert.strictEqual(frameDistance(flat(0), flat(255)), 1);
});

test('a dropdown opening is a change even though the average barely moves', () => {
  const before = screen(40);
  const after = paint(before, { x: 0.3, y: 0.2, w: 0.14, h: 0.2, value: 220 });

  const change = compareFrames(before, after);
  // Under three percent of the picture, which is why averaging loses it.
  assert.ok(change.mean < 0.04, `mean should be small, got ${change.mean}`);
  assert.ok(change.focus > 0.4, `focus should see it, got ${change.focus}`);
  assert.ok(changeScore(before, after) > 0.04, 'a dropdown should be worth a frame');
});

test('the mouse moving is not a change', () => {
  const before = screen(40);
  const after = paint(before, { x: 0.5, y: 0.5, w: 0.012, h: 0.02, value: 255 });
  assert.ok(changeScore(before, after) < 0.04, `a pointer should be ignored, got ${changeScore(before, after)}`);
});

test('codec noise on a still screen is not a change', () => {
  const before = screen(120);
  assert.ok(changeScore(before, noisy(before, 4)) < 0.04);
});

test('signatures of an unexpected shape fall back to the average rather than throwing', () => {
  const change = compareFrames(flat(0, 64), flat(255, 64));
  assert.strictEqual(change.mean, 1);
  assert.strictEqual(change.focus, 1);
});

// ---------------------------------------------------------------- selection

test('a screen that never changes is anchored through the recording, but saved once', () => {
  const chosen = selectKeyframes(samplesOf(Array.from({ length: 30 }, (_, i) => [i, flat(100)])));

  assert.ok(chosen.length >= 4, `narration needs anchors through the run, got ${chosen.length}`);
  assert.strictEqual(pictures(chosen).length, 1, 'one screen was shown, so one picture of it');
  assert.strictEqual(chosen[0].time, 0);
  assert.ok(
    chosen.slice(1).every((entry) => entry.revisitOf === 0),
    'the anchors should point at the one frame there is'
  );
});

test('padding a sparse recording does not save a screen it already has', () => {
  // Three screens, so three entries — one short of the floor. What gets added
  // to make up the difference lands inside a screen already captured, and the
  // old code saved that as a fourth, duplicate picture.
  const a = screen(40);
  const b = paint(screen(190), { x: 0.1, y: 0.1, w: 0.6, h: 0.5, value: 30 });
  const c = paint(screen(110), { x: 0.4, y: 0.4, w: 0.5, h: 0.4, value: 240 });

  const timeline = [];
  [a, b, c].forEach((page, index) => {
    for (let i = 0; i < 10; i += 1) timeline.push([index * 5 + i * 0.5, page]);
  });

  const chosen = selectKeyframes(samplesOf(timeline));
  assert.ok(chosen.length >= 4, 'the floor should still be met');
  assert.strictEqual(pictures(chosen).length, 3, 'three screens were shown, so three pictures');
  chosen
    .filter((entry) => entry.revisitOf !== null)
    .forEach((entry) => {
      assert.ok(entry.revisitOf < 3, `revisitOf ${entry.revisitOf} must address a real frame`);
    });
});

test('frames are taken where the screen actually changed', () => {
  const samples = samplesOf(
    Array.from({ length: 30 }, (_, i) => [i, flat(i < 10 ? 0 : i < 20 ? 120 : 240)])
  );
  const times = selectKeyframes(samples).map((entry) => entry.time);
  assert.ok(times.includes(10), `expected the first change at 10s, got ${times}`);
  assert.ok(times.includes(20), `expected the second change at 20s, got ${times}`);
});

test('a page that fades in is kept once it has finished, not mid-fade', () => {
  // 40 -> 200 over a second and a half, then still.
  const steps = [40, 80, 120, 160, 200, 200, 200, 200];
  const samples = samplesOf(steps.map((value, i) => [i * 0.5, flat(value)]));

  const chosen = selectKeyframes(samples, { minCount: 1 });
  assert.strictEqual(chosen.length, 2, `expected one frame either side of the fade, got ${chosen.length}`);
  assert.strictEqual(chosen[1].time, 2, `expected the settled frame at 2s, got ${chosen[1].time}s`);
});

test('a flash that comes and goes is not worth a frame', () => {
  const samples = samplesOf([[0, flat(0)], [0.2, flat(255)], [0.4, flat(0)]]);
  assert.strictEqual(selectKeyframes(samples, { minCount: 1 }).length, 1);
});

test('the first frame is always kept', () => {
  const samples = samplesOf(Array.from({ length: 40 }, (_, i) => [i, flat((i * 90) % 256)]));
  assert.strictEqual(selectKeyframes(samples, { maxCount: 5 })[0].index, 0);
});

test('no samples means no keyframes rather than an error', () => {
  assert.deepStrictEqual(selectKeyframes([]), []);
  assert.deepStrictEqual(selectKeyframes(null), []);
});

test('a constantly changing screen is capped, keeping the biggest changes', () => {
  const samples = samplesOf(Array.from({ length: 60 }, (_, i) => [i * 2, flat((i * 37) % 256)]));
  const chosen = selectKeyframes(samples, { maxCount: 8 });

  assert.strictEqual(pictures(chosen).length, 8);
  const times = chosen.map((entry) => entry.time);
  assert.deepStrictEqual(times, times.slice().sort((a, b) => a - b));
});

// ----------------------------------------------------------------- revisits

// The walkthrough the whole revisit idea exists for: talk over a screen, click
// to another, talk, then go back to the first one.
function thereAndBackAgain() {
  const a = screen(40);
  const b = paint(screen(180), { x: 0.1, y: 0.1, w: 0.5, h: 0.6, value: 20 });
  const timeline = [];
  for (let i = 0; i < 8; i += 1) timeline.push([i * 0.5, noisy(a, 3)]);
  for (let i = 8; i < 16; i += 1) timeline.push([i * 0.5, noisy(b, 3)]);
  for (let i = 16; i < 24; i += 1) timeline.push([i * 0.5, noisy(a, 3)]);
  return samplesOf(timeline);
}

test('going back to a screen is recorded as a revisit, not a second copy of it', () => {
  const chosen = selectKeyframes(thereAndBackAgain(), { minCount: 1 });

  assert.strictEqual(pictures(chosen).length, 2, 'two screens were shown, so two pictures');
  const revisits = chosen.filter((entry) => entry.revisitOf !== null);
  assert.strictEqual(revisits.length, 1, `expected one return, got ${revisits.length}`);
  assert.strictEqual(revisits[0].revisitOf, 0, 'the return should point at the first frame');
  assert.strictEqual(revisits[0].time, 8, `the return happened at 8s, got ${revisits[0].time}s`);
});

test('the same page scrolled somewhere else is a new frame, not a revisit', () => {
  const a = screen(40);
  const scrolled = paint(a, { x: 0, y: 0.3, w: 1, h: 0.4, value: 150 });
  const b = screen(200);

  const timeline = [];
  for (let i = 0; i < 6; i += 1) timeline.push([i * 0.5, a]);
  for (let i = 6; i < 12; i += 1) timeline.push([i * 0.5, b]);
  for (let i = 12; i < 18; i += 1) timeline.push([i * 0.5, scrolled]);

  const chosen = selectKeyframes(samplesOf(timeline), { minCount: 1 });
  assert.strictEqual(pictures(chosen).length, 3);
  assert.strictEqual(chosen.filter((entry) => entry.revisitOf !== null).length, 0);
});

test('a frame somebody came back to is not the one dropped when the budget is tight', () => {
  const home = screen(40);
  const timeline = [[0, home], [0.5, home]];

  // A run of distinct screens, none of them the home screen, each a big change
  // so the home screen's own score is the lowest thing in the list.
  for (let i = 0; i < 10; i += 1) {
    const other = screen(70 + i * 18);
    timeline.push([2 + i * 2, other], [2.5 + i * 2, other]);
  }
  timeline.push([30, home], [30.5, home]);

  const chosen = selectKeyframes(samplesOf(timeline), { maxCount: 3 });
  const kept = pictures(chosen);
  assert.strictEqual(kept.length, 3);

  const revisits = chosen.filter((entry) => entry.revisitOf !== null);
  assert.strictEqual(revisits.length, 1, 'the return to the home screen should survive');
  assert.ok(
    revisits[0].revisitOf < kept.length,
    `revisitOf ${revisits[0].revisitOf} must still address a kept frame`
  );
  assert.strictEqual(kept[revisits[0].revisitOf].time, 0, 'it should point at the home screen');
});

test('every revisit points at a frame that is actually in the list', () => {
  const chosen = selectKeyframes(thereAndBackAgain());
  const kept = pictures(chosen);
  chosen
    .filter((entry) => entry.revisitOf !== null)
    .forEach((entry) => {
      assert.ok(
        Number.isInteger(entry.revisitOf) && entry.revisitOf >= 0 && entry.revisitOf < kept.length,
        `revisitOf ${entry.revisitOf} is out of range for ${kept.length} frames`
      );
    });
});

// ------------------------------------------------------------------ budgets

test('how many frames are allowed grows with how long the recording ran', () => {
  assert.strictEqual(frameBudget(0), 12);
  assert.strictEqual(frameBudget(60), 12);
  assert.ok(frameBudget(300) > frameBudget(60), 'five minutes should allow more than one');
  assert.ok(frameBudget(3600) <= 80, 'but not without limit');
});

test('a long recording is not summarised by a dozen frames', () => {
  // Ten minutes, a new screen every eight seconds: 75 genuinely different
  // pages, each with its own background and its own block of content.
  const page = (i) =>
    paint(screen(30 + (i % 6) * 14), {
      x: (i % 7) / 9,
      y: ((i * 3) % 5) / 7,
      w: 0.34,
      h: 0.28,
      value: 70 + ((i * 53) % 170)
    });

  const timeline = [];
  for (let i = 0; i < 75; i += 1) {
    timeline.push([i * 8, page(i)], [i * 8 + 1, page(i)]);
  }
  const chosen = selectKeyframes(samplesOf(timeline));
  assert.ok(pictures(chosen).length > 40, `expected the long run to keep plenty, got ${pictures(chosen).length}`);
});

test('no recording is sampled more rarely than every two seconds', () => {
  [5, 30, 120, 600, 1800, 7200].forEach((duration) => {
    const interval = sampleIntervalSeconds(duration);
    assert.ok(interval >= 0.25, `${duration}s sampled every ${interval}s is wasteful`);
    assert.ok(interval <= 2, `${duration}s sampled every ${interval}s misses changes`);
  });
  assert.ok(sampleIntervalSeconds(600) <= 1, 'ten minutes should still be sampled about once a second');
});

// Sampling is the expensive half of processing: a seek, a decode and a
// downsample measured at about 40 ms each on a 1080p recording. Nothing here
// enforces a time, only the sample count that time is proportional to, so a
// change that quietly multiplies the work is visible as a failure here rather
// than as an app that looks hung.
test('the work of scanning stays proportionate to the recording', () => {
  const samplesFor = (duration) => Math.ceil(duration / sampleIntervalSeconds(duration));

  assert.ok(samplesFor(60) <= 300, `a minute should not cost ${samplesFor(60)} seeks`);
  assert.strictEqual(samplesFor(300), 900, 'five minutes is where the cap takes over');
  assert.strictEqual(samplesFor(600), 900, 'ten minutes costs no more than five');
  assert.strictEqual(samplesFor(1800), 900, 'half an hour is still capped');

  // Past half an hour the interval has hit its ceiling, so the count grows with
  // the recording. That is intended, but it should grow at the 2s rate and no
  // faster, so it stays predictable.
  assert.strictEqual(samplesFor(3600), 1800, 'an hour costs twice half an hour');
  assert.strictEqual(samplesFor(7200), 3600, 'and two hours twice that');
});

test('the summary says what was found, including returns', () => {
  assert.strictEqual(
    summarize([{ revisitOf: null }, { revisitOf: null }]),
    'Found 2 moments where the screen changed.'
  );
  assert.strictEqual(
    summarize([{ revisitOf: null }, { revisitOf: 0 }]),
    'Found 1 moment where the screen changed, and 1 return to a screen already captured.'
  );
});
