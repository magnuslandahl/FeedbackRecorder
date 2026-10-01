'use strict';

const DEFAULT = { width: 540, height: 700 };
const MIN_WIDTH = 460;
const MIN_HEIGHT = 560;

function restore(saved, workArea) {
  const valid = saved &&
    Number.isInteger(saved.width) && saved.width >= MIN_WIDTH &&
    Number.isInteger(saved.height) && saved.height >= MIN_HEIGHT;
  const size = valid ? saved : DEFAULT;
  return {
    width: Math.max(MIN_WIDTH, Math.min(size.width, workArea.width)),
    height: Math.max(MIN_HEIGHT, Math.min(size.height, workArea.height))
  };
}

function remember(window, save) {
  window.on('close', () => {
    const { width, height } = window.getNormalBounds();
    save({ windowSize: { width, height } });
  });
}

module.exports = { restore, remember, MIN_WIDTH, MIN_HEIGHT };
