'use strict';

const { screen, desktopCapturer, nativeImage } = require('electron');

const { nativePixelSize, positionHint } = require('../shared/screen-size');

// "Display 2" identifies nothing. A thumbnail does, at a glance, which is why
// the picker shows pictures and not a list of names.
const THUMBNAIL_SIZE = { width: 320, height: 200 };

// On macOS, desktopCapturer returns black images until Screen Recording has been
// granted. That makes an all-black thumbnail a permission signal rather than a
// mystery, so it is worth detecting instead of showing an empty-looking picker.
function looksBlank(image) {
  if (!image || image.isEmpty()) return true;
  const bitmap = image.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i] > 8 || bitmap[i + 1] > 8 || bitmap[i + 2] > 8) return false;
  }
  return true;
}

// The pixel size the display actually has. Requesting anything smaller is how
// keyframe text becomes unreadable, which is the failure the OBS version of this
// tool shipped with for a while. See shared/screen-size.js for why this is not a
// plain multiplication.
function nativeSize(display) {
  return nativePixelSize(display.size, display.scaleFactor || 1);
}

function labelFor(display, index) {
  return display.label && display.label.trim() ? display.label.trim() : `Display ${index + 1}`;
}

async function listDisplays() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: THUMBNAIL_SIZE,
    fetchWindowIcons: false
  });

  const named = displays.map((display, index) => labelFor(display, index));
  const ambiguous = new Set(named.filter((name, index) => named.indexOf(name) !== index));

  return displays.map((display, index) => {
    const source =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[index] || null;
    const thumbnail = source ? source.thumbnail : nativeImage.createEmpty();
    const size = nativeSize(display);
    const isPrimary = display.id === primary.id;

    // Only disambiguate when the name alone is ambiguous; a position on every
    // row is noise on a machine with one of each monitor.
    const parts = [named[index]];
    if (ambiguous.has(named[index])) {
      const hint = positionHint(display.bounds, primary.bounds);
      if (hint) parts.push(hint);
    }
    if (isPrimary) parts.push('main screen');

    return {
      id: String(display.id),
      sourceId: source ? source.id : null,
      name: parts.join(' · '),
      resolution: `${size.width} × ${size.height}`,
      isPrimary,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor || 1,
      captureWidth: size.width,
      captureHeight: size.height,
      thumbnail: thumbnail && !thumbnail.isEmpty() ? thumbnail.toDataURL() : null,
      thumbnailBlank: looksBlank(thumbnail)
    };
  });
}

// A dock gets unplugged between opening the app and pressing Record. Falling
// back to the primary display and saying so beats refusing to record.
async function resolveDisplay(preferredId) {
  const displays = await listDisplays();
  if (!displays.length) return { display: null, displays, fellBack: false };

  const wanted = displays.find((item) => item.id === String(preferredId));
  if (wanted) return { display: wanted, displays, fellBack: false };

  const primary = displays.find((item) => item.isPrimary) || displays[0];
  return { display: primary, displays, fellBack: Boolean(preferredId) };
}

// Where to put the recording bar: any display that is not the one being
// recorded. With a single display there is nowhere to hide, and the bar ends up
// in the recording at a known screen edge where framing can crop it out.
function barPlacement(recordedDisplayId, barSize) {
  const displays = screen.getAllDisplays();
  const host =
    displays.find((item) => String(item.id) !== String(recordedDisplayId)) ||
    displays.find((item) => String(item.id) === String(recordedDisplayId)) ||
    screen.getPrimaryDisplay();

  const area = host.workArea;
  return {
    x: Math.round(area.x + (area.width - barSize.width) / 2),
    y: Math.round(area.y + area.height - barSize.height - 24),
    onRecordedDisplay: String(host.id) === String(recordedDisplayId)
  };
}

module.exports = { listDisplays, resolveDisplay, barPlacement, nativeSize, looksBlank };
