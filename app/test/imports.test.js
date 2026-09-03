'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const imports = require('../src/shared/imports');
const pkg = require('../src/main/package-writer');
const { buildBrief, buildPrompt } = require('../src/shared/brief');

test('the files people actually have are recognised as videos', () => {
  ['demo.mp4', 'Screen Recording.MOV', 'capture.webm', 'clip.mkv', 'old.avi'].forEach((name) => {
    assert.ok(imports.looksLikeVideo(name), `${name} should be offered`);
  });
});

test('a file that is plainly not a video is turned away by name', () => {
  // Worth catching early: the alternative is a codec error that reads like a bug.
  ['notes.pdf', 'transcript.txt', 'screenshot.png', 'archive.zip', 'noextension'].forEach((name) => {
    assert.ok(!imports.looksLikeVideo(name), `${name} should not be offered`);
  });
});

test('the copy keeps the extension, so the file does not lie about its format', () => {
  assert.strictEqual(imports.recordingFileName('demo.mp4'), 'recording.mp4');
  assert.strictEqual(imports.recordingFileName('Screen Recording.MOV'), 'recording.mov');
  assert.strictEqual(imports.recordingFileName('capture.webm'), 'recording.webm');
});

test('an unrecognised name still produces a usable file name', () => {
  assert.strictEqual(imports.recordingFileName('mystery'), 'recording.webm');
  assert.strictEqual(imports.recordingFileName(''), 'recording.webm');
  assert.strictEqual(imports.recordingFileName(null), 'recording.webm');
});

test('only the file name travels, never the folder it came from', () => {
  // Briefs get pasted into chats, and a full path says where someone works and
  // what their user name is.
  //
  // Both separators are checked on every platform on purpose. path.basename on
  // macOS and Linux does not split on a backslash, so a Windows path would come
  // back whole — a privacy guard that only holds on the platform it was written
  // on is worse than none. CI caught exactly this.
  assert.strictEqual(imports.sourceName('C:\\Users\\someone\\Videos\\demo.mp4'), 'demo.mp4');
  assert.strictEqual(imports.sourceName('/home/someone/videos/demo.mp4'), 'demo.mp4');
  assert.strictEqual(imports.sourceName('\\\\server\\share\\demo.mp4'), 'demo.mp4');
  assert.strictEqual(imports.sourceName('demo.mp4'), 'demo.mp4');
  assert.strictEqual(imports.sourceName(''), '');
});

test('a folder with a dot in it is not mistaken for an extension', () => {
  // Same platform trap seen from the other side: on macOS and Linux,
  // path.extname over a whole Windows path would read ".folder\video".
  assert.strictEqual(imports.extensionOf('C:\\my.folder\\video.mp4'), '.mp4');
  assert.strictEqual(imports.recordingFileName('C:\\my.folder\\video.mp4'), 'recording.mp4');
  assert.ok(imports.looksLikeVideo('C:\\my.folder\\video.mp4'));
});

test('an imported video is copied into the package under the shared name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-import-'));
  const source = path.join(dir, 'original.mp4');
  fs.writeFileSync(source, Buffer.from([0, 1, 2, 3, 4]));

  const target = pkg.copyRecording(dir, source, imports.recordingFileName('original.mp4'));

  assert.strictEqual(path.basename(target), 'recording.mp4');
  assert.deepStrictEqual(fs.readFileSync(target), fs.readFileSync(source));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a recorded package is still written as recording.webm by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-record-'));
  const target = pkg.writeRecording(dir, new Uint8Array([1, 2, 3]));
  assert.strictEqual(path.basename(target), 'recording.webm');
  fs.rmSync(dir, { recursive: true, force: true });
});

function importedRun() {
  return {
    id: '2026-09-03-120000',
    packagePath: '/packages/2026-09-03-120000',
    durationSeconds: 42,
    frameSize: { width: 1920, height: 1080 },
    keyframes: [{ file: 'frames/frame-01.png', time: 0 }],
    source: { kind: 'import', name: 'demo.mp4' },
    transcript: { available: true, segments: [{ start: 1, end: 2, text: 'This button is wrong.' }] }
  };
}

test('the brief says the video was imported rather than recorded here', () => {
  // The frames may predate the code being asked about, so claiming this app
  // recorded them would misdescribe what the agent is looking at.
  const brief = buildBrief(importedRun());
  assert.match(brief, /Source: imported video `demo\.mp4`/);
  assert.match(brief, /Prepared with FeedbackRecorder from an existing video/);
  assert.doesNotMatch(brief, /unknown display/);
});

test('the copied prompt does not claim the user recorded it', () => {
  const prompt = buildPrompt(importedRun());
  assert.doesNotMatch(prompt, /I recorded/);
  assert.match(prompt, /from a screen recording/);
});

test('a recorded run still describes its display', () => {
  const brief = buildBrief(
    Object.assign(importedRun(), {
      source: undefined,
      display: { name: 'Display 1', actualWidth: 2560, actualHeight: 1440 }
    })
  );
  assert.match(brief, /Source: Display 1, captured at 2560x1440/);
  assert.match(brief, /Recorded with FeedbackRecorder/);
});
