'use strict';

// The one keyboard route into a recording that is already running.
//
// It is deliberately awkward. This app is pointed at somebody else's software
// while it records, so any combination it takes is a combination taken away
// from whatever is under review — a walkthrough of an editor that uses
// Ctrl+Shift+S would lose its own save shortcut for the length of the
// recording. Three modifiers is the price of not doing that.
//
// Only stopping gets one. Discarding is destructive and asks before it acts, so
// it wants the bar in front of you anyway, and a second global accelerator
// would double the surface for exactly the clash this is shaped to avoid.
const STOP_RECORDING = 'CommandOrControl+Alt+Shift+S';

// How to write it down for a human. macOS spells modifiers with symbols and no
// separators; everywhere else spells them out.
function describe(accelerator, platform) {
  const parts = String(accelerator || '').split('+');
  if (platform === 'darwin') {
    return parts
      .map((part) => {
        if (part === 'CommandOrControl' || part === 'Command') return '\u2318';
        if (part === 'Alt' || part === 'Option') return '\u2325';
        if (part === 'Shift') return '\u21e7';
        if (part === 'Control') return '\u2303';
        return part;
      })
      .join('');
  }
  return parts.map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part)).join('+');
}

// Whether the combination is held right now, and whether it could be had at
// all. `available` is answered by taking it for an instant and giving it
// straight back, because another application may hold it permanently — and a
// shortcut somebody has been told about but which does nothing is worse than
// no shortcut at all.
//
// electron's globalShortcut is passed in rather than required: this module is
// shared, and shared code has to load outside the main process too.
function stopState(globalShortcut, platform) {
  const active = globalShortcut.isRegistered(STOP_RECORDING);
  let available = active;
  if (!active) {
    available = globalShortcut.register(STOP_RECORDING, () => {});
    if (available) globalShortcut.unregister(STOP_RECORDING);
  }

  return {
    accelerator: STOP_RECORDING,
    label: describe(STOP_RECORDING, platform),
    active,
    available
  };
}

module.exports = { STOP_RECORDING, describe, stopState };