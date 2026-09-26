'use strict';

const test = require('node:test');
const assert = require('node:assert');

const releaseVersion = require('../scripts/next-version');

test('a feature advances the minor version and resets the patch', () => {
  assert.strictEqual(releaseVersion.bumpVersion('0.2.7', 'minor'), '0.3.0');
});

test('a small change advances only the patch version', () => {
  assert.strictEqual(releaseVersion.bumpVersion('0.2.7', 'patch'), '0.2.8');
});

test('the current rolling release title supplies the starting version', () => {
  assert.strictEqual(
    releaseVersion.currentVersion('FeedbackRecorder 0.2.0 (build 34)'),
    '0.2.0'
  );
});

test('feature labels request a minor release', () => {
  for (const label of ['enhancement', 'feature', 'version:minor', 'semver:minor']) {
    assert.strictEqual(releaseVersion.classifyBump({ labels: [label] }).bump, 'minor', label);
  }
});

test('fix labels request a patch release', () => {
  for (const label of ['bug', 'documentation', 'version:patch', 'semver:patch']) {
    assert.strictEqual(releaseVersion.classifyBump({ labels: [label] }).bump, 'patch', label);
  }
});

test('a conventional feature title requests a minor release', () => {
  assert.strictEqual(
    releaseVersion.classifyBump({ title: 'feat(updater): install in one click' }).bump,
    'minor'
  );
  assert.strictEqual(
    releaseVersion.classifyBump({ title: 'Feature: import an existing recording' }).bump,
    'minor'
  );
});

test('an unlabelled change safely defaults to a new patch version', () => {
  const first = releaseVersion.nextVersion({ current: '0.2.0' });
  const second = releaseVersion.nextVersion({ current: first.version });
  assert.deepStrictEqual(
    [first.version, second.version],
    ['0.2.1', '0.2.2']
  );
});

test('a manual release choice overrides labels', () => {
  assert.strictEqual(
    releaseVersion.classifyBump({ labels: ['enhancement'], override: 'patch' }).bump,
    'patch'
  );
});

test('invalid versions and bump names fail instead of publishing 0.0.0', () => {
  assert.throws(() => releaseVersion.currentVersion('latest'), /Could not find/);
  assert.throws(() => releaseVersion.bumpVersion('0.2.0', 'large'), /minor.*patch/);
});
