'use strict';

const { screen, desktopCapturer, nativeImage } = require('electron');

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
// tool shipped with for a while.
function nativeSize(display) {
  const scale = display.scaleFactor || 1;
  return {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  };
}

function labelFor(display, index, isPrimary) {
  const size = nativeSize(display);
  const parts = [display.label && display.label.trim() ? display.label.trim() : `Display ${index + 1}`];
  parts.push(`${size.width}x${size.height}`);
  if (isPrimary) parts.push('primary');
  return parts.join(' — ');
}

async function listDisplays() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: THUMBNAIL_SIZE,
    fetchWindowIcons: false
  });

  return displays.map((display, index) => {
    const source =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[index] || null;
    const thumbnail = source ? source.thumbnail : nativeImage.createEmpty();
    const size = nativeSize(display);

    return {
      id: String(display.id),
      sourceId: source ? source.id : null,
      name: labelFor(display, index, display.id === primaryId),
      isPrimary: display.id === primaryId,
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
