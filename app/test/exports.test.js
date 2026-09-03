'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const rules = require('../src/shared/exports');
const { writeZip } = require('../src/main/zip');
const exporter = require('../src/main/exporter');

// ---------------------------------------------------------------- The rules

test('already-compressed files are stored rather than deflated again', () => {
  // Deflate buys nothing on these and costs time proportional to the size,
  // which for the video is most of the export.
  ['frame-01.png', 'recording.webm', 'clip.mp4', 'shot.JPG'].forEach((name) => {
    assert.strictEqual(rules.compressionFor(name), 'store', name);
  });
});

test('text compresses, because that is where the saving is', () => {
  ['agent-brief.md', 'transcript.txt', 'run.json', 'narration.wav'].forEach((name) => {
    assert.strictEqual(rules.compressionFor(name), 'deflate', name);
  });
});

test('the video is recognised whatever container it arrived in', () => {
  // An imported file keeps its own extension, so this cannot be a fixed name.
  ['recording.webm', 'recording.mp4', 'recording.MOV'].forEach((name) => {
    assert.ok(rules.isRecording(name), name);
  });
});

test('the narration audio is recognised, so it can be left out', () => {
  assert.ok(rules.isNarrationAudio('narration.wav'));
  assert.ok(!rules.isNarrationAudio('recording.webm'));
  assert.ok(!rules.isNarrationAudio('transcript.txt'));
});

test('what a reader needs is always in, and only the two heavy files are optional', () => {
  // The brief, the transcript and the pictures are the point of the export.
  ['agent-brief.md', 'transcript.txt', 'transcript.json', 'run.json', 'frames/frame-01.png'].forEach(
    (name) => assert.ok(rules.isAlwaysIncluded(name), name)
  );
  assert.ok(!rules.isAlwaysIncluded('recording.webm'));
  assert.ok(!rules.isAlwaysIncluded('narration.wav'));
});

test('nothing else in the package is mistaken for the video', () => {
  ['agent-brief.md', 'run.json', 'frames/frame-01.png', 'narration.wav', 'recordings.txt'].forEach(
    (name) => assert.ok(!rules.isRecording(name), name)
  );
});

test('the plain name is the lean export, because that is the normal one', () => {
  // Two exports of the same review must not overwrite each other, and the
  // recipient should know what they were sent before opening it.
  const id = '2026-09-03-172900';
  assert.strictEqual(rules.zipFileName(id, {}), 'FeedbackRecorder-2026-09-03-172900.zip');
  assert.strictEqual(
    rules.zipFileName(id, { includeVideo: true }),
    'FeedbackRecorder-2026-09-03-172900-with-video.zip'
  );
  assert.strictEqual(
    rules.zipFileName(id, { includeAudio: true }),
    'FeedbackRecorder-2026-09-03-172900-with-audio.zip'
  );
  assert.strictEqual(
    rules.zipFileName(id, { includeVideo: true, includeAudio: true }),
    'FeedbackRecorder-2026-09-03-172900-with-video-and-audio.zip'
  );
});

test('sizes are rounded to something a person can read', () => {
  assert.strictEqual(rules.formatBytes(0), '0 B');
  assert.strictEqual(rules.formatBytes(900), '900 B');
  assert.strictEqual(rules.formatBytes(2048), '2 KB');
  assert.strictEqual(rules.formatBytes(5 * 1024 * 1024), '5 MB');
  assert.strictEqual(rules.formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});

// ------------------------------------------------------------- The archive

// A zip only this project can read would prove nothing, so the archives are
// checked with whatever independent extractor the machine has. Python is on
// every GitHub runner, and bsdtar ships with Windows and macOS.
function findExtractor() {
  const candidates = [
    {
      name: 'python',
      probe: ['python', ['-c', 'import zipfile']],
      extract: (zip, into) => [
        'python',
        ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, into]
      ]
    },
    {
      name: 'python3',
      probe: ['python3', ['-c', 'import zipfile']],
      extract: (zip, into) => [
        'python3',
        ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, into]
      ]
    },
    {
      name: 'unzip',
      probe: ['unzip', ['-v']],
      extract: (zip, into) => ['unzip', ['-qq', '-o', zip, '-d', into]]
    },
    {
      // GNU tar cannot read a zip, so only the system bsdtar is asked.
      name: 'bsdtar',
      probe: [process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'bsdtar', ['--version']],
      extract: (zip, into) => [
        process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\tar.exe` : 'bsdtar',
        ['-xf', zip, '-C', into]
      ]
    }
  ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate.probe[0], candidate.probe[1], { stdio: 'ignore' });
      return candidate;
    } catch (error) {
      // Not this one.
    }
  }
  return null;
}

function makePackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-zip-'));
  const dir = path.join(root, '2026-09-03-172900');
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'agent-brief.md'), '# Review brief\n'.repeat(400));
  // Empty on purpose: a silent recording produces one, and a zero-length entry
  // is a real edge in the format.
  fs.writeFileSync(path.join(dir, 'transcript.txt'), '');
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id: '2026-09-03-172900', text: 'åäö' }));
  fs.writeFileSync(path.join(dir, 'narration.wav'), Buffer.alloc(9000, 7));
  fs.writeFileSync(
    path.join(dir, 'recording.webm'),
    Buffer.from(Array.from({ length: 120000 }, (_, i) => (i * 7 + 13) % 251))
  );
  fs.writeFileSync(path.join(dir, 'frames', 'frame-01.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]));
  fs.writeFileSync(path.join(dir, 'frames', 'frame-02.png'), Buffer.alloc(3000, 9));

  return { root, dir };
}

function relativeFiles(dir) {
  const found = [];
  const walk = (at, prefix) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(path.join(at, item.name), name);
      else found.push(name);
    }
  };
  walk(dir, '');
  return found.sort();
}

test('the plan separates the two optional files from everything else', () => {
  const { root, dir } = makePackage();
  const plan = exporter.plan(dir);

  assert.strictEqual(plan.files, 7);
  assert.strictEqual(plan.videoFiles, 1);
  assert.strictEqual(plan.videoBytes, 120000);
  assert.strictEqual(plan.audioFiles, 1);
  assert.strictEqual(plan.audioBytes, 9000);
  assert.strictEqual(plan.totalBytes, plan.videoBytes + plan.audioBytes + plan.otherBytes);
  // The point of offering the choice at all: those two dominate the size.
  assert.ok(plan.videoBytes + plan.audioBytes > plan.otherBytes);

  fs.rmSync(root, { recursive: true, force: true });
});

test('by default the zip holds neither the video nor the recorded voice', async () => {
  // The transcript already carries what was said, and the audio is somebody's
  // actual voice, so a zip meant for sending should not include it unasked.
  const { root, dir } = makePackage();
  const target = path.join(root, 'lean.zip');

  const result = await exporter.save({ dir, target });

  assert.strictEqual(result.entries, 5);
  assert.strictEqual(result.includedVideo, false);
  assert.strictEqual(result.includedAudio, false);

  const names = exporter.chooseFiles(exporter.walk(dir, '', []), false, false).map((item) => item.name);
  assert.deepStrictEqual(names.sort(), [
    'agent-brief.md',
    'frames/frame-01.png',
    'frames/frame-02.png',
    'run.json',
    'transcript.txt'
  ]);

  fs.rmSync(root, { recursive: true, force: true });
});

test('each file can be asked for on its own', () => {
  const { root, dir } = makePackage();
  const all = exporter.walk(dir, '', []);
  const names = (video, audio) => exporter.chooseFiles(all, video, audio).map((item) => item.name).sort();

  assert.ok(names(true, false).includes('recording.webm'));
  assert.ok(!names(true, false).includes('narration.wav'));

  assert.ok(names(false, true).includes('narration.wav'));
  assert.ok(!names(false, true).includes('recording.webm'));

  assert.strictEqual(names(true, true).length, 7);

  fs.rmSync(root, { recursive: true, force: true });
});

test('asking for the video does not drag the audio in with it', async () => {
  const { root, dir } = makePackage();
  const target = path.join(root, 'with-video.zip');

  const result = await exporter.save({ dir, target, includeVideo: true });

  assert.strictEqual(result.entries, 6);
  assert.strictEqual(result.includedVideo, true);
  assert.strictEqual(result.includedAudio, false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('an empty package is refused rather than written as an empty zip', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-zip-empty-'));
  const dir = path.join(root, 'empty');
  fs.mkdirSync(dir, { recursive: true });

  await assert.rejects(
    () => exporter.save({ dir, target: path.join(root, 'out.zip'), includeVideo: true }),
    /no files in it/
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('an entry that outgrows its 32-bit header is refused, not written broken', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-zip-guard-'));
  const source = path.join(root, 'incompressible.bin');

  // Random data is the case where deflate makes a file slightly bigger. That is
  // the only way an entry written as 32-bit can end up too large for the header
  // it already has, and writing it anyway would produce an archive that looks
  // fine until somebody opens it.
  const raw = crypto.randomBytes(4096);
  fs.writeFileSync(source, raw);

  const deflated = zlib.deflateRawSync(raw, { level: 6 }).length;
  assert.ok(deflated > raw.length, 'random data is expected to expand under deflate');

  // Above the file, at or below what it deflates to: the entry is written as
  // 32-bit and only then found to be too large.
  const threshold = raw.length + 1;
  assert.ok(threshold <= deflated);

  await assert.rejects(
    writeZip({
      target: path.join(root, 'out.zip'),
      zip64Threshold: threshold,
      entries: [{ name: 'incompressible.bin', sourcePath: source, method: 'deflate' }]
    }),
    /past what a 32-bit zip entry can describe/
  );

  fs.rmSync(root, { recursive: true, force: true });
});

const extractor = findExtractor();

test('an exported zip opens in another program, with the files intact', { skip: extractor ? false : 'no independent zip extractor found' }, async () => {
  const { root, dir } = makePackage();
  const target = path.join(root, 'with-video.zip');
  await exporter.save({ dir, target, includeVideo: true, includeAudio: true });

  const into = path.join(root, 'extracted');
  fs.mkdirSync(into, { recursive: true });
  const [command, args] = extractor.extract(target, into);
  execFileSync(command, args, { stdio: 'ignore' });

  assert.deepStrictEqual(relativeFiles(into), relativeFiles(dir));

  for (const name of relativeFiles(dir)) {
    const original = fs.readFileSync(path.join(dir, name.replace(/\//g, path.sep)));
    const roundTripped = fs.readFileSync(path.join(into, name.replace(/\//g, path.sep)));
    assert.deepStrictEqual(roundTripped, original, `${name} did not survive the round trip`);
  }

  fs.rmSync(root, { recursive: true, force: true });
});

test('the ZIP64 layout is readable too', { skip: extractor ? false : 'no independent zip extractor found' }, async () => {
  // Forced with a small threshold, because the real one needs a 4 GB file and
  // an untested ZIP64 path is one that fails the first time somebody imports a
  // long recording.
  const { root, dir } = makePackage();
  const target = path.join(root, 'zip64.zip');

  const files = exporter.walk(dir, '', []);
  await writeZip({
    target,
    zip64Threshold: 64,
    entries: files.map((item) => ({
      name: item.name,
      sourcePath: item.sourcePath,
      method: rules.compressionFor(item.name)
    }))
  });

  const into = path.join(root, 'extracted64');
  fs.mkdirSync(into, { recursive: true });
  const [command, args] = extractor.extract(target, into);
  execFileSync(command, args, { stdio: 'ignore' });

  assert.deepStrictEqual(relativeFiles(into), relativeFiles(dir));
  for (const name of relativeFiles(dir)) {
    assert.deepStrictEqual(
      fs.readFileSync(path.join(into, name.replace(/\//g, path.sep))),
      fs.readFileSync(path.join(dir, name.replace(/\//g, path.sep))),
      `${name} did not survive the ZIP64 round trip`
    );
  }

  fs.rmSync(root, { recursive: true, force: true });
});
