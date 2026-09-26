'use strict';

// How a build identifies itself.
//
// Every published build receives a unique semantic version before the platform
// jobs start. Features advance the minor part; fixes and small polish advance
// the patch. Running from source still uses package.json and says development
// build, because it is not one of those published artifacts.
//
// buildNumber remains readable for old installed builds and old package data.
// New releases identify themselves only by their unique semantic version.

const DEV_BUILD = 'development build';

function trimmed(value) {
  return String(value == null ? '' : value).trim();
}

// Seven characters is what git itself abbreviates to, and it is enough to find
// the commit again.
function shortCommit(commit) {
  return trimmed(commit).toLowerCase().slice(0, 7);
}

// What goes next to the app's name in the window, and into a bug report.
//
// A release is named by its version alone. The build-number branch is only for
// compatibility with releases made before versions advanced automatically.
function formatVersion(info) {
  const version = trimmed(info && info.version) || '0.0.0';
  const build = trimmed(info && info.buildNumber);
  const released = Boolean(info && info.released);

  if (released) return version;
  if (build) return `${version} (build ${build})`;
  return `${version} (${DEV_BUILD})`;
}

// The long form, for --selftest and the package a bug report is attached to.
// Says where the build came from, so a report can be tied to a commit rather
// than to a version number that a dozen builds share.
function describeBuild(info) {
  const parts = [formatVersion(info)];
  const commit = shortCommit(info && info.commit);
  if (commit) parts.push(commit);
  const date = trimmed(info && info.date);
  if (date) parts.push(date);
  return parts.join(' · ');
}

function isDevelopmentBuild(info) {
  return !trimmed(info && info.buildNumber) && !(info && info.released);
}

module.exports = { DEV_BUILD, formatVersion, describeBuild, shortCommit, isDevelopmentBuild };
