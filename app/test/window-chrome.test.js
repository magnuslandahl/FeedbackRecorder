'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const chrome = require('../src/main/window-chrome');

test('Windows integrates native caption buttons, not a completely frameless window', () => {
  const options = chrome.options('win32', 'light', false);
  assert.equal(options.titleBarStyle, 'hidden');
  assert.deepEqual(options.titleBarOverlay, {
    color: '#f4f6f9', symbolColor: '#1a1f28', height: 50
  });
  assert.equal(options.backgroundColor, options.titleBarOverlay.color);
  assert.equal(options.frame, undefined);
});

test('macOS keeps inset native traffic lights and exposes their safe area', () => {
  const options = chrome.options('darwin', 'dark', true);
  assert.equal(options.titleBarStyle, 'hiddenInset');
  assert.equal(options.titleBarOverlay, true);
  assert.deepEqual(options.trafficLightPosition, { x: 16, y: 18 });
  assert.equal(options.backgroundColor, '#14161a');
  assert.equal(options.frame, undefined);
});

test('Linux keeps its existing native title bar', () => {
  assert.deepEqual(chrome.options('linux', 'dark', false), { backgroundColor: '#14161a' });
});

test('caption colors follow the saved theme or the system, just like the renderer', () => {
  assert.deepEqual(chrome.appearance('light', false), chrome.appearance('system', true));
  assert.deepEqual(chrome.appearance('dark', true), chrome.appearance('system', false));
  assert.deepEqual(chrome.appearance('invalid', true), chrome.appearance('light', false));
});

test('Windows caption colors update on both setting changes and system changes', () => {
  const window = new EventEmitter();
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = true;
  let theme = 'system';
  let background;
  let overlay;
  window.setBackgroundColor = (value) => { background = value; };
  window.setTitleBarOverlay = (value) => { overlay = value; };
  const update = chrome.watch(window, nativeTheme, () => theme, 'win32');
  assert.equal(background, '#14161a');
  assert.equal(overlay.symbolColor, '#e6e9ef');

  nativeTheme.shouldUseDarkColors = false;
  nativeTheme.emit('updated');
  assert.equal(background, '#f4f6f9');
  assert.equal(overlay.color, background);
  assert.equal(overlay.symbolColor, '#1a1f28');

  theme = 'dark';
  update();
  assert.equal(background, '#14161a');
  nativeTheme.emit('updated');
  assert.equal(background, '#14161a', 'an explicit choice overrides the operating system');

  window.emit('closed');
  assert.equal(nativeTheme.listenerCount('updated'), 0);
});

test('macOS and Linux repaint the window without calling a Windows-only caption API', () => {
  for (const platform of ['darwin', 'linux']) {
    const window = new EventEmitter();
    const nativeTheme = new EventEmitter();
    nativeTheme.shouldUseDarkColors = false;
    let background;
    window.setBackgroundColor = (value) => { background = value; };
    chrome.watch(window, nativeTheme, () => 'system', platform);
    assert.equal(background, '#f4f6f9');
    window.emit('closed');
    assert.equal(nativeTheme.listenerCount('updated'), 0);
  }
});
