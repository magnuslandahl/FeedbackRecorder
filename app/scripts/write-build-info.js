'use strict';

// Writes src/shared/build-info.json so a packaged app can say which build it is.
//
//   node scripts/write-build-info.js
//
// Everything comes from the environment GitHub Actions already sets, so there is
// nothing to keep in step by hand. Run it before packaging; without it the app
// reports itself as a development build, which is what running from source is.
//
// The file is generated rather than committed. A build number in git would mean
// every build dirtying a tracked file, and would be a lie the moment somebody
// built the same commit twice.

const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');

const TARGET = path.join(__dirname, '..', 'src', 'shared', 'build-info.json');

function main() {
  const ref = process.env.GITHUB_REF || '';
  const tagged = ref.startsWith('refs/tags/');

  const info = {
    version: pkg.version,
    // A tagged release is named by its version alone, so it carries no build
    // number: the tag is the identity.
    buildNumber: tagged ? '' : String(process.env.GITHUB_RUN_NUMBER || '').trim(),
    commit: String(process.env.GITHUB_SHA || '').trim(),
    date: new Date().toISOString().slice(0, 10),
    released: tagged
  };

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

  const { formatVersion } = require('../src/shared/version');
  console.log(`build-info.json -> ${formatVersion(info)}${info.commit ? ` (${info.commit.slice(0, 7)})` : ''}`);
}

main();
