'use strict';

const demo = require('./public-demo');

const PUBLIC_PROFILE = Object.freeze({
  mode: 'public',
  language: 'en',
  theme: 'light',
  version: '0.4.0',
  build: 'release build',
  runId: 'demo-review',
  startedAt: '2025-01-15T10:30:00.000Z',
  elapsedSeconds: 42,
  recordingName: 'feedback-demo.webm',
  packageLabel: 'Saved locally · share only when ready',
  packageFolder: 'FeedbackRecorder/demo-review',
  zipName: 'FeedbackRecorder-demo-review.zip'
});

function displays() {
  return [
    {
      kind: 'screen',
      id: 'public-demo-display',
      sourceId: 'public-demo-source',
      name: 'Demo workspace',
      resolution: '1280 × 720',
      isPrimary: true,
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      scaleFactor: 1,
      captureWidth: 1280,
      captureHeight: 720,
      thumbnail: demo.thumbnailDataUrl(),
      thumbnailBlank: false
    }
  ];
}

function microphones() {
  return [{ kind: 'audioinput', deviceId: 'public-demo-microphone', label: 'Demo microphone' }];
}

function build() {
  return {
    version: PUBLIC_PROFILE.version,
    buildNumber: '',
    released: true,
    display: PUBLIC_PROFILE.version,
    full: `${PUBLIC_PROFILE.version} (${PUBLIC_PROFILE.build})`
  };
}

function transcript() {
  return {
    available: true,
    language: 'en',
    requestedLanguage: 'en',
    segments: [
      { start: 2.4, end: 7.8, text: 'The notification choice is easy to miss after saving.' },
      { start: 12.1, end: 18.6, text: 'Keep the selected option visible and confirm the change.' }
    ]
  };
}

// Earlier recordings for the Recordings screen, shaped as history:list returns
// them. Invented reviews, so no real folder name, path or note leaks into a
// public screenshot.
function recordings() {
  const item = (id, startedAt, durationSeconds, name, keyframeCount, commentCount, snippet) => ({
    id,
    status: 'complete',
    startedAt,
    durationSeconds,
    source: { kind: name.endsWith('.webm') ? 'import' : 'recording', name },
    keyframeCount,
    commentCount,
    degraded: 0,
    snippet,
    searchText: `${name} ${snippet}`.toLowerCase(),
    sizeBytes: 2_400_000 + keyframeCount * 180_000
  });
  return [
    item(
      '2025-01-15-103000',
      PUBLIC_PROFILE.startedAt,
      42,
      'Demo workspace',
      4,
      2,
      'Keep the chosen notification option visible after saving.'
    ),
    item(
      '2025-01-14-161245',
      '2025-01-14T15:12:45.000Z',
      95,
      'Demo workspace',
      7,
      0,
      'The settings page jumps when the language list finishes loading.'
    ),
    item(
      '2025-01-13-091510',
      '2025-01-13T08:15:10.000Z',
      28,
      PUBLIC_PROFILE.recordingName,
      3,
      1,
      'The empty state needs a clearer call to action.'
    ),
    { id: '2025-01-12-140002', status: 'unfinished', searchText: '', sizeBytes: 1_200_000 }
  ];
}

module.exports = { PUBLIC_PROFILE, displays, microphones, build, transcript, recordings };
