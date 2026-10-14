'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const history = require('../src/main/history');
const pkg = require('../src/main/package-writer');

// A one-pixel PNG: enough for the package to name a real file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const sandboxes = [];
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-history-'));
  sandboxes.push(dir);
  return dir;
}

test.after(() => {
  sandboxes.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function finishedPackage(root, date, extra) {
  const created = pkg.createPackage(root, date);
  const keyframes = pkg.writeFrames(created.dir, [
    { time: 0.5, score: 1, data: PNG },
    { time: 3, score: 0.6, data: PNG }
  ]);
  const events = [
    { time: 1.2, kind: 'click', detail: 'click', screen: 'recorded', x: 10, y: 20 },
    { time: 2, kind: 'shortcut', detail: 'Ctrl+S' }
  ];
  const input = pkg.writeInputEvents(created.dir, events, { pointer: true, keyboard: true });
  pkg.finalize(
    created.dir,
    Object.assign(
      {
        id: created.id,
        packagePath: created.dir,
        startedAt: date.toISOString(),
        durationSeconds: 5,
        frameSize: { width: 1, height: 1 },
        display: { name: 'Main display' },
        source: { kind: 'recording' },
        keyframes,
        revisits: [],
        input,
        inputEvents: events,
        transcript: {
          available: true,
          language: 'en',
          segments: [{ start: 0.5, end: 2, text: 'The save button does nothing' }]
        },
        notes: {
          general: 'Fix the save flow first.',
          frames: [{ file: keyframes[1].file, text: 'Spinner never stops here.' }]
        },
        degraded: []
      },
      extra || {}
    )
  );
  return created;
}

test('package ids are the folder names the writer makes, and nothing else', () => {
  assert.ok(history.isPackageId('2026-10-14-093000'));
  assert.ok(history.isPackageId('2026-10-14-093000-2'));
  ['', '..', '../2026-10-14-093000', '2026-10-14', 'notes', '2026-10-14-093000/..', null, 42].forEach(
    (id) => assert.strictEqual(history.isPackageId(id), false, String(id))
  );
});

test('a package is only resolved inside the recordings folder', () => {
  const root = sandbox();
  const created = finishedPackage(root, new Date(2026, 9, 14, 9, 30, 0));

  assert.strictEqual(history.resolvePackage(root, created.id), path.resolve(root, created.id));
  assert.throws(() => history.resolvePackage(root, '..'), /not the name of a recording/);
  assert.throws(() => history.resolvePackage(root, path.resolve(root, created.id)), /not the name/);
  assert.throws(() => history.resolvePackage(root, '2020-01-01-000000'), /no longer in the recordings folder/);
});

test('a keyframe path cannot leave its package or name anything but a PNG', () => {
  const dir = path.resolve(sandbox(), 'pkg');
  assert.strictEqual(history.resolveFrame(dir, 'frames/frame-01.png'), path.join(dir, 'frames', 'frame-01.png'));
  assert.strictEqual(history.resolveFrame(dir, '../other/frame-01.png'), null);
  assert.strictEqual(history.resolveFrame(dir, path.resolve(os.tmpdir(), 'x.png')), null);
  assert.strictEqual(history.resolveFrame(dir, 'run.json'), null);
  assert.strictEqual(history.resolveFrame(dir, null), null);
});

test('the list is newest first and keeps packages that cannot be opened', async () => {
  const root = sandbox();
  const older = finishedPackage(root, new Date(2026, 9, 13, 8, 0, 0));
  const newer = finishedPackage(root, new Date(2026, 9, 14, 9, 30, 0));
  const unfinished = pkg.createPackage(root, new Date(2026, 9, 14, 10, 0, 0));
  const broken = pkg.createPackage(root, new Date(2026, 9, 12, 7, 0, 0));
  fs.writeFileSync(path.join(broken.dir, 'run.json'), '{ not json', 'utf8');
  fs.mkdirSync(path.join(root, 'not-a-recording'));
  fs.writeFileSync(path.join(root, '2026-10-15-000000'), 'a file, not a folder');

  const items = await history.list(root);
  assert.deepStrictEqual(
    items.map((item) => [item.id, item.status]),
    [
      [unfinished.id, 'unfinished'],
      [newer.id, 'complete'],
      [older.id, 'complete'],
      [broken.id, 'unreadable']
    ]
  );
  assert.ok(items.every((item) => item.sizeBytes >= 0));
  assert.ok(items[1].sizeBytes > PNG.length * 2);
});

test('numbered packages from the same second sort after their first', async () => {
  const root = sandbox();
  const date = new Date(2026, 9, 14, 9, 30, 0);
  const ids = [];
  for (let index = 0; index < 11; index += 1) ids.push(pkg.createPackage(root, date).id);
  const listed = (await history.list(root)).map((item) => item.id);
  assert.deepStrictEqual(listed, ids.slice().reverse());
});

test('a missing recordings folder is an empty list, not an error', async () => {
  assert.deepStrictEqual(await history.list(path.join(sandbox(), 'nowhere')), []);
});

test('the summary says what a review was about and what it can be found by', async () => {
  const root = sandbox();
  const created = finishedPackage(root, new Date(2026, 9, 14, 9, 30, 0));
  const [item] = await history.list(root);

  assert.strictEqual(item.id, created.id);
  assert.strictEqual(item.durationSeconds, 5);
  assert.deepStrictEqual(item.source, { kind: 'recording', name: 'Main display' });
  assert.strictEqual(item.keyframeCount, 2);
  assert.strictEqual(item.commentCount, 2);
  assert.strictEqual(item.degraded, 0);
  assert.strictEqual(item.snippet, 'Fix the save flow first.');
  ['main display', 'fix the save flow', 'spinner never stops', 'save button does nothing'].forEach((text) =>
    assert.ok(item.searchText.includes(text), text)
  );
});

test('the snippet falls back to a comment, then to the narration, and stays short', () => {
  const base = { keyframes: [], source: { kind: 'import', name: 'demo.webm' } };
  assert.strictEqual(
    history.summarize('x', Object.assign({}, base, { notes: { frames: [{ text: 'First comment' }] } })).snippet,
    'First comment'
  );
  const spoken = history.summarize(
    'x',
    Object.assign({}, base, { transcript: { segments: [{ text: 'word '.repeat(80) }] } })
  );
  assert.ok(spoken.snippet.length <= 140);
  assert.ok(spoken.snippet.endsWith('…'));
  assert.deepStrictEqual(spoken.source, { kind: 'import', name: 'demo.webm' });
  assert.strictEqual(spoken.commentCount, 0);
});

test('loading a package brings back its input chronology and where it is now', () => {
  const root = sandbox();
  const created = finishedPackage(root, new Date(2026, 9, 14, 9, 30, 0));

  // Moved since it was written: the brief must name the new place.
  const moved = path.join(sandbox(), 'moved');
  fs.cpSync(root, moved, { recursive: true });
  const loaded = history.load(moved, created.id);

  assert.strictEqual(loaded.dir, path.resolve(moved, created.id));
  assert.strictEqual(loaded.run.packagePath, loaded.dir);
  assert.strictEqual(loaded.run.id, created.id);
  assert.strictEqual(loaded.inputEvents.length, 2);
  assert.strictEqual(loaded.inputEvents[1].detail, 'Ctrl+S');
  assert.strictEqual(loaded.run.notes.frames[0].text, 'Spinner never stops here.');
});

test('a package that never finished or cannot be read is refused with a reason', () => {
  const root = sandbox();
  const unfinished = pkg.createPackage(root, new Date(2026, 9, 14, 10, 0, 0));
  assert.throws(() => history.load(root, unfinished.id), /never finished/);

  const broken = pkg.createPackage(root, new Date(2026, 9, 14, 11, 0, 0));
  fs.writeFileSync(path.join(broken.dir, 'run.json'), '{', 'utf8');
  assert.throws(() => history.load(root, broken.id), /could not be read/);

  const empty = pkg.createPackage(root, new Date(2026, 9, 14, 12, 0, 0));
  fs.writeFileSync(path.join(empty.dir, 'run.json'), '{}', 'utf8');
  assert.throws(() => history.load(root, empty.id), /no list of keyframes/);
});

test('keyframes are read as bytes, with a gap where one is missing or out of bounds', () => {
  const root = sandbox();
  const created = finishedPackage(root, new Date(2026, 9, 14, 9, 30, 0));
  const { run } = history.load(root, created.id);
  fs.rmSync(path.join(created.dir, run.keyframes[1].file));

  const frames = history.readFrames(
    created.dir,
    run.keyframes.concat([{ file: '../../outside.png' }, { file: 'run.json' }, null])
  );
  assert.strictEqual(frames.length, 5);
  assert.ok(Buffer.isBuffer(frames[0]) && frames[0].equals(PNG));
  assert.deepStrictEqual(frames.slice(1), [null, null, null, null]);
});
