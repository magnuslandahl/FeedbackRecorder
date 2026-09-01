'use strict';

// Fetches everything the app needs to work without anything being installed:
// a whisper.cpp build and the models it runs. Both land in app/vendor/, which is
// not in git because it is hundreds of megabytes of third-party binaries.
//
//   node scripts/fetch-vendor.js            # the shipping default
//   node scripts/fetch-vendor.js --base     # the smaller, weaker model instead
//
// Windows and Linux take a prebuilt whisper.cpp from its releases. macOS has no
// prebuilt command-line build published, so it is compiled from the same pinned
// tag instead of leaving macOS users with an app that cannot transcribe.
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

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Windows ships bsdtar in System32, which understands drive letters. Whatever
// is first on the PATH may not be it, so ask for the one that does by name.
function tarCommand() {
  if (process.platform !== 'win32') return 'tar';
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(system32) ? system32 : 'tar';
}

function requireTool(command, hint) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(`${command} is needed to build whisper.cpp for macOS. ${hint}`);
  }
}

// macOS gets a compiled binary rather than a downloaded one, because the
// whisper.cpp releases publish an xcframework for app embedding but no
// command-line build. Built for both architectures at once by default, so one
// app bundle runs on Apple Silicon and Intel alike.
function buildWhisperForMac() {
  const dest = path.join(VENDOR, 'whisper');
  const binary = path.join(dest, 'whisper-cli');

  if (fs.existsSync(binary)) {
    console.log('have  whisper-cli');
    return;
  }

  requireTool('git', 'Install the Xcode command line tools with: xcode-select --install');
  requireTool('cmake', 'Install it with: brew install cmake');

  const archs = process.env.WHISPER_MAC_ARCHS || 'arm64;x86_64';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-src-'));
  const build = path.join(work, 'build');

  console.log(`build whisper.cpp ${WHISPER_TAG} for ${archs}`);
  try {
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', WHISPER_TAG, 'https://github.com/ggml-org/whisper.cpp', work],
      { stdio: 'inherit' }
    );

    execFileSync(
      'cmake',
      [
        '-S', work,
        '-B', build,
        '-DCMAKE_BUILD_TYPE=Release',
        // One self-contained executable: nothing to ship beside it, and nothing
        // for the app to fail to find at runtime.
        '-DBUILD_SHARED_LIBS=OFF',
        // -march=native cannot produce a binary for two architectures, and would
        // otherwise bake this machine's instruction set into a shipped build.
        '-DGGML_NATIVE=OFF',
        // OpenMP would link a libomp that exists only where this was built.
        '-DGGML_OPENMP=OFF',
        '-DGGML_METAL=ON',
        // Puts the Metal shaders inside the binary rather than beside it.
        '-DGGML_METAL_EMBED_LIBRARY=ON',
        '-DWHISPER_BUILD_TESTS=OFF',
        `-DCMAKE_OSX_ARCHITECTURES=${archs}`,
        '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0'
      ],
      { stdio: 'inherit' }
    );

    execFileSync(
      'cmake',
      ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '-j', String(os.cpus().length)],
      { stdio: 'inherit' }
    );

    const built = firstExisting([
      path.join(build, 'bin', 'whisper-cli'),
      path.join(build, 'bin', 'Release', 'whisper-cli')
    ]);
    if (!built) {
      throw new Error('the build finished but whisper-cli was not where it was expected');
    }

    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(built, binary);
    fs.chmodSync(binary, 0o755);
    console.log(`ok    built whisper-cli into ${dest}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
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
  if (process.platform === 'darwin') {
    buildWhisperForMac();
    return;
  }

  const asset = releaseAsset();
  if (!asset) {
    console.log('');
    console.log(`No prebuilt whisper.cpp is published for ${process.platform}, and this`);
    console.log('script only knows how to build it for macOS. Build it yourself and put');
    console.log(`the binary in ${path.join(VENDOR, 'whisper')}:`);
    console.log('');
    console.log('  git clone https://github.com/ggml-org/whisper.cpp');
    console.log('  cmake -B build && cmake --build build -j --config Release');
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
  //
  // Two things make this fussier on Windows than it looks. Git for Windows puts
  // GNU tar on the PATH ahead of the system one, and GNU tar reads an archive
  // named "C:\..." as a host called C, so it tries to open a network connection
  // and fails. Prefer the system bsdtar, and name the archive relative to its
  // own directory, so a drive letter never reaches tar's remote-host parsing.
  execFileSync(tarCommand(), ['-xf', path.basename(target), '-C', dest], {
    cwd: path.dirname(target),
    stdio: 'inherit'
  });
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
