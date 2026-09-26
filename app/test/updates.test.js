'use strict';

const test = require('node:test');
const assert = require('node:assert');

const updates = require('../src/shared/updates');

const RELEASE_ROOT = 'https://github.com/magnuslandahl/FeedbackRecorder/releases/download/latest';

// The asset names the release workflow actually publishes. Copied from a real
// release rather than invented, because a test that matches names we never
// build would pass while the feature was broken.
const RELEASE_ASSETS = [
  { name: 'FeedbackRecorder-Linux-x86_64.AppImage', url: `${RELEASE_ROOT}/FeedbackRecorder-Linux-x86_64.AppImage`, size: 1 },
  { name: 'FeedbackRecorder-macOS-arm64.dmg', url: `${RELEASE_ROOT}/FeedbackRecorder-macOS-arm64.dmg`, size: 2 },
  { name: 'FeedbackRecorder-macOS-x64.dmg', url: `${RELEASE_ROOT}/FeedbackRecorder-macOS-x64.dmg`, size: 3 },
  { name: 'FeedbackRecorder-Windows-x64-Setup.exe', url: `${RELEASE_ROOT}/FeedbackRecorder-Windows-x64-Setup.exe`, size: 4 },
  { name: 'SHA256SUMS.txt', url: `${RELEASE_ROOT}/SHA256SUMS.txt`, size: 5 }
];

test('versions are ordered by their numbers, not as text', () => {
  // '0.10.0' sorts below '0.9.0' as a string, which would strand everybody on
  // the older build at exactly the point the numbers start mattering.
  assert.strictEqual(updates.isNewer('0.10.0', '0.9.0'), true);
  assert.strictEqual(updates.isNewer('1.0.0', '0.99.99'), true);
  assert.strictEqual(updates.isNewer('0.2.0', '0.2.0'), false);
  assert.strictEqual(updates.isNewer('0.1.0', '0.2.0'), false);
});

test('a pre-release is older than the version it leads to', () => {
  assert.strictEqual(updates.isNewer('1.0.0', '1.0.0-beta.1'), true);
  assert.strictEqual(updates.isNewer('1.0.0-beta.1', '1.0.0'), false);
});

test('a leading v is accepted, because tags have one', () => {
  assert.strictEqual(updates.isNewer('v0.3.0', '0.2.0'), true);
});

test('the current release title supplies its semantic version', () => {
  assert.deepStrictEqual(
    updates.parseRelease('FeedbackRecorder 0.3.0', 'latest'),
    { version: '0.3.0', buildNumber: null }
  );
});

test('an older release title still supplies its legacy build number', () => {
  assert.deepStrictEqual(
    updates.parseRelease('FeedbackRecorder 0.2.0 (build 11)', 'latest'),
    { version: '0.2.0', buildNumber: 11 }
  );
});

test('a tagged release falls back to its tag when the title says nothing', () => {
  assert.deepStrictEqual(
    updates.parseRelease('Some other wording', 'v1.2.3'),
    { version: '1.2.3', buildNumber: null }
  );
});

test('an older same-version build number remains comparable', () => {
  assert.strictEqual(
    updates.isNewerBuild({ version: '0.2.0', buildNumber: 11 }, { version: '0.2.0', buildNumber: '10' }),
    true
  );
  assert.strictEqual(
    updates.isNewerBuild({ version: '0.2.0', buildNumber: 10 }, { version: '0.2.0', buildNumber: '10' }),
    false
  );
});

test('a copy built from source is never told it is out of date', () => {
  // Number('') is 0, so an unguarded comparison would read a missing build
  // number as build zero and nag a developer on every launch.
  assert.strictEqual(
    updates.isNewerBuild({ version: '0.2.0', buildNumber: 11 }, { version: '0.2.0', buildNumber: '' }),
    false
  );
});

test('an Intel Mac is never offered an Apple Silicon build', () => {
  // An arm64 .dmg will not open at all on an Intel Mac, so a loose ".dmg"
  // fallback would hand somebody a download that cannot possibly work.
  const chosen = updates.pickAsset(RELEASE_ASSETS, 'darwin', 'x64');
  assert.strictEqual(chosen.name, 'FeedbackRecorder-macOS-x64.dmg');

  const armOnly = RELEASE_ASSETS.filter((asset) => !asset.name.includes('x64.dmg'));
  assert.strictEqual(updates.pickAsset(armOnly, 'darwin', 'x64'), null);
});

test('each platform is given its own file', () => {
  assert.strictEqual(updates.pickAsset(RELEASE_ASSETS, 'darwin', 'arm64').name, 'FeedbackRecorder-macOS-arm64.dmg');
  assert.strictEqual(updates.pickAsset(RELEASE_ASSETS, 'win32', 'x64').name, 'FeedbackRecorder-Windows-x64-Setup.exe');
  assert.strictEqual(updates.pickAsset(RELEASE_ASSETS, 'linux', 'x64').name, 'FeedbackRecorder-Linux-x86_64.AppImage');
});

test('the checksums file is never mistaken for a download', () => {
  assert.strictEqual(updates.pickAsset([RELEASE_ASSETS[4]], 'win32', 'x64'), null);
});

test('an up-to-date app is told so plainly', () => {
  const result = updates.describeUpdate({
    current: { version: '0.3.0' },
    release: { version: '0.3.0', assets: RELEASE_ASSETS },
    platform: 'win32',
    arch: 'x64'
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.upToDate, true);
});

test('an available update carries the file to fetch', () => {
  const result = updates.describeUpdate({
    current: { version: '0.3.0' },
    release: { version: '0.3.1', pageUrl: 'https://example.invalid/page', assets: RELEASE_ASSETS },
    platform: 'win32',
    arch: 'x64'
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.installable, true);
  assert.strictEqual(result.version, '0.3.1');
  assert.strictEqual(result.asset.name, 'FeedbackRecorder-Windows-x64-Setup.exe');
  assert.strictEqual(result.asset.checksumUrl, `${RELEASE_ROOT}/SHA256SUMS.txt`);
});

test('an update without exactly one trusted checksum asset cannot be installed', () => {
  for (const assets of [
    RELEASE_ASSETS.slice(0, -1),
    RELEASE_ASSETS.concat(RELEASE_ASSETS[4]),
    RELEASE_ASSETS.slice(0, -1).concat({
      name: 'SHA256SUMS.txt',
      url: 'http://github.com/magnuslandahl/FeedbackRecorder/releases/download/latest/SHA256SUMS.txt'
    })
  ]) {
    const result = updates.describeUpdate({
      current: { version: '0.3.0' },
      release: { version: '0.3.1', assets },
      platform: 'win32',
      arch: 'x64'
    });
    assert.strictEqual(result.installable, false);
    assert.match(result.reason, /checksums/);
  }
});

test('checksums must come from the same FeedbackRecorder release as the installer', () => {
  for (const checksumUrl of [
    'https://github.com/another/project/releases/download/latest/SHA256SUMS.txt',
    'https://github.com/magnuslandahl/FeedbackRecorder/releases/download/older/SHA256SUMS.txt'
  ]) {
    const assets = RELEASE_ASSETS.slice(0, -1).concat({
      name: 'SHA256SUMS.txt',
      url: checksumUrl
    });
    const result = updates.describeUpdate({
      current: { version: '0.3.0' },
      release: { version: '0.3.1', assets },
      platform: 'win32',
      arch: 'x64'
    });
    assert.strictEqual(result.installable, false);
    assert.match(result.reason, /untrusted/);
  }
});

test('a release with nothing for this machine says so instead of going quiet', () => {
  const result = updates.describeUpdate({
    current: { version: '0.3.0' },
    release: { version: '0.4.0', pageUrl: 'https://example.invalid/page', assets: [RELEASE_ASSETS[4]] },
    platform: 'win32',
    arch: 'x64'
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.installable, false);
  assert.ok(result.reason);
  assert.strictEqual(result.pageUrl, 'https://example.invalid/page');
});

test('an unreadable release is not reported as an update', () => {
  const result = updates.describeUpdate({ current: { version: '0.2.0' }, release: null, platform: 'win32', arch: 'x64' });
  assert.strictEqual(result.available, false);
});
