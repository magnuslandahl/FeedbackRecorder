'use strict';

const test = require('node:test');
const assert = require('node:assert');

const version = require('../src/shared/version');
const { buildBrief } = require('../src/shared/brief');

test('a build from main is told apart from other builds of the same version', () => {
  // The whole point of the build number: without it, every build from main
  // calls itself 0.2.0 and a bug report cannot say which one.
  assert.strictEqual(
    version.formatVersion({ version: '0.2.0', buildNumber: '42' }),
    '0.2.0 (build 42)'
  );
});

test('a tagged release is named by its version alone', () => {
  // The tag is the identity there, so a build number would only be noise.
  assert.strictEqual(
    version.formatVersion({ version: '0.2.0', buildNumber: '42', released: true }),
    '0.2.0'
  );
  assert.strictEqual(version.formatVersion({ version: '1.0.0', released: true }), '1.0.0');
});

test('running from source says so rather than claiming to be a release', () => {
  assert.strictEqual(version.formatVersion({ version: '0.2.0' }), '0.2.0 (development build)');
  assert.ok(version.isDevelopmentBuild({ version: '0.2.0' }));
  assert.ok(!version.isDevelopmentBuild({ version: '0.2.0', buildNumber: '42' }));
  assert.ok(!version.isDevelopmentBuild({ version: '0.2.0', released: true }));
});

test('a missing version degrades to something printable', () => {
  assert.strictEqual(version.formatVersion({}), '0.0.0 (development build)');
  assert.strictEqual(version.formatVersion(null), '0.0.0 (development build)');
});

test('the long form carries the commit, so a report ties to code', () => {
  assert.strictEqual(
    version.describeBuild({
      version: '0.2.0',
      buildNumber: '42',
      commit: '9F8E7D6C5B4A39281706',
      date: '2026-09-03'
    }),
    '0.2.0 (build 42) · 9f8e7d6 · 2026-09-03'
  );
});

test('the long form is still readable when there is nothing to add', () => {
  assert.strictEqual(version.describeBuild({ version: '0.2.0' }), '0.2.0 (development build)');
});

test('a commit is abbreviated the way git abbreviates it', () => {
  assert.strictEqual(version.shortCommit('9f8e7d6c5b4a39281706'), '9f8e7d6');
  assert.strictEqual(version.shortCommit(''), '');
  assert.strictEqual(version.shortCommit(null), '');
});

test('the brief names the build that made the package', () => {
  // A bug report arrives with the package attached, and "it did this" is only
  // actionable if it says which build did it.
  const brief = buildBrief({
    id: '2026-09-03-120000',
    packagePath: '/packages/2026-09-03-120000',
    durationSeconds: 30,
    frameSize: { width: 1920, height: 1080 },
    keyframes: [],
    build: { full: '0.2.0 (build 42) · 9f8e7d6 · 2026-09-03' }
  });
  assert.match(brief, /Made by: FeedbackRecorder 0\.2\.0 \(build 42\) · 9f8e7d6/);
});

test('a package made before builds were stamped still produces a brief', () => {
  const brief = buildBrief({
    id: '2026-09-01-100000',
    packagePath: '/packages/2026-09-01-100000',
    durationSeconds: 10,
    frameSize: { width: 1280, height: 720 },
    keyframes: []
  });
  assert.doesNotMatch(brief, /Made by:/);
});
