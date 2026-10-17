'use strict';

const themes = require('../shared/themes');

const TITLEBAR_HEIGHT = 50;

function appearance(setting, prefersLight) {
  return themes.resolve(setting, prefersLight) === 'light'
    ? { color: '#f4f6f9', symbolColor: '#1a1f28' }
    : { color: '#14161a', symbolColor: '#e6e9ef' };
}

function options(platform, setting, prefersLight) {
  const colors = appearance(setting, prefersLight);
  const base = { backgroundColor: colors.color };
  if (platform === 'win32') {
    return {
      ...base,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...colors, height: TITLEBAR_HEIGHT }
    };
  }
  if (platform === 'darwin') {
    return {
      ...base,
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: true,
      trafficLightPosition: { x: 16, y: 18 }
    };
  }
  return base;
}

function watch(window, nativeTheme, getTheme, platform = process.platform) {
  const update = () => {
    const colors = appearance(getTheme(), !nativeTheme.shouldUseDarkColors);
    window.setBackgroundColor(colors.color);
    if (platform === 'win32') {
      window.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
    }
  };
  nativeTheme.on('updated', update);
  window.once('closed', () => nativeTheme.removeListener('updated', update));
  update();
  return update;
}

module.exports = { TITLEBAR_HEIGHT, appearance, options, watch };
