'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { writeZip } = require('./zip');
const exports_ = require('../shared/exports');

// Turning a package folder into one file somebody can send.
//
// The whole folder goes in, rather than a hand-written list, so anything the
// pipeline adds later is exported without this having to be remembered. The
// video is the only thing that can be left out, because it is almost all of the
// size and is the part a reader usually does not need.

function walk(dir, prefix, found) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, item.name);
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) walk(full, name, found);
    else if (item.isFile()) found.push({ name, sourcePath: full, bytes: fs.statSync(full).size });
  }
  return found;
}

// What an export would contain, so the choice can be described before it is
// made rather than explained afterwards.
function plan(dir) {
  const all = walk(dir, '', []);
  const video = all.filter((item) => exports_.isRecording(item.name));
  const rest = all.filter((item) => !exports_.isRecording(item.name));

  const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);

  return {
    files: all.length,
    videoFiles: video.length,
    videoBytes: sum(video),
    otherBytes: sum(rest),
    totalBytes: sum(all)
  };
}

async function save(options) {
  const dir = options.dir;
  const target = options.target;
  const includeVideo = options.includeVideo !== false;

  const all = walk(dir, '', []);
  const chosen = includeVideo ? all : all.filter((item) => !exports_.isRecording(item.name));

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

  return Object.assign({ includedVideo: includeVideo }, result);
}

module.exports = { plan, save, walk };
