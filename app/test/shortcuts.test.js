'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { STOP_RECORDING, describe } = require('../src/shared/shortcuts');

// The accelerator is deliberately awkward. This app records somebody else's
// software, so every modifier it leaves off is a combination it might steal
// from whatever is under review for the length of a walkthrough.
test('stopping takes three modifiers, so it does not collide with ordinary ones', () => {
  const parts = STOP_RECORDING.split('+');
  assert.strictEqual(parts.length, 4, STOP_RECORDING);
  assert.ok(parts.includes('CommandOrControl'));
  assert.ok(parts.includes('Alt'));
  assert.ok(parts.includes('Shift'));
});

test('it is not one of the combinations an app under review is likely to use', () => {
  const common = ['CommandOrControl+S', 'CommandOrControl+Shift+S', 'CommandOrControl+Shift+P'];
  assert.ok(!common.includes(STOP_RECORDING));
});

test('Windows and Linux are told the name of each key', () => {
  assert.strictEqual(describe(STOP_RECORDING, 'win32'), 'Ctrl+Alt+Shift+S');
  assert.strictEqual(describe(STOP_RECORDING, 'linux'), 'Ctrl+Alt+Shift+S');
});

// macOS writes modifiers as symbols run together, with no separators, and
// CommandOrControl is Command there rather than Control.
test('macOS is told the symbols it actually prints on its keys', () => {
  assert.strictEqual(describe(STOP_RECORDING, 'darwin'), '\u2318\u2325\u21e7S');
});

test('a missing accelerator degrades to an empty label rather than throwing', () => {
  assert.strictEqual(describe(undefined, 'win32'), '');
  assert.strictEqual(describe('', 'darwin'), '');
});
