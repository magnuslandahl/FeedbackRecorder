'use strict';

const { systemPreferences, shell, desktopCapturer, app } = require('electron');

const IS_MAC = process.platform === 'darwin';

const SETTINGS_PANES = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
};

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
  const microphone = statusFor('microphone');
  const screenCapture = IS_MAC ? statusFor('screen') : 'granted';

  return {
    platform: process.platform,
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

module.exports = { describe, prime, requestMicrophone, openSettings, restart };
