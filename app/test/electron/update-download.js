'use strict';

// Downloads the real release asset through the shipped code path and checks it
// against what the release said it was.
//
// Deliberately not part of `npm test`: it needs the network and moves a hundred
// megabytes or so. Run it by hand when the update path changes.
//
//   npx electron test/electron/update-download.js

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');

app.whenReady().then(async () => {
  const updater = require(path.join(ROOT, 'src', 'main', 'updater.js'));
  const buildInfo = require(path.join(ROOT, 'src', 'main', 'build-info.js'));

  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed, detail });

  // Claim to be an ancient build, so the current release is genuinely newer and
  // there is something real to fetch.
  const realLoad = buildInfo.load;
  buildInfo.load = () => Object.assign({}, realLoad('0.0.1'), { version: '0.0.1', buildNumber: '1' });

  const result = await updater.check();
  buildInfo.load = realLoad;

  console.log(JSON.stringify(result, null, 2));
  console.log('');

  check('the release was reachable', result.checked === true, result.reason || '');
  check('an update was found', result.available === true);
  check(
    'a file was chosen for this machine',
    Boolean(result.asset && result.asset.url),
    result.asset && result.asset.name
  );
  check('the architecture resolved', ['x64', 'arm64'].includes(updater.architecture()), updater.architecture());

  if (result.asset) {
    const target = path.join(app.getPath('temp'), `verify-${result.asset.name}`);
    for (const stray of [target, `${target}.part`]) {
      if (fs.existsSync(stray)) fs.unlinkSync(stray);
    }

    let lastFraction = 0;
    const started = Date.now();
    await updater.download(result.asset.url, target, (fraction) => {
      lastFraction = fraction;
    });
    const seconds = Math.round((Date.now() - started) / 1000);

    const size = fs.statSync(target).size;
    check('the download completed', size > 0, `${size} bytes in ${seconds}s`);
    check('the size matches what the release reported', size === result.asset.size, `${size} vs ${result.asset.size}`);
    check('progress was reported through to the end', lastFraction > 0.99, lastFraction.toFixed(3));
    check('nothing partial was left behind', !fs.existsSync(`${target}.part`));

    const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    console.log(`sha256  ${digest}  ${result.asset.name}`);
    console.log('Compare against SHA256SUMS.txt in the same release.');
    console.log('');
    fs.unlinkSync(target);
  }

  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  const passed = checks.filter((item) => item.passed).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  app.exit(passed === checks.length ? 0 : 1);
});
