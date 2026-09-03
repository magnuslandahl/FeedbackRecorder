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

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function looksLikeVideo(name) {
  return VIDEO_EXTENSIONS.includes(extensionOf(name));
}

// The copy inside the package is always called "recording", so a package has the
// same shape whether it was recorded or imported and the brief can describe one
// layout. The extension is kept, because renaming an MP4 to .webm would make the
// file lie about what it is to every player that opens it.
function recordingFileName(sourceName) {
  const extension = extensionOf(sourceName);
  return `recording${VIDEO_EXTENSIONS.includes(extension) ? extension : DEFAULT_EXTENSION}`;
}

// Only the file name reaches the brief. The folder it came from is nobody's
// business but the user's, and briefs get pasted into chats.
function sourceName(pathOrName) {
  return path.basename(String(pathOrName || '')).trim();
}

module.exports = {
  VIDEO_EXTENSIONS,
  DEFAULT_EXTENSION,
  extensionOf,
  looksLikeVideo,
  recordingFileName,
  sourceName
};
