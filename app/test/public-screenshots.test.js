'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fixtures = require('./electron/public-fixtures');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');

test('public screenshot profile is deliberately fixed and sanitized', () => {
  assert.deepStrictEqual(
    {
      language: fixtures.PUBLIC_PROFILE.language,
      theme: fixtures.PUBLIC_PROFILE.theme,
      version: fixtures.PUBLIC_PROFILE.version,
      startedAt: fixtures.PUBLIC_PROFILE.startedAt,
      elapsedSeconds: fixtures.PUBLIC_PROFILE.elapsedSeconds,
      recordingName: fixtures.PUBLIC_PROFILE.recordingName,
      zipName: fixtures.PUBLIC_PROFILE.zipName
    },
    {
      language: 'en',
      theme: 'light',
      version: '0.4.0',
      startedAt: '2025-01-15T10:30:00.000Z',
      elapsedSeconds: 42,
      recordingName: 'feedback-demo.webm',
      zipName: 'FeedbackRecorder-demo-review.zip'
    }
  );

  assert.deepStrictEqual(fixtures.microphones().map((item) => item.label), ['Demo microphone']);
  assert.deepStrictEqual(fixtures.displays().map((item) => item.name), ['Demo workspace']);
  assert.ok(fixtures.displays().every((item) => item.thumbnail.startsWith('data:image/svg+xml;base64,')));
});

test('public screenshot harness has no route to live capture or local identity', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, 'electron', 'public-preload.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'electron', 'public-fixtures.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'electron', 'public-demo.js'), 'utf8')
  ].join('\n');

  [
    'desktopCapturer',
    'getDisplayMedia',
    'getUserMedia',
    'enumerateDevices',
    'getAllDisplays',
    'os.homedir',
    'process.env',
    'Date.now',
    'new Date',
    'shell.openExternal',
    'webUtils.getPathForFile'
  ].forEach((term) => assert.doesNotMatch(source, new RegExp(term.replace('.', '\\.')), term));
  assert.match(source, /cannot record a live display/);
  assert.match(source, /never read a video from disk/);
});

test('public screenshot command writes the documented curated asset names', () => {
  const packageJson = require('../package.json');
  const source = fs.readFileSync(path.join(__dirname, 'electron', 'screenshots.js'), 'utf8');
  assert.strictEqual(packageJson.scripts['shots:public'], 'electron test/electron/screenshots.js --public');
  ['handoff-with-comments', 'recording-controller', 'framing-region', 'social-preview'].forEach(
    (name) => assert.match(source, new RegExp(name))
  );
  assert.match(source, /PUBLIC_MODE/);
  assert.match(source, /capturePublicScreenshots/);
  assert.ok(fs.existsSync(path.join(ROOT, 'docs')));
});
