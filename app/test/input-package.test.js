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
