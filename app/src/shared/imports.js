'use strict';

const path = require('node:path');

// Deciding what may be imported, and what the copy inside the package is called.
//
// The extension list is a first filter, not the verdict: whether a file can
// actually be played is settled by trying to play it, because that depends on
// the codecs inside the container rather than on the name. What the list buys is
// a sentence that says "that is not a video" for a PDF, instead of a codec error
// that reads like a bug.

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv', '.ogg', '.avi'];

const DEFAULT_EXTENSION = '.webm';

// Only the file name reaches the brief. The folder it came from is nobody's
// business but the user's, and briefs get pasted into chats.
//
// Both separators are stripped regardless of the platform this runs on.
// path.basename on macOS and Linux does not treat a backslash as a separator, so
// a Windows path handed to it would come back whole and carry the user's folder
// and account name into the brief. A privacy guard that only holds on the
// platform it was written on is worse than none, because it looks like one.
function sourceName(pathOrName) {
  const value = String(pathOrName || '').trim();
  const lastSeparator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return lastSeparator === -1 ? value : value.slice(lastSeparator + 1);
}

// Reduced to a bare name first, for the same reason: on macOS and Linux,
// path.extname over a Windows path would read a dot in a folder name as the
// start of the extension.
function extensionOf(name) {
  return path.extname(sourceName(name)).toLowerCase();
}

function looksLikeVideo(name) {
  return VIDEO_EXTENSIONS.includes(extensionOf(name));
}

// The copy inside the package is always called "recording", so a package has the
// same shape whether it was recorded or imported and the brief can describe one
// layout. The extension is kept, because renaming an MP4 to .webm would make the
// file lie about what it is to every player that opens it.
function recordingFileName(name) {
  const extension = extensionOf(name);
  return `recording${VIDEO_EXTENSIONS.includes(extension) ? extension : DEFAULT_EXTENSION}`;
}

module.exports = {
  VIDEO_EXTENSIONS,
  DEFAULT_EXTENSION,
  extensionOf,
  looksLikeVideo,
  recordingFileName,
  sourceName
};
