'use strict';

const { systemPreferences, shell } = require('electron');

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

// macOS will not grant Screen Recording to a process that is already running:
// the app has to be restarted after the user approves it. That makes it a state
// the UI has to show, not an error it can retry out of.
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
        ? 'macOS only applies Screen Recording after the app restarts. Approve it, then quit and reopen FeedbackRecorder.'
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

module.exports = { describe, requestMicrophone, openSettings };
