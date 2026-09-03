'use strict';

// Working out whether a newer build exists, and which file this machine should
// take. Kept pure so the awkward parts — an Intel Mac being offered an arm64
// build, or a release whose name sorts higher but whose version is older — can
// be tested without a network or a running app.

// The releases the app builds are 0.2.0-style, sometimes with a build number
// alongside. Only the three numbers decide what is newer; anything after them
// is a label, not an ordering. A pre-release suffix is treated as older than
// the plain version, which is what semver says and what people expect.
function parseVersion(value) {
  const text = String(value == null ? '' : value).trim().replace(/^v/i, '');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || ''
  };
}

// -1, 0 or 1, the way a comparator is expected to behave.
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }

  // 1.0.0 is newer than 1.0.0-beta, and two pre-releases fall back to text.
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

// The rolling release keeps the same semantic version until somebody bumps it,
// so two builds from main both call themselves 0.2.0 and plain semver would
// never see a newer one. The build number is what separates them, and it is
// already in the release title the workflow writes: "FeedbackRecorder 0.2.0
// (build 10)". Both ends of that string are ours, so parsing it is a contract
// rather than a guess.
function parseRelease(name, tag) {
  const text = String(name == null ? '' : name);
  const version = (text.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/) || [])[1] || String(tag || '').replace(/^v/i, '');
  const build = (text.match(/build\s+(\d+)/i) || [])[1] || '';
  return { version, buildNumber: build ? Number(build) : null };
}

// Newer means a higher version, or the same version from a later build. The
// second half is what makes the rolling release updatable at all.
//
// Number('') is 0 rather than NaN, so a build number has to be checked for
// emptiness before it is converted — otherwise a copy built from source, which
// has no build number, would look like build 0 and be told to update for ever.
function toBuildNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isNewerBuild(candidate, current) {
  const byVersion = compareVersions(candidate.version, current.version);
  if (byVersion !== 0) return byVersion > 0;

  const theirs = toBuildNumber(candidate.buildNumber);
  const ours = toBuildNumber(current.buildNumber);
  if (theirs === null) return false;
  // No build number here means the running copy was built from source, which is
  // not something to talk anybody out of.
  if (ours === null) return false;
  return theirs > ours;
}

// An Intel Mac must not be handed an arm64 build, and an Apple Silicon Mac
// running under Rosetta reports x64 while being able to run either — so the
// caller passes what it detected rather than this guessing from process.arch.
function assetPatternsFor(platform, arch) {
  if (platform === 'win32') return [/windows.*\.exe$/i, /\.exe$/i];
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? [/macos-arm64.*\.dmg$/i, /arm64.*\.dmg$/i, /\.dmg$/i]
      : // Deliberately not a bare /\.dmg$/ fallback: on an Intel Mac an arm64
        // build will not run at all, so no download is better than one that
        // cannot open.
        [/macos-x64.*\.dmg$/i, /x64.*\.dmg$/i];
  }
  if (platform === 'linux') return [/\.appimage$/i];
  return [];
}

// The first pattern that matches wins, so the specific names are tried before
// the loose ones.
function pickAsset(assets, platform, arch) {
  const list = Array.isArray(assets) ? assets.filter((item) => item && item.name) : [];
  for (const pattern of assetPatternsFor(platform, arch)) {
    const found = list.find((item) => pattern.test(item.name));
    if (found) return found;
  }
  return null;
}

// What the UI needs to say, in one place, so the renderer does not decide policy.
function describeUpdate(options) {
  const current = (options && options.current) || {};
  const release = (options && options.release) || null;
  const platform = (options && options.platform) || '';
  const arch = (options && options.arch) || '';

  if (!release || !release.version) {
    return { available: false, reason: 'No release information was returned.' };
  }

  if (!isNewerBuild(release, current)) {
    return { available: false, upToDate: true, version: release.version };
  }

  const asset = pickAsset(release.assets, platform, arch);
  if (!asset) {
    // Being told a version exists that this machine cannot install is more
    // useful than silence, so this is reported rather than swallowed.
    return {
      available: true,
      installable: false,
      version: release.version,
      buildNumber: release.buildNumber,
      pageUrl: release.pageUrl,
      reason: 'That release has no download for this computer.'
    };
  }

  return {
    available: true,
    installable: true,
    version: release.version,
    buildNumber: release.buildNumber,
    pageUrl: release.pageUrl,
    asset: { name: asset.name, url: asset.url, size: asset.size || 0 }
  };
}

module.exports = {
  parseVersion,
  compareVersions,
  isNewer,
  isNewerBuild,
  parseRelease,
  assetPatternsFor,
  pickAsset,
  describeUpdate
};
