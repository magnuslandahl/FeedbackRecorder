'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { deviceLabel } = require('../src/shared/naming');

test('device labels lose the USB vendor and product IDs Chromium appends', () => {
  assert.strictEqual(
    deviceLabel('Default - Microphone (Jabra Engage 75) (0b0e:24a1)'),
    'Default - Microphone (Jabra Engage 75)'
  );
  assert.strictEqual(deviceLabel('MacBook Pro Microphone (Built-in)'), 'MacBook Pro Microphone (Built-in)');
  assert.strictEqual(deviceLabel('Headset (USB AUDIO  ) (1B3F:2008) '), 'Headset (USB AUDIO )');
});

test('device labels keep a bracketed name that only looks like an ID', () => {
  assert.strictEqual(deviceLabel('Studio (12:30)'), 'Studio (12:30)');
  assert.strictEqual(deviceLabel('Mic (0b0e:24a1) left'), 'Mic (0b0e:24a1) left');
});

test('an empty device label falls back to the name it is given', () => {
  assert.strictEqual(deviceLabel('', 'Microphone 1'), 'Microphone 1');
  assert.strictEqual(deviceLabel(undefined, 'Microphone 2'), 'Microphone 2');
  assert.strictEqual(deviceLabel('(0b0e:24a1)', 'Microphone 3'), 'Microphone 3');
  assert.strictEqual(deviceLabel(null), '');
});
