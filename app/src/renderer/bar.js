'use strict';

// The recording bar. It exists so the main window can get out of the way while
// still showing the two things that matter during a review: that recording is
// running, and that the microphone is still hearing something.

const api = window.feedback;
const timeEl = document.getElementById('time');
const levelEl = document.getElementById('level');
const stopEl = document.getElementById('stop');
const discardEl = document.getElementById('discard');

let stopping = false;
let confirming = false;

// The bar is its own window, so it does not inherit anything the main window
// painted. It reads the same setting and resolves it the same way, or it sits
// on screen in the wrong colours for the whole recording.
(async function paint() {
  try {
    const settings = await api.loadSettings();
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.dataset.theme = api.lib.resolveTheme(settings.theme, prefersLight);
  } catch (error) {
    // The dark palette is the default in the stylesheet, so a failure here
    // leaves a usable bar rather than an unstyled one.
  }
})();

// Naming the accelerator on the button it belongs to, and only when it is
// really held: claiming a shortcut that failed to register would send somebody
// hunting for a key that does nothing.
(async function nameShortcut() {
  try {
    const stop = await api.stopShortcut();
    if (stop && stop.active && stop.label) {
      stopEl.title = `Stop recording (${stop.label})`;
      stopEl.setAttribute('aria-keyshortcuts', stop.accelerator);
    }
  } catch (error) {
    // The button says Stop either way.
  }
})();

api.onBarState((state) => {
  timeEl.textContent = api.lib.formatTimecode(state.elapsed || 0);

  // The same mapping the set-up meter uses. Drawing the raw level here meant
  // the band marked on this meter sat at a completely different loudness from
  // the identical band people were told to reach before they pressed Record.
  const level = state.level || 0;
  levelEl.style.width = `${Math.round(api.lib.meterWidth(level) * 100)}%`;
  levelEl.className = 'meter-fill';
  const tone = api.lib.meterTone(level);
  if (tone !== 'ok') levelEl.classList.add(tone);
});

stopEl.addEventListener('click', () => {
  if (stopping || confirming) return;
  stopping = true;
  stopEl.disabled = true;
  discardEl.disabled = true;
  stopEl.textContent = 'Stopping';
  api.requestStop();
});

// Throwing a recording away is the one action here that destroys something, so
// it asks first — in the main process, where a dialog can be shown over a
// hidden main window. Recording continues while the question stands, which is
// the point: answering "keep" has to cost nothing.
discardEl.addEventListener('click', () => {
  if (stopping || confirming) return;
  confirming = true;
  discardEl.disabled = true;
  stopEl.disabled = true;
  api.requestDiscard();
});

api.onDiscardCancelled(() => {
  confirming = false;
  if (stopping) return;
  discardEl.disabled = false;
  stopEl.disabled = false;
});
