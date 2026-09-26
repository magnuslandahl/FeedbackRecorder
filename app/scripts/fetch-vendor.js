'use strict';

// Fetches/builds everything the app needs to work without anything being
// installed: whisper.cpp, its models, and on macOS the tiny input-event helper.
// They land in app/vendor/, which is not in git because the speech model is
// hundreds of megabytes.
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
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');

const VENDOR = path.join(__dirname, '..', 'vendor');
const WHISPER_TAG = 'b4938';
const WHISPER_COMMIT = '371b5a7561823ab2bb32142d2751e35e7534727b';
const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const VAD_REVISION = '9ffd54a1e1ee413ddf265af9913beaf518d1639b';

const MODELS = {
  small: {
    file: 'ggml-small.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-small.bin`,
    size: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  },
  base: {
    file: 'ggml-base.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-base.bin`,
    size: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
  },
  vad: {
    file: 'ggml-silero-v5.1.2.bin',
    url: `https://huggingface.co/ggml-org/whisper-vad/resolve/${VAD_REVISION}/ggml-silero-v5.1.2.bin`,
    size: 885098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf'
  }
};

const RELEASE_ARCHIVES = {
  win32: {
    file: 'whisper-bin-x64.zip',
    size: 8361840,
    sha256: 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d'
  },
  linux: {
    file: 'whisper-bin-ubuntu-x64.tar.gz',
    size: 9503425,
    sha256: 'f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061'
  }
};

function releaseAsset() {
  return RELEASE_ARCHIVES[process.platform] || null;
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

function requireTool(command, hint, exec = execFileSync) {
  try {
    exec(command, ['--version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(`${command} is needed to build whisper.cpp for macOS. ${hint}`);
  }
}

function replaceWhisperDirectory(built, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const binary = path.join(dest, 'whisper-cli');
  fs.copyFileSync(built, binary);
  fs.chmodSync(binary, 0o755);
  return binary;
}

// macOS gets a compiled binary rather than a downloaded one, because the
// whisper.cpp releases publish an xcframework for app embedding but no
// command-line build. Built for both architectures at once by default, so one
// app bundle runs on Apple Silicon and Intel alike.
function buildWhisperForMac(options = {}) {
  const exec = options.execFileSync || execFileSync;
  const vendor = options.vendor || VENDOR;
  const temp = options.temp || os.tmpdir();
  const cpuCount = options.cpuCount || os.cpus().length;
  const dest = path.join(vendor, 'whisper');

  requireTool('git', 'Install the Xcode command line tools with: xcode-select --install', exec);
  requireTool('cmake', 'Install it with: brew install cmake', exec);

  const archs = process.env.WHISPER_MAC_ARCHS || 'arm64;x86_64';
  const work = fs.mkdtempSync(path.join(temp, 'whisper-src-'));
  const build = path.join(work, 'build');

  console.log(`build whisper.cpp ${WHISPER_TAG} for ${archs}`);
  try {
    exec(
      'git',
      ['clone', '--depth', '1', '--branch', WHISPER_TAG, 'https://github.com/ggml-org/whisper.cpp', work],
      { stdio: 'inherit' }
    );
    const revision = exec('git', ['-C', work, 'rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim();
    if (revision !== WHISPER_COMMIT) {
      throw new Error(
        `whisper.cpp tag ${WHISPER_TAG} resolved to ${revision}, expected ${WHISPER_COMMIT}`
      );
    }

    exec(
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

    exec(
      'cmake',
      ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '-j', String(cpuCount)],
      { stdio: 'inherit' }
    );

    const built = firstExisting([
      path.join(build, 'bin', 'whisper-cli'),
      path.join(build, 'bin', 'Release', 'whisper-cli')
    ]);
    if (!built) {
      throw new Error('the build finished but whisper-cli was not where it was expected');
    }

    replaceWhisperDirectory(built, dest);
    console.log(`ok    built whisper-cli into ${dest}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Electron has no API for input sent to other applications, which is where a
// walkthrough happens. This tiny listen-only helper is built from source next
// to whisper.cpp rather than checked in as an opaque binary.
//
// One universal executable is used in both mac packages, matching the whisper
// layout. The helper has no libraries to ship beside it: Cocoa and IOKit are
// system frameworks.
function buildInputTapForMac() {
  if (process.platform !== 'darwin') return;

  const source = path.join(__dirname, '..', 'tools', 'input-tap.swift');
  const dest = path.join(VENDOR, 'input');
  const binary = path.join(dest, 'input-tap');
  const current =
    fs.existsSync(binary) &&
    fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs;

  if (current) {
    console.log('have  input-tap');
    return;
  }

  requireTool('swiftc', 'Install the Xcode command line tools with: xcode-select --install');
  try {
    // lipo has no --version mode; it exits non-zero even for -help.
    execFileSync('which', ['lipo'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      'lipo is needed to build the input monitor for macOS. ' +
      'Install the Xcode command line tools with: xcode-select --install'
    );
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'input-tap-'));
  const arm = path.join(work, 'input-tap-arm64');
  const intel = path.join(work, 'input-tap-x64');

  console.log('build input-tap for arm64;x86_64');
  try {
    execFileSync(
      'swiftc',
      ['-O', '-target', 'arm64-apple-macos11', source, '-o', arm],
      { stdio: 'inherit' }
    );
    execFileSync(
      'swiftc',
      ['-O', '-target', 'x86_64-apple-macos11', source, '-o', intel],
      { stdio: 'inherit' }
    );
    fs.mkdirSync(dest, { recursive: true });
    execFileSync('lipo', ['-create', arm, intel, '-output', binary], { stdio: 'inherit' });
    fs.chmodSync(binary, 0o755);
    console.log(`ok    built input-tap into ${dest}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function inspectFile(file) {
  if (!fs.existsSync(file)) return null;
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return {
    size: fs.statSync(file).size,
    sha256: hash.digest('hex')
  };
}

async function matchesIntegrity(file, expected) {
  const actual = await inspectFile(file);
  return Boolean(
    actual &&
    actual.size === expected.size &&
    actual.sha256 === expected.sha256
  );
}

async function download(url, target, expected, fetchImpl) {
  if (await matchesIntegrity(target, expected)) {
    console.log(`have  ${path.basename(target)}`);
    return target;
  }

  if (fs.existsSync(target)) {
    console.log(`bad   ${path.basename(target)} (replacing failed integrity check)`);
    fs.rmSync(target, { force: true });
  }

  console.log(`get   ${path.basename(target)}`);
  const partial = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(partial, { force: true });

  try {
    const response = await (fetchImpl || fetch)(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    if (!response.body) throw new Error(`${url} returned no body`);

    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(partial, { flags: 'wx' })
    );

    const actual = await inspectFile(partial);
    if (
      !actual ||
      actual.size !== expected.size ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error(
        `${path.basename(target)} failed integrity verification: ` +
        `got ${actual ? `${actual.size} bytes and SHA-256 ${actual.sha256}` : 'no file'}, ` +
        `expected ${expected.size} bytes and SHA-256 ${expected.sha256}`
      );
    }

    fs.renameSync(partial, target);
    console.log(`ok    ${path.basename(target)} (${(actual.size / 1e6).toFixed(0)} MB)`);
    return target;
  } catch (error) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(target, { force: true });
    throw error;
  }
}

function replaceArchiveDirectory(archive, dest, extract = (source, target) => {
  execFileSync(tarCommand(), ['-xf', path.basename(source), '-C', target], {
    cwd: path.dirname(source),
    stdio: 'inherit'
  });
}) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  try {
    extract(archive, dest);
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

async function fetchWhisper() {
  if (process.platform === 'darwin') {
    buildWhisperForMac();
    return;
  }

  const archive = releaseAsset();
  if (!archive) {
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

  const target = path.join(os.tmpdir(), archive.file);
  await download(
    `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${archive.file}`,
    target,
    archive
  );
  const dest = path.join(VENDOR, 'whisper');
  // bsdtar ships with Windows 10+, macOS and most Linux, and reads zip as well
  // as tar, so no archive dependency is needed.
  //
  // Two things make this fussier on Windows than it looks. Git for Windows puts
  // GNU tar on the PATH ahead of the system one, and GNU tar reads an archive
  // named "C:\..." as a host called C, so it tries to open a network connection
  // and fails. Prefer the system bsdtar, and name the archive relative to its
  // own directory, so a drive letter never reaches tar's remote-host parsing.
  replaceArchiveDirectory(target, dest);
  fs.unlinkSync(target);
  console.log(`ok    unpacked whisper.cpp into ${dest}`);
}

async function main() {
  const wantBase = process.argv.includes('--base');
  const model = wantBase ? MODELS.base : MODELS.small;

  await fetchWhisper();
  buildInputTapForMac();
  await download(model.url, path.join(VENDOR, 'models', model.file), model);
  await download(MODELS.vad.url, path.join(VENDOR, 'models', MODELS.vad.file), MODELS.vad);

  console.log('');
  console.log('Check it with:');
  console.log('  node test/whisper-check.js <a 16 kHz mono wav> sv');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  MODELS,
  RELEASE_ARCHIVES,
  WHISPER_TAG,
  WHISPER_COMMIT,
  MODEL_REVISION,
  VAD_REVISION,
  inspectFile,
  matchesIntegrity,
  download,
  buildWhisperForMac,
  replaceWhisperDirectory,
  replaceArchiveDirectory
};
