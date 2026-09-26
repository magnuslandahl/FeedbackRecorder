'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const vendor = require('../scripts/fetch-vendor');
const updates = require('../src/shared/updates');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');

test('the packaged app has no production npm dependencies', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(APP, 'package-lock.json'), 'utf8'));
  assert.deepStrictEqual(manifest.dependencies || {}, {});
  assert.deepStrictEqual((lock.packages[''] || {}).dependencies || {}, {});
});

test('every downloaded vendor input has immutable hash metadata', () => {
  const inputs = [
    ...Object.values(vendor.MODELS),
    ...Object.values(vendor.RELEASE_ARCHIVES)
  ];
  assert.ok(inputs.length >= 5);
  for (const input of inputs) {
    assert.ok(Number.isInteger(input.size) && input.size > 0, input.file);
    assert.match(input.sha256, /^[a-f0-9]{64}$/, input.file);
    if (input.url) assert.doesNotMatch(input.url, /resolve\/main\//, input.file);
  }
  assert.match(vendor.WHISPER_COMMIT, /^[a-f0-9]{40}$/);
});

test('updater checksum enforcement remains on the install path', () => {
  const source = fs.readFileSync(path.join(APP, 'src', 'main', 'updater.js'), 'utf8');
  assert.match(source, /result\.asset = await bindUpdate\(release\.id, result\.asset\)/);
  assert.match(source, /const \{ target \} = await fetchSelectedUpdate\(asset, onProgress\)/);
  assert.match(source, /validateCurrentRelease\(selected, current\)/);
  assert.match(source, /asset\.expectedSha256/);
  assert.match(source, /checksums\.finalizeDownload\(partial, target, expectedSha256\)/);
});

test('the privacy documentation names every updater network host', () => {
  const privacy = fs.readFileSync(path.join(ROOT, 'docs', 'PRIVACY.md'), 'utf8');
  for (const host of updates.UPDATE_NETWORK_HOSTS) {
    assert.match(privacy, new RegExp(host.replaceAll('.', '\\.')));
  }
});
