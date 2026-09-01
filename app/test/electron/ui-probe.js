'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fr-probe-')));

const QUERY = `(() => {
  const list = document.getElementById('display-list');
  const first = list.children[0];
  const img = first && first.querySelector('img');
  const panel = list.closest('.panel');
  return {
    children: list.children.length,
    listRect: list.getBoundingClientRect().toJSON(),
    listStyles: {
      display: getComputedStyle(list).display,
      gridTemplateColumns: getComputedStyle(list).gridTemplateColumns
    },
    panelRect: panel.getBoundingClientRect().toJSON(),
    firstRect: first ? first.getBoundingClientRect().toJSON() : null,
    firstStyles: first
      ? {
          display: getComputedStyle(first).display,
          visibility: getComputedStyle(first).visibility,
          opacity: getComputedStyle(first).opacity,
          overflow: getComputedStyle(first).overflow
        }
      : null,
    imgSrcLength: img ? img.src.length : -1,
    imgComplete: img ? img.complete : null,
    imgNatural: img ? [img.naturalWidth, img.naturalHeight] : null,
    imgRect: img ? img.getBoundingClientRect().toJSON() : null,
    label: first ? first.textContent.trim() : null,
    bodyScrollHeight: document.body.scrollHeight,
    windowInnerHeight: window.innerHeight
  };
})()`;

app.whenReady().then(async () => {
  const { createRuntime } = require(path.join(ROOT, 'src', 'main', 'runtime.js'));
  const runtime = createRuntime({
    appRoot: ROOT,
    windows: {
      hideMain() {},
      showMain() {},
      openBar() {
        return {};
      },
      closeBar() {},
      sendToBar() {},
      sendToMain() {}
    }
  });
  runtime.installDisplayMediaHandler(session.defaultSession);
  runtime.registerIpc();

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 4000));

  console.log(JSON.stringify(await window.webContents.executeJavaScript(QUERY), null, 2));
  app.exit(0);
});
