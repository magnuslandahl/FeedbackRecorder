'use strict';

// How a build identifies itself.
//
// The semantic version in package.json is bumped deliberately, by a human, when
// a release means something. The build number is not: it comes from the CI run
// and climbs on its own, so two builds of the same version can still be told
// apart. That split is the point. Auto-incrementing the semantic version on
// every merge would need CI to push back to a protected branch, and would make
// the number say "this changed a lot" when nothing did.
//
// So a build from main reads 0.2.0 (build 42), and a tagged release reads 0.2.0.

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
// A release is named by its version alone: the tag is the identity, and a build
// number would only be noise. Anything else says which build it is, because
// "0.2.0" on its own would be a different claim from what it is - one of many
// builds that all call themselves 0.2.0.
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
