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

module.exports = { PUBLIC_PROFILE, displays, microphones, build, transcript };
