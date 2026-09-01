'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  recordingsDir: '',
  microphoneId: '',
  displayId: '',
  language: 'sv',
  keepRecording: true
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaultRecordingsDir() {
  return path.join(app.getPath('videos'), 'FeedbackRecorder');
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
