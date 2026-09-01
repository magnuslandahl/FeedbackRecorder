'use strict';

// Turning a display's logical size back into physical pixels is not exact.
// Windows reports the logical size already rounded: a 3840x2160 panel at 175%
// comes back as 2195x1235 DIP, and 2195 * 1.75 is 3841.25 — a resolution no
// monitor has. Measured on the development machine:
//
//   2195x1235 @ 1.75  ->  3841.25 x 2161.25   (really 3840x2160)
//   1281x800  @ 1.5   ->  1921.5  x 1200      (really 1920x1200)
//   1920x1080 @ 1     ->  1920    x 1080
//
// Flooring to an even number recovers all three. Even is not a fudge: video
// encoders want even dimensions because of chroma subsampling, so a size that
// could be captured and encoded is the right answer anyway.
//
// This number is only ever the *requested* size. What was actually captured is
// read back from the track, because asking is not the same as receiving.

function floorToEven(value) {
  const floored = Math.floor(Number(value) || 0);
  return floored % 2 === 0 ? floored : floored - 1;
}

function nativePixelSize(size, scaleFactor) {
  const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
  return {
    width: Math.max(2, floorToEven((size && size.width) * scale)),
    height: Math.max(2, floorToEven((size && size.height) * scale))
  };
}

// Two identical monitors report identical names, and "T24i-30 — 1920x1080"
// twice in a picker tells you nothing about which is which. Where they sit
// relative to the primary screen does.
function positionHint(bounds, primaryBounds) {
  if (!bounds || !primaryBounds) return '';
  if (bounds.x === primaryBounds.x && bounds.y === primaryBounds.y) return '';

  const dx = bounds.x - primaryBounds.x;
  const dy = bounds.y - primaryBounds.y;

  // Monitors are rarely aligned exactly, so the dominant axis wins rather than
  // producing "up and slightly left".
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'to the left' : 'to the right';
  return dy < 0 ? 'above' : 'below';
}

module.exports = { floorToEven, nativePixelSize, positionHint };
