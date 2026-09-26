'use strict';

// Writes src/shared/build-info.json so a packaged app can say which build it is.
//
//   node scripts/write-build-info.js
//
// Everything comes from the environment GitHub Actions already sets, so there is
// nothing to keep in step by hand. Run it before packaging; without it the app
// reports itself as a development build, which is what running from source is.
//
// The file is generated rather than committed. The release workflow chooses a
// unique semantic version before any platform starts, then all three builds
// write that same version here.

const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');

const TARGET = path.join(__dirname, '..', 'src', 'shared', 'build-info.json');

function main() {
  const ref = process.env.GITHUB_REF || '';
  const tagged = ref.startsWith('refs/tags/');
  const released = tagged || process.env.RELEASE_BUILD === 'true';

  const info = {
    version: pkg.version,
    commit: String(process.env.GITHUB_SHA || '').trim(),
    date: new Date().toISOString().slice(0, 10),
    released
  };

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

  const { describeBuild } = require('../src/shared/version');
  console.log(`build-info.json -> ${describeBuild(info)}`);
}

main();
