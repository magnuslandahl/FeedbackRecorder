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

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
};
