'use strict';

// Fetches everything the app needs to work without anything being installed:
// a whisper.cpp build and the models it runs. Both land in app/vendor/, which is
// not in git because it is hundreds of megabytes of third-party binaries.
//
//   node scripts/fetch-vendor.js            # the shipping default
//   node scripts/fetch-vendor.js --base     # the smaller, weaker model instead
//
// Downloads go to a .part file and are renamed only once complete. A half-
// downloaded model still loads far enough for whisper.cpp to fail deep inside
// itself with a message about tensor counts, which tells nobody anything.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const VENDOR = path.join(__dirname, '..', 'vendor');
const WHISPER_TAG = 'b4938';

const MODELS = {
  small: {
    file: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    minBytes: 480_000_000
  },
  base: {
    file: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    minBytes: 140_000_000
  },
  vad: {
    file: 'ggml-silero-v5.1.2.bin',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
    minBytes: 800_000
  }
};

function releaseAsset() {
  if (process.platform === 'win32') return 'whisper-bin-x64.zip';
  if (process.platform === 'linux') return 'whisper-bin-ubuntu-x64.tar.gz';
  return null;
}

async function download(url, target, minBytes) {
  if (fs.existsSync(target) && fs.statSync(target).size >= minBytes) {
    console.log(`have  ${path.basename(target)}`);
    return target;
  }

  console.log(`get   ${path.basename(target)}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);

  const partial = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()));

  const size = fs.statSync(partial).size;
  if (size < minBytes) {
    fs.unlinkSync(partial);
    throw new Error(`${path.basename(target)} came back as ${size} bytes, which is too small to be the real file.`);
  }

  fs.renameSync(partial, target);
  console.log(`ok    ${path.basename(target)} (${(size / 1e6).toFixed(0)} MB)`);
  return target;
}

async function fetchWhisper() {
  const asset = releaseAsset();
  if (!asset) {
    console.log('');
    console.log('No prebuilt whisper.cpp is published for this platform.');
    console.log('On macOS, build it and copy the binary and its libraries into:');
    console.log(`  ${path.join(VENDOR, 'whisper')}`);
    console.log('');
    console.log('  git clone https://github.com/ggml-org/whisper.cpp');
    console.log('  cmake -B build -DGGML_METAL=ON && cmake --build build -j --config Release');
    console.log('');
    return;
  }

  const target = path.join(os.tmpdir(), asset);
  await download(
    `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${asset}`,
    target,
    1_000_000
  );

  const dest = path.join(VENDOR, 'whisper');
  fs.mkdirSync(dest, { recursive: true });
  // bsdtar ships with Windows 10+, macOS and most Linux, and reads zip as well
  // as tar, so no archive dependency is needed.
  execFileSync('tar', ['-xf', target, '-C', dest], { stdio: 'inherit' });
  fs.unlinkSync(target);
  console.log(`ok    unpacked whisper.cpp into ${dest}`);
}

async function main() {
  const wantBase = process.argv.includes('--base');
  const model = wantBase ? MODELS.base : MODELS.small;

  await fetchWhisper();
  await download(model.url, path.join(VENDOR, 'models', model.file), model.minBytes);
  await download(MODELS.vad.url, path.join(VENDOR, 'models', MODELS.vad.file), MODELS.vad.minBytes);

  console.log('');
  console.log('Check it with:');
  console.log('  node test/whisper-check.js <a 16 kHz mono wav> sv');
}

main().catch((error) => {
  console.error(`failed: ${error.message}`);
  process.exit(1);
});
