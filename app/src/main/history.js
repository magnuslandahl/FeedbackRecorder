'use strict';

const fs = require('node:fs');
const path = require('node:path');

const inputEvents = require('../shared/input-events');

// The packages already written to the recordings folder, read back so an
// earlier review can be opened again after "Record another" or a restart.
//
// The renderer only ever names a package by its folder name. Every path is
// built here, from the recordings folder, and checked to stay inside it, so a
// name the renderer makes up cannot reach anything else on disk.

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?$/;
const SEARCH_TRANSCRIPT_LIMIT = 4000;
const SNIPPET_LIMIT = 140;

function isPackageId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolvePackage(recordingsDir, id) {
  if (!isPackageId(id)) throw new Error('That is not the name of a recording.');
  const root = path.resolve(recordingsDir);
  const dir = path.resolve(root, id);
  if (!inside(root, dir)) throw new Error('That recording is outside the recordings folder.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('That recording is no longer in the recordings folder.');
  }
  return dir;
}

// A keyframe is only read if run.json names it and it resolves inside the
// package, so a hand-edited run.json cannot point the app at another file.
function resolveFrame(dir, file) {
  if (typeof file !== 'string' || !/\.png$/i.test(file)) return null;
  const target = path.resolve(dir, file);
  return inside(dir, target) ? target : null;
}

function readRun(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
}

function oneLine(text, limit) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function sourceOf(run) {
  if (run.source && run.source.kind === 'import') {
    return { kind: 'import', name: String(run.source.name || 'an imported video') };
  }
  return { kind: 'recording', name: String((run.display && run.display.name) || 'a screen') };
}

function summarize(id, run) {
  const notes = run.notes || {};
  const frameNotes = Array.isArray(notes.frames) ? notes.frames : [];
  const general = String(notes.general || '');
  const segments = ((run.transcript || {}).segments || []).filter(Boolean);
  const spoken = segments.map((segment) => String(segment.text || '').trim()).join(' ');
  const source = sourceOf(run);
  const keyframes = Array.isArray(run.keyframes) ? run.keyframes : [];

  return {
    id,
    status: 'complete',
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : null,
    durationSeconds: Number(run.durationSeconds) || 0,
    source,
    keyframeCount: keyframes.length,
    commentCount: frameNotes.length + (general.trim() ? 1 : 0),
    degraded: Array.isArray(run.degraded) ? run.degraded.length : 0,
    // What the person wrote is the best reminder of what a review was about;
    // failing that, what they said.
    snippet: oneLine(general || (frameNotes[0] && frameNotes[0].text) || spoken, SNIPPET_LIMIT),
    searchText: [
      source.name,
      general,
      frameNotes.map((note) => note && note.text).join(' '),
      spoken.slice(0, SEARCH_TRANSCRIPT_LIMIT)
    ]
      .join(' ')
      .toLowerCase()
  };
}

async function folderSize(dir) {
  let total = 0;
  let items = [];
  try {
    items = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    return 0;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) total += await folderSize(full);
    else if (item.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch (error) {
        // Removed while it was being measured.
      }
    }
  }
  return total;
}

// Every package folder, newest first. One that has no run.json never finished
// processing; one whose run.json cannot be read is listed too, rather than
// silently dropped, so it can still be found and deleted.
async function list(recordingsDir) {
  const root = path.resolve(recordingsDir);
  let entries = [];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const ids = entries
    .filter((entry) => entry.isDirectory() && isPackageId(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));

  const found = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    const runPath = path.join(dir, 'run.json');
    let item;
    if (!fs.existsSync(runPath)) {
      item = { id, status: 'unfinished', searchText: '' };
    } else {
      try {
        item = summarize(id, readRun(dir));
      } catch (error) {
        item = { id, status: 'unreadable', searchText: '' };
      }
    }
    item.sizeBytes = await folderSize(dir);
    found.push(item);
  }
  return found;
}

// A finished package as the runtime holds one: the run as written, plus the
// input chronology, which run.json leaves to its own file. Without it a later
// edit to the comments would rewrite the brief with no input timeline.
function load(recordingsDir, id) {
  const dir = resolvePackage(recordingsDir, id);
  if (!fs.existsSync(path.join(dir, 'run.json'))) {
    throw new Error('That recording was never finished, so there is nothing to open.');
  }

  let run;
  try {
    run = readRun(dir);
  } catch (error) {
    throw new Error(`That recording's run.json could not be read: ${error.message}`);
  }
  if (!run || !Array.isArray(run.keyframes)) {
    throw new Error('That recording has no list of keyframes, so it cannot be opened.');
  }

  const eventsPath = path.join(dir, inputEvents.FILE_NAME);
  const events = fs.existsSync(eventsPath)
    ? inputEvents.parseJsonl(fs.readFileSync(eventsPath, 'utf8'))
    : [];

  // The folder may have been moved since it was written; the brief should
  // name where it is now.
  run.packagePath = dir;
  run.id = id;
  if (!run.frameSize) run.frameSize = { width: 0, height: 0 };

  return { dir, run, inputEvents: events };
}

function readFrames(dir, keyframes) {
  return (Array.isArray(keyframes) ? keyframes : []).map((frame) => {
    const target = resolveFrame(dir, frame && frame.file);
    if (!target || !fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  });
}

module.exports = {
  ID_PATTERN,
  isPackageId,
  resolvePackage,
  resolveFrame,
  summarize,
  folderSize,
  list,
  load,
  readFrames
};
