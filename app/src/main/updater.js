'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { app, shell, net } = require('electron');

const updates = require('../shared/updates');
const buildInfo = require('./build-info');

// Finding out whether a newer build exists, fetching it, and handing over to it.
//
// Written against the GitHub releases API directly rather than by adding
// electron-updater, for two reasons. This app ships no production dependencies,
// and adding one to a signed, notarized binary is a supply-chain decision rather
// than a convenience. And electron-updater cannot do the part that matters on
// macOS anyway: Squirrel.Mac validates a downloaded bundle against the running
// app's designated requirement, so an unsigned or ad-hoc signed app cannot
// auto-install at all. See docs/SIGNING.md.

const REPOSITORY = 'magnuslandahl/FeedbackRecorder';
const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

const REQUEST_TIMEOUT_MS = 20000;

// An Apple Silicon Mac running this app under Rosetta reports x64, and would be
// offered the Intel build for ever. Asking the kernel is the way to tell.
function macArchitecture() {
  if (process.arch === 'arm64') return 'arm64';
  try {
    const translated = execFileSync('sysctl', ['-in', 'sysctl.proc_translated'], {
      encoding: 'utf8',
      timeout: 2000
    }).trim();
    if (translated === '1') return 'arm64';
  } catch (error) {
    // Not present on Intel Macs, which is itself the answer.
  }
  return 'x64';
}

function architecture() {
  return process.platform === 'darwin' ? macArchitecture() : process.arch;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET' });
    // Unauthenticated, because the repository is public and a token in a
    // desktop app is a token in everybody's hands.
    request.setHeader('Accept', 'application/vnd.github+json');
    request.setHeader('User-Agent', `FeedbackRecorder/${app.getVersion()}`);

    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('the update server did not answer in time'));
    }, REQUEST_TIMEOUT_MS);

    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode === 403) {
          return reject(new Error('GitHub is rate-limiting this machine. Try again later.'));
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`the update server answered ${response.statusCode}`));
        }
        try {
          return resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          return reject(new Error('the update server sent something unreadable'));
        }
      });
    });

    request.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.message || 'the update server could not be reached'));
    });

    request.end();
  });
}

async function check() {
  const running = buildInfo.load(app.getVersion());

  let payload;
  try {
    payload = await getJson(LATEST_RELEASE);
  } catch (error) {
    return { checked: false, reason: `Could not check for updates: ${error.message}`, pageUrl: RELEASES_PAGE };
  }

  const parsed = updates.parseRelease(payload.name, payload.tag_name);
  const release = {
    version: parsed.version,
    buildNumber: parsed.buildNumber,
    pageUrl: payload.html_url || RELEASES_PAGE,
    assets: (payload.assets || []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size
    }))
  };

  const result = updates.describeUpdate({
    current: { version: running.version, buildNumber: running.buildNumber },
    release,
    platform: process.platform,
    arch: architecture()
  });

  return Object.assign(
    { checked: true, currentVersion: running.version, pageUrl: release.pageUrl, inPlace: canInstallInPlace() },
    result
  );
}

function download(url, target, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'follow' });
    request.setHeader('User-Agent', `FeedbackRecorder/${app.getVersion()}`);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`the download answered ${response.statusCode}`));
      }

      const total = Number(response.headers['content-length'] || 0);
      let received = 0;

      // Written to a .part file and renamed only once complete, so an
      // interrupted download can never be mistaken for an installer.
      const partial = `${target}.part`;
      const file = fs.createWriteStream(partial);

      response.on('data', (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (onProgress && total) onProgress(received / total);
      });

      response.on('end', () => {
        file.end(() => {
          try {
            if (total && received < total) {
              fs.unlinkSync(partial);
              return reject(new Error('the download stopped early'));
            }
            fs.renameSync(partial, target);
            return resolve(target);
          } catch (error) {
            return reject(error);
          }
        });
      });

      response.on('error', (error) => {
        file.destroy();
        reject(error);
      });

      return undefined;
    });

    request.on('error', (error) => reject(new Error(error.message || 'the download failed')));
    request.end();
  });
}

// Where an update is allowed to install itself, and where it is not.
//
// Windows: the NSIS installer upgrades in place and relaunches.
//
// macOS: yes, now, and the reasoning that said otherwise was half right. It
// assumed the new copy would come back quarantined and be put behind a
// Gatekeeper warning. Quarantine is applied by whatever *downloads* a file, and
// an app writing a file with its own network stack does not apply it — measured:
// a release asset fetched through net.request carries no com.apple.quarantine at
// all, where the same file fetched by Safari carries `0083;…;Safari;…`. An app
// extracted from an unquarantined image launches with no challenge; that was
// checked by launching one.
//
// What this does *not* fix is Screen Recording and Microphone. TCC identifies an
// app by its designated requirement, and an ad-hoc signature's requirement is a
// hash of that exact build, so every update is a different app to it and the
// permissions have to be granted again. A certificate — even a free self-signed
// one — makes that requirement stable. See docs/SIGNING.md, where both halves
// are measured.
//
// Requires a bundle this user may replace. An app somebody else installed, or
// one running from a read-only mount, falls back to opening the image.
function macAppBundle() {
  if (!app.isPackaged) return null;
  // …/FeedbackRecorder.app/Contents/MacOS/FeedbackRecorder
  const bundle = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
  if (!bundle.endsWith('.app')) return null;
  return bundle;
}

function canReplaceMacApp() {
  const bundle = macAppBundle();
  if (!bundle) return false;
  try {
    // Both the bundle and the folder holding it: the swap moves the whole
    // bundle aside, which is a write to its parent.
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function canInstallInPlace() {
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return canReplaceMacApp();
  return false;
}

// Opening a disk image, checking what is inside it is really this app, and
// putting it where the running copy is. Each step is undone on the way out, so a
// failure leaves nothing mounted and nothing half-replaced.
function mountImage(dmgPath) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-update-'));
  execFileSync(
    'hdiutil',
    ['attach', dmgPath, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint],
    { stdio: 'ignore', timeout: 120000 }
  );
  return mountPoint;
}

function unmountImage(mountPoint) {
  try {
    execFileSync('hdiutil', ['detach', mountPoint, '-force'], { stdio: 'ignore', timeout: 60000 });
  } catch (error) {
    // Already gone, or busy. Not worth failing an otherwise finished update.
  }
  try {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  } catch (error) {
    // The mount point is a directory macOS owns once detached.
  }
}

// An update is a replacement for *this* app, so the thing in the image has to
// be this app: a valid signature, and the same bundle identifier. Without this
// the updater would hand whatever the download happened to contain the identity,
// the permissions and the launch of the copy it replaces.
function verifyBundle(candidate) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', candidate], {
      stdio: 'ignore',
      timeout: 120000
    });
  } catch (error) {
    throw new Error('the downloaded copy is not correctly signed, so it was not installed');
  }

  let identifier = '';
  try {
    identifier = execFileSync(
      'defaults',
      ['read', path.join(candidate, 'Contents', 'Info'), 'CFBundleIdentifier'],
      { encoding: 'utf8', timeout: 20000 }
    ).trim();
  } catch (error) {
    throw new Error('the downloaded copy has no bundle identifier, so it was not installed');
  }

  const mine = app.isPackaged ? 'com.feedbackrecorder.app' : identifier;
  if (identifier !== mine) {
    throw new Error(`the downloaded copy is ${identifier}, not FeedbackRecorder`);
  }
}

// The swap cannot happen from inside the app being swapped, so it is handed to a
// short script that waits for this process to go and then does it. Written to
// disk rather than passed as -c, so a path with a space or a quote in it cannot
// change what runs.
function writeSwapScript(bundle, staged) {
  const script = path.join(os.tmpdir(), `fr-swap-${process.pid}.sh`);
  const backup = `${bundle}.old`;

  fs.writeFileSync(
    script,
    `#!/bin/sh
# Replaces FeedbackRecorder once the copy that asked for it has exited.
APP=${JSON.stringify(bundle)}
NEW=${JSON.stringify(staged)}
OLD=${JSON.stringify(backup)}

# Wait for the running copy to go, but never for ever.
i=0
while kill -0 ${process.pid} 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 300 ] && break
  sleep 0.1
done

rm -rf "$OLD"
mv "$APP" "$OLD" || exit 1
if ! mv "$NEW" "$APP"; then
  # Put the working copy back rather than leaving nothing installed.
  mv "$OLD" "$APP"
  exit 1
fi
rm -rf "$OLD"
open "$APP"
rm -f "$0"
`,
    { mode: 0o700 }
  );

  return script;
}

async function installMac(dmgPath) {
  const bundle = macAppBundle();
  if (!bundle) throw new Error('this copy is not an installed application');

  const mountPoint = mountImage(dmgPath);
  const staged = path.join(path.dirname(bundle), `.${path.basename(bundle)}.new`);

  try {
    const entry = fs
      .readdirSync(mountPoint)
      .find((name) => name.endsWith('.app'));
    if (!entry) throw new Error('the disk image holds no application');

    verifyBundle(path.join(mountPoint, entry));

    // ditto rather than cp: it is the tool that keeps extended attributes,
    // symlinks and the signature's own metadata intact. A bundle copied without
    // them fails its own signature check.
    fs.rmSync(staged, { recursive: true, force: true });
    execFileSync('ditto', [path.join(mountPoint, entry), staged], { timeout: 300000 });
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    unmountImage(mountPoint);
    throw error;
  }

  unmountImage(mountPoint);

  const script = writeSwapScript(bundle, staged);
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();

  // Given a moment so the helper is really running before its parent goes.
  setTimeout(() => app.quit(), 800);
  return { installed: true, path: bundle };
}

async function install(asset, onProgress) {
  if (!asset || !asset.url) throw new Error('There is nothing to download.');

  const target = path.join(os.tmpdir(), asset.name);
  await download(asset.url, target, onProgress);

  if (canInstallInPlace() && process.platform === 'darwin') {
    try {
      return await installMac(target);
    } catch (error) {
      // A failed swap is not a dead end: the image is downloaded and opening it
      // is the route that has always worked.
      await shell.openPath(target);
      return { installed: false, opened: true, path: target, reason: error.message };
    }
  }

  if (!canInstallInPlace()) {
    if (process.platform === 'darwin') {
      // Mounts the disk image and opens it in Finder, which is the step the
      // person would take themselves.
      await shell.openPath(target);
    } else {
      // An AppImage is a program, and opening a freshly downloaded one would
      // run it rather than install it. Showing where it landed is the useful
      // thing; making it executable and putting it somewhere is the user's call.
      shell.showItemInFolder(target);
    }
    return { installed: false, opened: true, path: target };
  }

  // The same arguments electron-updater passes to an electron-builder NSIS
  // installer: install without asking again, then start the new copy. Safe to
  // run silently because the installer is perMachine: false, so it writes into
  // the user's own profile and never needs elevation.
  const child = spawn(target, ['/S', '--force-run'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // The installer cannot replace files that are still open, so this copy has to
  // go. Given a moment first, so the process is actually running before its
  // parent disappears.
  setTimeout(() => app.quit(), 1200);
  return { installed: true, path: target };
}

// download and installMac are exported for the checks that exercise the real
// thing rather than a stub: test/electron/update-download.js fetches from the
// real release, and test/electron/update-swap.js replaces a real installed copy
// with a real disk image.
module.exports = {
  check,
  install,
  installMac,
  download,
  architecture,
  canInstallInPlace,
  RELEASES_PAGE
};
