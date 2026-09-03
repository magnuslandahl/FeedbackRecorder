'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { writeZip } = require('./zip');
const exports_ = require('../shared/exports');

// Turning a package folder into one file somebody can send.
//
// The whole folder goes in, rather than a hand-written list, so anything the
// pipeline adds later is exported without this having to be remembered. Two
// files are opt-in: the video, because it is almost all of the size, and the
// narration audio, because its content is already in the transcript and it is
// somebody's actual voice. What is left is what a reader needs.

function walk(dir, prefix, found) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, item.name);
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) walk(full, name, found);
    else if (item.isFile()) found.push({ name, sourcePath: full, bytes: fs.statSync(full).size });
  }
  return found;
}

// What an export would contain, so each choice can be put to the user with its
// cost attached rather than explained afterwards.
function plan(dir) {
  const all = walk(dir, '', []);
  const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);

  const video = all.filter((item) => exports_.isRecording(item.name));
  const audio = all.filter((item) => exports_.isNarrationAudio(item.name));
  const rest = all.filter((item) => exports_.isAlwaysIncluded(item.name));

  return {
    files: all.length,
    videoFiles: video.length,
    videoBytes: sum(video),
    audioFiles: audio.length,
    audioBytes: sum(audio),
    otherBytes: sum(rest),
    totalBytes: sum(all)
  };
}

function chooseFiles(all, includeVideo, includeAudio) {
  return all.filter((item) => {
    if (exports_.isRecording(item.name)) return includeVideo;
    if (exports_.isNarrationAudio(item.name)) return includeAudio;
    return true;
  });
}

async function save(options) {
  const dir = options.dir;
  const target = options.target;
  // Both default to off: the normal export is the one that is small enough to
  // send and carries nobody's voice.
  const includeVideo = Boolean(options.includeVideo);
  const includeAudio = Boolean(options.includeAudio);

  const chosen = chooseFiles(walk(dir, '', []), includeVideo, includeAudio);

  if (!chosen.length) {
    throw new Error('That package has no files in it.');
  }

  const result = await writeZip({
    target,
    date: new Date(),
    zip64Threshold: options.zip64Threshold,
    entries: chosen.map((item) => ({
      name: item.name,
      sourcePath: item.sourcePath,
      method: exports_.compressionFor(item.name)
    }))
  });

  return Object.assign({ includedVideo: includeVideo, includedAudio: includeAudio }, result);
}

module.exports = { plan, save, walk, chooseFiles };
