'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');

// Replaces a real installed copy of this app with a real disk image, and checks
// what came out. macOS only: it is the platform where updating in place was
// said to be impossible, and the reasoning that said so was half wrong.
//
// Needs a built image:
//
//   npm run dist -- --mac --arm64
//   npm run test:swap
//
// Nothing under /Applications is touched. The "installed" copy is seeded into a
// temporary folder and the updater is pointed at that, so this can be run on a
// machine that has the app installed for real without disturbing it.

const ROOT = path.join(__dirname, '..', '..');
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function report(code) {
  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  });
  console.log('');
  console.log(`${checks.filter((item) => item.passed).length}/${checks.length} checks passed`);
  app.exit(code || (checks.some((item) => !item.passed) ? 1 : 0));
}

function findImage() {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const named = fs
    .readdirSync(dist)
    .filter((name) => name.endsWith('.dmg') && name.includes(arch));
  return named.length ? path.join(dist, named[0]) : null;
}

function signatureValid(bundle) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], {
      stdio: 'ignore',
      timeout: 120000
    });
    return true;
  } catch (error) {
    return false;
  }
}

function quarantined(target) {
  try {
    execFileSync('xattr', ['-p', 'com.apple.quarantine', target], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return true;
  } catch (error) {
    return false;
  }
}

// What TCC keys on. Two builds with the same one are the same app to it, and
// keep their Screen Recording and Microphone grants across an update.
function designatedRequirement(bundle) {
  try {
    const out = execFileSync('codesign', ['--display', '-r', '-', bundle], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000
    });
    const line = out.split('\n').find((row) => row.includes('designated =>'));
    return line ? line.replace(/^#\s*/, '').trim() : '';
  } catch (error) {
    return '';
  }
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') {
    console.log('This check is macOS only; there is nothing to do here.');
    return app.exit(0);
  }

  const image = findImage();
  if (!image) {
    console.log('No disk image in app/dist. Build one first:');
    console.log('  npm run dist -- --mac --arm64');
    return app.exit(0);
  }
  console.log(`image: ${path.basename(image)}`);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-applications-'));
  const installed = path.join(home, 'FeedbackRecorder.app');

  // Seed an "already installed" copy from the same image. It is byte-identical
  // to the update, which is fine: what is under test is the replacement, and
  // the bundle's identity on disk changes either way.
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-seed-'));
  execFileSync(
    'hdiutil',
    ['attach', image, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', seed],
    { stdio: 'ignore', timeout: 120000 }
  );
  const inImage = fs.readdirSync(seed).find((name) => name.endsWith('.app'));
  execFileSync('ditto', [path.join(seed, inImage), installed], { timeout: 300000 });
  execFileSync('hdiutil', ['detach', seed, '-force'], { stdio: 'ignore', timeout: 60000 });
  fs.rmSync(seed, { recursive: true, force: true });

  // How the swap is recognised. A marker file cannot be used: anything added
  // inside a bundle breaks the signature it is there to check. The inode is
  // changed by the move and by nothing else.
  const before = {
    inode: fs.statSync(installed).ino,
    requirement: designatedRequirement(installed)
  };

  const updater = require(path.join(ROOT, 'src', 'main', 'updater.js'));
  const realGetPath = app.getPath.bind(app);
  app.getPath = (name) =>
    name === 'exe' ? path.join(installed, 'Contents', 'MacOS', 'FeedbackRecorder') : realGetPath(name);
  Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });

  check(
    'an installed copy this user owns can be replaced',
    updater.canInstallInPlace(),
    `canInstallInPlace() = ${updater.canInstallInPlace()}`
  );

  // install() ends by quitting, which would take this process with it, so the
  // quit is caught. Everything before it is the real path.
  let quitAsked = false;
  app.quit = () => {
    quitAsked = true;
  };

  let failure = null;
  let result = null;
  try {
    result = await updater.installMac(image);
  } catch (error) {
    failure = error;
  }

  check(
    'the image was opened, checked and staged without error',
    !failure && result && result.installed,
    failure ? failure.message : 'staged and handed to the helper'
  );

  // The helper waits for this process to exit, which it will not, so it gives
  // up after its own timeout and swaps anyway. That bound is what is being
  // waited on here.
  console.log('waiting for the helper…');
  const deadline = Date.now() + 90000;
  let swapped = false;
  while (Date.now() < deadline) {
    try {
      if (fs.statSync(installed).ino !== before.inode) {
        swapped = true;
        break;
      }
    } catch (error) {
      // Mid-move: the bundle is briefly not there.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  check(
    'the installed copy was replaced',
    swapped,
    swapped ? 'a different bundle is in its place' : 'the bundle never changed'
  );
  // Asked for after the wait, not before it: the quit is deliberately left a
  // moment so the helper is really running before its parent disappears.
  check(
    'the app was asked to quit so the swap could happen',
    quitAsked,
    quitAsked ? 'quit requested' : 'the app would have stayed open over its own replacement'
  );

  const runnable = fs.existsSync(path.join(installed, 'Contents', 'MacOS', 'FeedbackRecorder'));
  check('what replaced it is a working application', runnable);
  check(
    'the replacement kept its signature',
    signatureValid(installed),
    'ditto preserves the metadata a bundle is signed over'
  );
  // The reason the old advice said macOS could not do this. An app that fetches
  // its own update does not apply the attribute a browser would, so Gatekeeper
  // has nothing to challenge and the user is not sent to System Settings.
  check(
    'the replacement is not quarantined, so Gatekeeper will not challenge it',
    !quarantined(installed),
    quarantined(installed) ? 'com.apple.quarantine is set' : 'no com.apple.quarantine'
  );

  const after = designatedRequirement(installed);
  check(
    'the swap leaves nothing behind',
    !fs.readdirSync(home).some((name) => name.endsWith('.old') || name.endsWith('.new')),
    fs.readdirSync(home).join(', ')
  );

  // Reported rather than asserted, and worth reading carefully: the copy that
  // was replaced came from the same image as the update, so an identical
  // requirement here says only that the swap does not disturb one. Whether two
  // *different* builds share it is a property of how they were signed — ad-hoc
  // pins it to a hash of that exact build, a certificate makes it stable — and
  // that was measured on two genuinely different builds in docs/SIGNING.md.
  console.log('');
  console.log(`designated requirement before: ${before.requirement || '(none)'}`);
  console.log(`designated requirement after : ${after || '(none)'}`);
  console.log(
    /cdhash/.test(after)
      ? 'ad-hoc signed: a real update is a different build, so Screen Recording and\n' +
        'the microphone would be asked for again. A certificate fixes that; see docs/SIGNING.md.'
      : 'certificate-pinned: this requirement does not move between builds, so the\n' +
        'permissions already granted carry across an update.'
  );

  fs.rmSync(home, { recursive: true, force: true });
  report(0);
});
