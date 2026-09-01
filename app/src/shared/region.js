'use strict';

// A region is a rectangle in the recorded video's own pixel coordinates:
// { x, y, width, height }, all integers. The framing UI draws on a scaled-down
// still, so every region that comes back from the UI has to be scaled into
// video pixels before it is used to crop a keyframe.

const MIN_SIDE = 16;

function round(value) {
  return Math.round(Number(value) || 0);
}

// Two drag points in any order become a rectangle. Dragging up or left is the
// normal way to select something below and to the right of where you started.
function normalizeDrag(from, to) {
  const x1 = round(from.x);
  const y1 = round(from.y);
  const x2 = round(to.x);
  const y2 = round(to.y);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function wholeFrame(frameWidth, frameHeight) {
  return { x: 0, y: 0, width: round(frameWidth), height: round(frameHeight) };
}

// Keeps a region inside the frame and at least MIN_SIDE on each axis. A region
// that cannot fit at all collapses to the whole frame, which is the safe answer:
// cropping to nothing loses the review, cropping to everything loses nothing.
function clampRegion(region, frameWidth, frameHeight) {
  const fw = round(frameWidth);
  const fh = round(frameHeight);
  if (fw < MIN_SIDE || fh < MIN_SIDE) return wholeFrame(fw, fh);
  if (!region) return wholeFrame(fw, fh);

  let width = Math.min(Math.max(round(region.width), MIN_SIDE), fw);
  let height = Math.min(Math.max(round(region.height), MIN_SIDE), fh);
  let x = Math.min(Math.max(round(region.x), 0), fw - width);
  let y = Math.min(Math.max(round(region.y), 0), fh - height);

  return { x, y, width, height };
}

// Maps a region from the coordinate space it was drawn in to another one, then
// clamps it. Used to turn a selection on a preview into video pixels.
function scaleRegion(region, from, to) {
  const fromW = round(from.width);
  const fromH = round(from.height);
  const toW = round(to.width);
  const toH = round(to.height);
  if (fromW <= 0 || fromH <= 0) return wholeFrame(toW, toH);

  const sx = toW / fromW;
  const sy = toH / fromH;
  return clampRegion(
    {
      x: region.x * sx,
      y: region.y * sy,
      width: region.width * sx,
      height: region.height * sy
    },
    toW,
    toH
  );
}

function isWholeFrame(region, frameWidth, frameHeight) {
  const clamped = clampRegion(region, frameWidth, frameHeight);
  return (
    clamped.x === 0 &&
    clamped.y === 0 &&
    clamped.width === round(frameWidth) &&
    clamped.height === round(frameHeight)
  );
}

function describeRegion(region, frameWidth, frameHeight) {
  if (isWholeFrame(region, frameWidth, frameHeight)) {
    return `whole screen (${round(frameWidth)}x${round(frameHeight)})`;
  }
  const r = clampRegion(region, frameWidth, frameHeight);
  return `${r.width}x${r.height} at ${r.x},${r.y} of ${round(frameWidth)}x${round(frameHeight)}`;
}

module.exports = {
  MIN_SIDE,
  normalizeDrag,
  wholeFrame,
  clampRegion,
  scaleRegion,
  isWholeFrame,
  describeRegion
};
