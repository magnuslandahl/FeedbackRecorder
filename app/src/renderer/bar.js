'use strict';

// The recording bar. It exists so the main window can get out of the way while
// still showing that recording is running and the microphone is hearing something.

const api = window.feedback;
const timeEl = document.getElementById('time');
const levelEl = document.getElementById('level');
const meterEl = document.getElementById('mic-level');
const stopEl = document.getElementById('stop');
const actionsEl = document.getElementById('actions-toggle');

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
  const percent = Math.round(api.lib.meterWidth(level) * 100);
  levelEl.style.width = `${percent}%`;
  meterEl.setAttribute('aria-valuenow', String(percent));
  levelEl.className = 'meter-fill';
  const tone = api.lib.meterTone(level);
  if (tone !== 'ok') levelEl.classList.add(tone);
});

stopEl.addEventListener('click', () => {
  if (stopping || confirming) return;
  stopping = true;
  stopEl.disabled = true;
  actionsEl.disabled = true;
  stopEl.textContent = 'Stopping';
  api.requestStop();
});

actionsEl.addEventListener('click', () => {
  if (stopping || confirming) return;
  confirming = true;
  actionsEl.disabled = true;
  stopEl.disabled = true;
  actionsEl.setAttribute('aria-expanded', 'true');
  const bounds = actionsEl.getBoundingClientRect();
  api.requestRecordingActions({ x: Math.round(bounds.left), y: Math.round(bounds.bottom) });
});

api.onRecordingActionsClosed(() => {
  actionsEl.setAttribute('aria-expanded', 'false');
});

api.onDiscardCancelled(() => {
  confirming = false;
  actionsEl.setAttribute('aria-expanded', 'false');
  if (stopping) return;
  actionsEl.disabled = false;
  stopEl.disabled = false;
});
