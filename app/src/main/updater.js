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
// Windows: the NSIS installer upgrades in place and relaunches, so this is a
// real one-click update.
//
// macOS: not without a Developer ID certificate. Replacing a running .app whose
// signature changes every build breaks two things at once — Gatekeeper puts the
// new copy back behind a warning, and TCC identifies apps by bundle ID *and*
// code requirement, so Screen Recording and Microphone are silently revoked and
// have to be granted again. Opening the disk image and letting the user drag it
// across is the honest option until the app is signed.
function canInstallInPlace() {
  return process.platform === 'win32';
}

async function install(asset, onProgress) {
  if (!asset || !asset.url) throw new Error('There is nothing to download.');

  const target = path.join(os.tmpdir(), asset.name);
  await download(asset.url, target, onProgress);

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

module.exports = { check, install, architecture, canInstallInPlace, RELEASES_PAGE };
