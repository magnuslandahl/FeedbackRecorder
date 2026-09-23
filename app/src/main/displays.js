'use strict';

const { screen, desktopCapturer, nativeImage, BrowserWindow } = require('electron');

const { nativePixelSize, positionHint } = require('../shared/screen-size');

// "Display 2" identifies nothing. A thumbnail does, at a glance, which is why
// the picker shows pictures and not a list of names.
const THUMBNAIL_SIZE = { width: 320, height: 200 };

// Asking the screen for its sources, without letting a refusal end the picker.
//
// This was written believing macOS answers a missing Screen Recording grant with
// black images. Measured on macOS 26, it does not: desktopCapturer rejects, with
// a bare string ("Failed to get sources.") rather than an Error. That rejection
// used to travel all the way out of listDisplays and abort the renderer's start,
// so the picker stayed empty and every step after it never ran.
//
// screen.getAllDisplays() needs no permission, so the displays themselves are
// still known. Treating a refusal as "no thumbnails" keeps the picker populated
// and hands the blank-image signal below something to explain.
async function desktopSources() {
  try {
    return await desktopCapturer.getSources({
      // A full-screen macOS app lives in its own Space. It is still returned as
      // a window source, but it is not represented by the screen thumbnail from
      // the Space FeedbackRecorder currently occupies.
      types: process.platform === 'darwin' ? ['screen', 'window'] : ['screen'],
      thumbnailSize: THUMBNAIL_SIZE,
      fetchWindowIcons: process.platform === 'darwin'
    });
  } catch (error) {
    return [];
  }
}

// A blank thumbnail is the permission signal: black on the platforms that return
// an image, and absent on the ones that refuse outright. Either way the picker
// says why it cannot show a preview instead of looking broken.
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
  const sources = await desktopSources();
  const screenSources = sources.filter((source) => source.id.startsWith('screen:'));

  const named = displays.map((display, index) => labelFor(display, index));
  const ambiguous = new Set(named.filter((name, index) => named.indexOf(name) !== index));

  const screenEntries = displays.map((display, index) => {
    const source =
      screenSources.find((item) => String(item.display_id) === String(display.id)) ||
      screenSources[index] ||
      null;
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
      kind: 'screen',
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

  // Chromium exposes a full-screen app in another macOS Space as a window
  // source. Measured with Electron 44 on this Mac: a test window remained in
  // the `window` list after entering native full-screen mode, while the `screen`
  // list represented only physical displays. Own windows are removed so the
  // picker never offers FeedbackRecorder as the thing to record.
  const ownWindows = new Set(
    BrowserWindow.getAllWindows()
      .map((window) => {
        try {
          return window.getMediaSourceId().split(':').slice(0, 2).join(':');
        } catch (error) {
          return '';
        }
      })
      .filter(Boolean)
  );
  const windows =
    process.platform === 'darwin'
      ? sources
          .filter((source) => source.id.startsWith('window:'))
          .filter(
            (source) => !ownWindows.has(source.id.split(':').slice(0, 2).join(':'))
          )
          // Without Screen Recording, macOS still reveals window titles but
          // returns empty images. Do not fill a denied picker with every open
          // application's title and ten identical "No preview" cards.
          .filter((source) => source.thumbnail && !source.thumbnail.isEmpty())
          // Window enumeration order changes as apps and Spaces gain focus.
          // Stable title ordering keeps a two-second preview refresh from
          // needlessly moving every card in the picker.
          .sort((left, right) => {
            const byName = String(left.name || '').localeCompare(
              String(right.name || ''),
              undefined,
              { numeric: true, sensitivity: 'base' }
            );
            return byName || String(left.id).localeCompare(String(right.id));
          })
          .map((source, index) => ({
            kind: 'window',
            id: source.id,
            sourceId: source.id,
            displayId: null,
            name:
              source.name && source.name.trim()
                ? source.name.trim()
                : `Application window ${index + 1}`,
            resolution: 'App window',
            isPrimary: false,
            bounds: null,
            scaleFactor: 1,
            captureWidth: 0,
            captureHeight: 0,
            thumbnail: source.thumbnail.toDataURL(),
            thumbnailBlank: false
          }))
      : [];

  return screenEntries.concat(windows);
}

// A dock gets unplugged between opening the app and pressing Record. Falling
// back to the primary display and saying so beats refusing to record.
async function resolveDisplay(preferredId) {
  const displays = await listDisplays();
  if (!displays.length) return { display: null, displays, fellBack: false };

  const wanted = displays.find((item) => item.id === String(preferredId));
  if (wanted) return { display: wanted, displays, fellBack: false };

  // A window is an ephemeral source. If it closed, recording a completely
  // different screen would be a plausible-looking but wrong result.
  if (String(preferredId || '').startsWith('window:')) {
    return { display: null, displays, fellBack: false, missingWindow: true };
  }

  const screens = displays.filter((item) => item.kind === 'screen');
  const primary = screens.find((item) => item.isPrimary) || screens[0] || null;
  return { display: primary, displays, fellBack: Boolean(preferredId) };
}

// Where to put the recording bar: at the bottom-right of any display that is
// not being recorded. With a single display there is nowhere to hide, and the
// compact bar ends up at a known corner where framing can crop it out.
function barPlacement(recordedDisplayId, barSize) {
  const displays = screen.getAllDisplays();
  const recorded =
    recordedDisplayId === null || recordedDisplayId === undefined
      ? null
      : displays.find((item) => String(item.id) === String(recordedDisplayId));
  const host =
    (recorded && displays.find((item) => item.id !== recorded.id)) ||
    recorded ||
    screen.getPrimaryDisplay();

  const area = host.workArea;
  return {
    x: Math.round(area.x + area.width - barSize.width - 18),
    y: Math.round(area.y + area.height - barSize.height - 18),
    onRecordedDisplay: Boolean(recorded && host.id === recorded.id)
  };
}

module.exports = { listDisplays, resolveDisplay, barPlacement, nativeSize, looksBlank };
