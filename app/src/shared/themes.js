'use strict';

// Light or dark, and the third option that is neither.
//
// The setting is stored as one of three values, but only two of them are a
// colour: "system" is a promise to follow the operating system, which can
// change while the app is open. So the stored choice and the palette actually
// painted are different things, and this module is the one place that turns the
// first into the second. The renderer writes only the resolved value onto the
// document, which keeps the stylesheet down to one light palette instead of one
// per way of arriving at it.

const THEMES = [
  { id: 'system', label: 'Match the system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

const DEFAULT_THEME = 'system';
const PALETTES = ['light', 'dark'];

function isTheme(value) {
  return THEMES.some((theme) => theme.id === value);
}

// A hand-edited or stale settings file should not leave the app unpainted.
function normalize(value) {
  const wanted = String(value || '').trim().toLowerCase();
  return isTheme(wanted) ? wanted : DEFAULT_THEME;
}

function isSystem(value) {
  return normalize(value) === 'system';
}

function describe(value) {
  const found = THEMES.find((theme) => theme.id === normalize(value));
  return found ? found.label : 'Match the system';
}

// The palette to paint. prefersLight is what the operating system says, which
// only matters when the user has not overridden it.
function resolve(value, prefersLight) {
  const wanted = normalize(value);
  if (wanted !== 'system') return wanted;
  return prefersLight ? 'light' : 'dark';
}

module.exports = { THEMES, DEFAULT_THEME, PALETTES, isTheme, isSystem, normalize, describe, resolve };
