'use strict';

const path = require('node:path');
const { systemPreferences, shell, desktopCapturer, app } = require('electron');

const settings = require('./settings');
const macPermissions = require('./mac-permissions');

const IS_MAC = process.platform === 'darwin';

const SETTINGS_PANES = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
};

let identity = { kind: IS_MAC ? 'unknown' : 'not-applicable', stable: !IS_MAC, requirement: '' };
let identityChangedThisLaunch = false;

function installedBundle() {
  if (!IS_MAC || !app.isPackaged) return null;
  const bundle = macPermissions.appBundleFromExecutable(app.getPath('exe'));
  if (!bundle) return null;

  const roots = ['/Applications', path.join(app.getPath('home'), 'Applications')];
  return roots.some((root) => bundle === root || bundle.startsWith(`${root}${path.sep}`))
    ? bundle
    : null;
}

// TCC remembers the designated requirement, not just the visible app name. On
// the first build carrying this migration there is no stored requirement yet;
// an existing settings file distinguishes an update from a new installation.
// Old entries are removed before this process asks for anything, so System
// Settings shows one usable FeedbackRecorder rather than an enabled stale copy.
function reconcileIdentity() {
  const bundle = installedBundle();
  if (!bundle) return identity;

  identity = macPermissions.describeIdentity(bundle);
  if (!identity.requirement) return identity;

  const hadSettings = settings.exists();
  const snapshot = settings.load();
  const previous = snapshot.macPermissionIdentity || '';
  if (previous === identity.requirement) return identity;

  let migration = null;
  if (previous || hadSettings) {
    const result = macPermissions.reset();
    identityChangedThisLaunch = true;
    migration = {
      changed: true,
      stable: identity.stable,
      cleared: result.cleared,
      failures: result.failures.map((failure) => failure.service)
    };
  }

  settings.save({
    macPermissionIdentity: identity.requirement,
    macPermissionMigration: migration
  });
  return identity;
}

function statusFor(kind) {
  try {
    return systemPreferences.getMediaAccessStatus(kind);
  } catch (error) {
    return 'unknown';
  }
}

// macOS does not list an app under Privacy & Security until the app has actually
// asked for the thing. Until then the user is sent to a settings pane where
// FeedbackRecorder simply is not there, which reads as the app being broken.
//
// So both permissions are touched once, deliberately, before the UI says
// anything about them: asking for the microphone raises the normal system
// prompt, and one desktopCapturer call is enough to register for Screen
// Recording. Neither blocks, and neither is fatal.
async function prime() {
  if (!IS_MAC) return describe();

  if (statusFor('microphone') === 'not-determined') {
    try {
      await systemPreferences.askForMediaAccess('microphone');
    } catch (error) {
      // Denial is an answer, not a failure.
    }
  }

  try {
    // The thumbnail is thrown away; what matters is that the request happened,
    // because that is what puts the app in the list.
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch (error) {
    // Refusal is the state this is trying to surface, not an error.
  }

  return describe();
}

// macOS caches a process's Screen Recording answer, so an app that was running
// when permission was granted keeps being told no until it restarts. That makes
// it a state the UI has to offer a way out of, rather than an error it can retry.
function describe() {
  if (IS_MAC && identity.kind === 'unknown') {
    const bundle = installedBundle();
    if (bundle) identity = macPermissions.describeIdentity(bundle);
  }
  const microphone = statusFor('microphone');
  const screenCapture = IS_MAC ? statusFor('screen') : 'granted';
  const snapshot = settings.load();
  const storedMigration = snapshot.macPermissionMigration;
  const migration =
    IS_MAC && storedMigration && typeof storedMigration === 'object'
      ? Object.assign({}, storedMigration, {
          // tccutil changed the database after this process started. macOS may
          // still report its cached old answer until a restart, so the renderer
          // must not dismiss the migration merely because every grant appears
          // available in this same process.
          createdThisLaunch: identityChangedThisLaunch
        })
      : null;

  return {
    platform: process.platform,
    identity: {
      kind: identity.kind,
      stable: identity.stable
    },
    migration,
    microphone: {
      status: microphone,
      granted: microphone === 'granted' || microphone === 'unknown',
      canAsk: IS_MAC && microphone === 'not-determined',
      hint:
        microphone === 'denied'
          ? 'The microphone is blocked for this app in system settings. Nothing spoken will be recorded until it is allowed.'
          : ''
    },
    screen: {
      status: screenCapture,
      granted: screenCapture === 'granted',
      needsRestart: IS_MAC && screenCapture !== 'granted',
      hint: IS_MAC
        ? 'Switch FeedbackRecorder on in the list, then restart it with the button below. macOS only applies Screen Recording to an app that started after it was allowed.'
        : ''
    }
  };
}

function acknowledgeMigration() {
  if (!IS_MAC) return false;
  settings.save({ macPermissionMigration: null });
  identityChangedThisLaunch = false;
  return true;
}

function resetAndRestart() {
  if (!IS_MAC) return false;
  const result = macPermissions.reset();
  if (result.failures.length) {
    throw new Error(
      `macOS could not remove ${result.failures.map((failure) => failure.service).join(', ')}.`
    );
  }

  settings.save({
    macPermissionIdentity: identity.requirement || settings.load().macPermissionIdentity,
    macPermissionMigration: {
      changed: true,
      stable: identity.stable,
      cleared: result.cleared,
      failures: []
    }
  });
  return restart();
}

async function requestMicrophone() {
  if (!IS_MAC) return describe();
  try {
    await systemPreferences.askForMediaAccess('microphone');
  } catch (error) {
    // Denial is an answer, not a failure.
  }
  return describe();
}

async function openSettings(kind) {
  const target = SETTINGS_PANES[kind];
  if (!IS_MAC || !target) return false;
  await shell.openExternal(target);
  return true;
}

// Telling somebody to quit and reopen an app is asking them to do the computer's
// job. This is that restart, done for them.
function restart() {
  app.relaunch();
  app.exit(0);
  return true;
}

module.exports = {
  describe,
  prime,
  requestMicrophone,
  openSettings,
  restart,
  reconcileIdentity,
  acknowledgeMigration,
  resetAndRestart
};
