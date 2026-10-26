'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Copy the unmodified browser bundle from the integrity-locked npm package.
// Keeping it separate preserves its license and avoids giving the renderer
// Node access. Both development and packaged apps load this local file.
function prepareRenderer(appRoot = path.join(__dirname, '..')) {
  const source = path.join(appRoot, 'node_modules', 'mediabunny');
  const target = path.join(appRoot, 'src', 'renderer', 'vendor');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (manifest.version !== '1.62.1') throw new Error('Unexpected Mediabunny version');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(source, 'dist', 'bundles', 'mediabunny.min.cjs'), path.join(target, 'mediabunny.js'));
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'Mediabunny-LICENSE.txt'));
  fs.writeFileSync(path.join(target, 'Mediabunny-NOTICE.txt'),
    'Mediabunny 1.62.1 by Vanilagy\n' +
    'Unmodified browser bundle, licensed under the Mozilla Public License 2.0.\n' +
    'License: Mediabunny-LICENSE.txt\n' +
    'Corresponding source: https://github.com/Vanilagy/mediabunny/tree/v1.62.1\n');
}

if (require.main === module) prepareRenderer();
module.exports = { prepareRenderer };
