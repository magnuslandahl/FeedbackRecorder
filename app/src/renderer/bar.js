'use strict';

// The recording bar. It exists so the main window can get out of the way while
// still showing the two things that matter during a review: that recording is
// running, and that the microphone is still hearing something.

const api = window.feedback;
const timeEl = document.getElementById('time');
const levelEl = document.getElementById('level');
const stopEl = document.getElementById('stop');

let stopping = false;

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

api.onBarState((state) => {
  timeEl.textContent = api.lib.formatTimecode(state.elapsed || 0);

  const level = Math.max(0, Math.min(1, state.level || 0));
  levelEl.style.width = `${Math.round(level * 100)}%`;
  levelEl.className = 'meter-fill';
  if (level <= 0.005) levelEl.classList.add('none');
  else if (level < 0.04) levelEl.classList.add('low');
});

stopEl.addEventListener('click', () => {
  if (stopping) return;
  stopping = true;
  stopEl.disabled = true;
  stopEl.textContent = 'Stopping';
  api.requestStop();
});
