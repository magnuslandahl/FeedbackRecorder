'use strict';

// Windows folder redirection quietly points Videos at OneDrive, and on a work
// machine that means every recording — hundreds of megabytes, showing whatever
// was on screen — starts uploading to corporate storage the moment it is
// written. Recordings are working files, not documents, so the default location
// stays off a sync root.

const SYNC_ROOTS = /[\\/](OneDrive|Dropbox|Google Drive|iCloud Drive|Box Sync|pCloud)([ \-\\/]|$)/i;

function isSyncedLocation(target) {
  return SYNC_ROOTS.test(String(target || ''));
}

module.exports = { isSyncedLocation };
