'use strict';

const fs = require('node:fs');
const path = require('node:path');

const version = require('../shared/version');

// Where the numbers come from at runtime.
//
// scripts/write-build-info.js drops build-info.json here during a CI build. It
// is generated rather than committed, because a build number that lives in git
// would mean every build changing a tracked file, and would be wrong the moment
// somebody built from a branch.
//
// Its absence is not an error: it means somebody is running from source, and
// saying "development build" is the honest answer.

const GENERATED = path.join(__dirname, '..', 'shared', 'build-info.json');

function readGenerated() {
  try {
    return JSON.parse(fs.readFileSync(GENERATED, 'utf8'));
  } catch (error) {
    return null;
  }
}

// package.json is the source of the semantic version, and is read directly so a
// caller that cannot reach Electron's app.getVersion() — a test harness, or a
// script — still reports the right number rather than 0.0.0.
function packageVersion() {
  try {
    return require('../../package.json').version || '';
  } catch (error) {
    return '';
  }
}

function load(fallbackVersion) {
  const generated = readGenerated() || {};
  return {
    version: generated.version || fallbackVersion || packageVersion() || '0.0.0',
    buildNumber: generated.buildNumber || '',
    commit: generated.commit || '',
    date: generated.date || '',
    released: Boolean(generated.released)
  };
}

function describe(fallbackVersion) {
  const info = load(fallbackVersion);
  return Object.assign({}, info, {
    display: version.formatVersion(info),
    full: version.describeBuild(info)
  });
}

module.exports = { load, describe, GENERATED };
