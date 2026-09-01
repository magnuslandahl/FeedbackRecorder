'use strict';

// The harness page uses the real preload, so it is exercising the same bridge
// the app does, plus one extra channel for reporting the result back.
require('../../src/preload/preload.js');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessBridge', {
  done: (result) => ipcRenderer.send('harness:done', result)
});
