'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const { isSyncedLocation } = require('../shared/paths');
const languages = require('../shared/languages');

const DEFAULTS = {
  recordingsDir: '',
  microphoneId: '',
  displayId: '',
  language: languages.DEFAULT_LANGUAGE,
  keepRecording: true
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Windows folder redirection quietly points Videos at OneDrive; see
// shared/paths.js for why recordings must not land there by default.
function defaultRecordingsDir() {
  let videos;
  try {
    videos = app.getPath('videos');
  } catch (error) {
    videos = '';
  }

  if (videos && !isSyncedLocation(videos)) return path.join(videos, 'FeedbackRecorder');
  return path.join(app.getPath('home'), 'FeedbackRecorder');
}

function load() {
  const merged = Object.assign({}, DEFAULTS);
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    Object.assign(merged, JSON.parse(raw));
  } catch (error) {
    // No settings yet, or unreadable settings. Defaults are a valid answer.
  }
  if (!merged.recordingsDir) merged.recordingsDir = defaultRecordingsDir();
  // A hand-edited or stale language would be rejected by the transcriber, and
  // the recording is the thing that cannot be made again.
  merged.language = languages.normalize(merged.language);
  return merged;
}

function save(patch) {
  const next = Object.assign(load(), patch || {});
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    // Losing a preference is not worth failing a recording over.
  }
  return next;
}

module.exports = { DEFAULTS, load, save, defaultRecordingsDir, settingsPath };
