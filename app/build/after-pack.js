'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// The app ships without an Apple Developer certificate. macOS refuses to launch
// a bundle whose signature does not match its contents, and electron-builder has
// just rewritten those contents, so the bundle is ad-hoc signed here. That is
// what makes an uncertified build runnable at all. It is not a substitute for
// notarization: the first launch still needs the steps the README describes.
exports.default = async function adHocSignForMac(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // When a real certificate is configured, electron-builder signs and notarizes
  // the bundle itself, straight after this hook. Ad-hoc signing first would
  // leave ad-hoc signatures on nested files that notarization then rejects.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  • skipping ad-hoc signing: a signing certificate is configured');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
};
