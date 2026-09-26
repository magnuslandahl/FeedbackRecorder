'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkg = require('../src/main/package-writer');
const exporter = require('../src/main/exporter');

test('input activity gets its own readable and streamable files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-input-package-'));
  const created = pkg.createPackage(root, new Date('2026-09-22T09:00:00Z'));
  const entries = [
    {
      time: 1.2,
      kind: 'click',
      detail: 'right-click',
      screen: 'recorded',
      x: 420,
      y: 240
    },
    { time: 2, kind: 'shortcut', detail: 'Cmd+S' },
    {
      time: 3,
      kind: 'typing',
      detail: 'typed 7 characters',
      count: 7,
      endTime: 4
    }
  ];
  const input = pkg.writeInputEvents(created.dir, entries, {
    pointer: true,
    keyboard: true
  });

  assert.strictEqual(input.available, true);
  assert.strictEqual(input.summary, '1 click, 1 shortcut, 7 typed characters');
  assert.match(
    fs.readFileSync(path.join(created.dir, 'input-events.txt'), 'utf8'),
    /\[00:01\.20\] right-click at 420,240\n\[00:02\.00\] Cmd\+S\n\[00:03\.00\] typed 7 characters/
  );

  const jsonl = fs
    .readFileSync(path.join(created.dir, 'input-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.strictEqual(jsonl.length, 3);
  assert.ok(!JSON.stringify(jsonl).includes('password'));

  const finalized = pkg.finalize(created.dir, {
    id: created.id,
    packagePath: created.dir,
    durationSeconds: 5,
    frameSize: { width: 1000, height: 600 },
    region: null,
    keyframes: [{ file: 'frames/frame-01.png', time: 0 }],
    revisits: [],
    transcript: { available: false, segments: [], reason: 'no speech' },
    narration: { summary: 'No audio was captured.' },
    degraded: [],
    input,
    inputEvents: entries
  });

  assert.match(finalized.brief, /## Input activity/);
  const run = JSON.parse(fs.readFileSync(path.join(created.dir, 'run.json'), 'utf8'));
  assert.strictEqual(run.input.summary, input.summary);
  assert.ok(!('inputEvents' in run), 'the chronology belongs in its own streaming file');

  const exported = exporter
    .chooseFiles(exporter.walk(created.dir, '', []), false, false)
    .map((item) => item.name);
  assert.ok(exported.includes('input-events.txt'));
  assert.ok(exported.includes('input-events.jsonl'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('reframing replaces old keyframes rather than leaving stale pictures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-reframe-package-'));
  const created = pkg.createPackage(root, new Date('2026-09-23T09:00:00Z'));

  pkg.writeFrames(created.dir, [
    { time: 0, score: 1, data: Buffer.from('first') },
    { time: 1, score: 1, data: Buffer.from('second') },
    { time: 2, score: 1, data: Buffer.from('third') }
  ]);
  const rewritten = pkg.writeFrames(created.dir, [
    { time: 0, score: 1, data: Buffer.from('replacement') }
  ]);

  assert.deepStrictEqual(rewritten.map((frame) => frame.file), ['frames/frame-01.png']);
  assert.deepStrictEqual(fs.readdirSync(path.join(created.dir, 'frames')), ['frame-01.png']);
  assert.strictEqual(
    fs.readFileSync(path.join(created.dir, 'frames', 'frame-01.png'), 'utf8'),
    'replacement'
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('a failed reframing pass leaves the completed keyframes intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-reframe-failure-'));
  const created = pkg.createPackage(root, new Date('2026-09-23T10:00:00Z'));

  pkg.writeFrames(created.dir, [
    { time: 0, score: 1, data: Buffer.from('first') },
    { time: 1, score: 1, data: Buffer.from('second') }
  ]);

  assert.throws(
    () =>
      pkg.writeFrames(created.dir, [
        { time: 0, score: 1, data: Buffer.from('unfinished replacement') },
        { time: 1, score: 1, data: Symbol('invalid frame bytes') }
      ]),
    /Symbol/
  );
  assert.deepStrictEqual(
    fs.readdirSync(path.join(created.dir, 'frames')),
    ['frame-01.png', 'frame-02.png']
  );
  assert.strictEqual(
    fs.readFileSync(path.join(created.dir, 'frames', 'frame-01.png'), 'utf8'),
    'first'
  );
  assert.deepStrictEqual(
    fs.readdirSync(created.dir).filter((name) => name.startsWith('.frames-')),
    []
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('written notes are bounded, normalized and included in the lean package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-notes-package-'));
  const created = pkg.createPackage(root, new Date('2026-09-23T11:00:00Z'));
  const keyframes = [
    { file: 'frames/frame-01.png', time: 0 },
    { file: 'frames/frame-02.png', time: 12.5 }
  ];
  const result = pkg.finalize(created.dir, {
    id: created.id,
    packagePath: created.dir,
    durationSeconds: 20,
    frameSize: { width: 1280, height: 720 },
    region: null,
    keyframes,
    revisits: [],
    transcript: { available: false, segments: [], reason: 'no speech' },
    narration: { summary: 'No audio was captured.' },
    degraded: [],
    notes: {
      general: ` \0Keep the shortcut.\r\n${'g'.repeat(21000)} `,
      frames: [
        { file: 'frames/missing.png', text: 'must be ignored' },
        { file: 'frames/frame-02.png', text: ` Second frame\rline\n${'f'.repeat(5000)} ` },
        { file: 'frames/frame-02.png', text: 'duplicate must be ignored' },
        { file: 'frames/frame-01.png', text: '   ' }
      ]
    }
  });

  assert.strictEqual(result.run.notes.general.length, 20000);
  assert.ok(!result.run.notes.general.includes('\0'));
  assert.ok(!result.run.notes.general.includes('\r'));
  assert.deepStrictEqual(
    result.run.notes.frames.map((note) => ({ file: note.file, time: note.time })),
    [{ file: 'frames/frame-02.png', time: 12.5 }]
  );
  assert.strictEqual(result.run.notes.frames[0].text.length, 4000);
  assert.ok(!result.run.notes.frames[0].text.includes('\r'));
  assert.ok(!result.run.notes.frames[0].text.includes('duplicate'));

  const text = fs.readFileSync(path.join(created.dir, 'notes.txt'), 'utf8');
  assert.match(text, /Additional instructions/);
  assert.match(text, /Keyframe comments/);
  assert.match(text, /\[00:12\] frames\/frame-02\.png/);
  assert.match(result.brief, /## Written context/);
  assert.match(result.prompt, /Additional instructions from the reviewer:/);

  const stored = JSON.parse(fs.readFileSync(path.join(created.dir, 'run.json'), 'utf8'));
  assert.deepStrictEqual(stored.notes, result.run.notes);
  const exported = exporter
    .chooseFiles(exporter.walk(created.dir, '', []), false, false)
    .map((item) => item.name);
  assert.ok(exported.includes('notes.txt'));

  pkg.finalize(created.dir, Object.assign({}, result.run, { notes: {} }));
  assert.ok(!fs.existsSync(path.join(created.dir, 'notes.txt')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('reframing keeps comments with the same moment rather than the old frame number', () => {
  const notes = {
    general: 'Keep the overall instruction.',
    frames: [
      { file: 'frames/frame-01.png', time: 0, text: 'Opening state' },
      { file: 'frames/frame-02.png', time: 12.5, text: 'Save state' },
      { file: 'frames/frame-03.png', time: 18, text: 'Removed state' }
    ]
  };
  const reframed = [
    { file: 'frames/frame-01.png', time: 0 },
    { file: 'frames/frame-02.png', time: 6 },
    { file: 'frames/frame-03.png', time: 12.52 }
  ];

  assert.deepStrictEqual(pkg.remapNotes(notes, reframed), {
    general: 'Keep the overall instruction.',
    frames: [
      { file: 'frames/frame-01.png', text: 'Opening state' },
      { file: 'frames/frame-03.png', text: 'Save state' }
    ]
  });
});
