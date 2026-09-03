'use strict';

// What goes into an exported zip, and what it is called.
//
// Kept separate from the writing so the rules can be tested without producing a
// file, and so the renderer can describe the export before it happens — the
// video is most of the size, and somebody deciding whether to include it should
// be told what it costs.

const RECORDING_STEM = 'recording';

// Deflate buys nothing on data that is already compressed, and costs time
// proportional to the size — which for the video is most of the export. PNG
// keyframes and every video container are already compressed; the transcript,
// the brief and run.json are text and compress well.
const ALREADY_COMPRESSED = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.webm',
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.avi',
  '.ogv',
  '.ogg',
  '.zip',
  '.gz'
];

function extensionOf(name) {
  const bare = String(name || '');
  const dot = bare.lastIndexOf('.');
  return dot === -1 ? '' : bare.slice(dot).toLowerCase();
}

function compressionFor(name) {
  return ALREADY_COMPRESSED.includes(extensionOf(name)) ? 'store' : 'deflate';
}

// The source video, whatever container it arrived in. Imported files keep their
// own extension, so this cannot be a fixed file name.
function isRecording(entryName) {
  const bare = String(entryName || '').split('/').pop();
  const dot = bare.lastIndexOf('.');
  return (dot === -1 ? bare : bare.slice(0, dot)).toLowerCase() === RECORDING_STEM;
}

// Says in the name whether the video is in there, so two exports of the same
// review do not overwrite each other and the recipient knows what they were
// sent before opening it.
function zipFileName(runId, includeVideo) {
  const id = String(runId || 'package').trim() || 'package';
  return `FeedbackRecorder-${id}${includeVideo ? '' : '-without-video'}.zip`;
}

// Plain enough for the label on a checkbox. Sizes here are whole files rather
// than measurements, so a decimal place would be false precision.
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

module.exports = {
  ALREADY_COMPRESSED,
  RECORDING_STEM,
  compressionFor,
  extensionOf,
  isRecording,
  zipFileName,
  formatBytes
};
