'use strict';

const test = require('node:test');
const assert = require('node:assert');
const themes = require('../src/shared/themes');

// The whole point of this module is that the stored setting and the palette
// painted are different things: three choices go in, two colours come out.

test('the three choices are offered, with matching the system first', () => {
  assert.deepStrictEqual(
    themes.THEMES.map((theme) => theme.id),
    ['system', 'light', 'dark']
  );
  assert.strictEqual(themes.DEFAULT_THEME, 'system');
  themes.THEMES.forEach((theme) => {
    assert.ok(theme.label && theme.label.length, `${theme.id} needs something to show in the picker`);
  });
});

test('an explicit choice is the one painted, whatever the system says', () => {
  assert.strictEqual(themes.resolve('light', false), 'light');
  assert.strictEqual(themes.resolve('light', true), 'light');
  assert.strictEqual(themes.resolve('dark', true), 'dark');
  assert.strictEqual(themes.resolve('dark', false), 'dark');
});

test('matching the system follows the system', () => {
  assert.strictEqual(themes.resolve('system', true), 'light');
  assert.strictEqual(themes.resolve('system', false), 'dark');
});

// Only ever a colour reaches the document, which is what lets the stylesheet
// carry one light palette instead of one per route to it.
test('what is resolved is always a palette, never the word system', () => {
  ['system', 'light', 'dark', '', null, undefined, 'neon'].forEach((setting) => {
    [true, false].forEach((prefersLight) => {
      const resolved = themes.resolve(setting, prefersLight);
      assert.ok(
        themes.PALETTES.includes(resolved),
        `resolve(${JSON.stringify(setting)}, ${prefersLight}) gave ${resolved}`
      );
    });
  });
});

test('a settings file edited by hand leaves the app painted', () => {
  assert.strictEqual(themes.normalize('nonsense'), 'system');
  assert.strictEqual(themes.normalize(''), 'system');
  assert.strictEqual(themes.normalize(null), 'system');
  assert.strictEqual(themes.normalize(undefined), 'system');
  assert.strictEqual(themes.normalize(42), 'system');
});

test('a choice is recognised whatever case it was written in', () => {
  assert.strictEqual(themes.normalize('LIGHT'), 'light');
  assert.strictEqual(themes.normalize(' Dark '), 'dark');
});

test('following the system is told apart from choosing a side', () => {
  assert.ok(themes.isSystem('system'));
  assert.ok(themes.isSystem('nonsense'), 'an unusable value falls back to following the system');
  assert.ok(!themes.isSystem('light'));
  assert.ok(!themes.isSystem('dark'));
});

test('each choice describes itself for the picker', () => {
  assert.strictEqual(themes.describe('light'), 'Light');
  assert.strictEqual(themes.describe('dark'), 'Dark');
  assert.strictEqual(themes.describe('system'), 'Match the system');
  assert.strictEqual(themes.describe('nonsense'), 'Match the system');
});
