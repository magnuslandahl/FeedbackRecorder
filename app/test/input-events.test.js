'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const input = require('../src/shared/input-events');

test('a shortcut is named in the order people write it', () => {
  assert.deepStrictEqual(
    input.classifyKey({ code: 1, modifiers: ['shift', 'cmd'] }),
    { kind: 'shortcut', label: 'Shift+Cmd+S' }
  );
});

test('a navigation key is named without recording text', () => {
  assert.deepStrictEqual(
    input.classifyKey({ code: 36, modifiers: [] }),
    { kind: 'key', label: 'Enter' }
  );
});

test('ordinary typing is counted but its key and character disappear', () => {
  const events = input.summarize([
    { time: 1, type: 'key', typing: true },
    { time: 1.1, type: 'key', code: 4, modifiers: [] },
    { time: 1.2, type: 'key', code: 14, modifiers: ['shift'] }
  ]);

  assert.deepStrictEqual(events, [
    {
      time: 1,
      kind: 'typing',
      detail: 'typed 3 characters',
      count: 3,
      endTime: 1.2
    }
  ]);
  const written = JSON.stringify(events);
  assert.ok(!written.includes('"code"'), written);
  assert.ok(!written.includes('"character"'), written);
});

test('Option plus a letter is typing, not a shortcut that leaks its key position', () => {
  assert.deepStrictEqual(
    input.classifyKey({ code: 14, modifiers: ['alt'] }),
    { kind: 'typing', label: '' }
  );
});

test('Space is part of ordinary typing rather than a word-boundary log', () => {
  assert.deepStrictEqual(
    input.classifyKey({ code: 49, modifiers: [] }),
    { kind: 'typing', label: '' }
  );
});

test('Option plus an arrow is safe, useful navigation', () => {
  assert.deepStrictEqual(
    input.classifyKey({ code: 123, modifiers: ['alt'] }),
    { kind: 'shortcut', label: 'Alt+Left' }
  );
});

test('separate acts of typing stay separate', () => {
  const events = input.summarize([
    { time: 1, type: 'key', typing: true },
    { time: 4, type: 'key', typing: true }
  ]);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].detail, 'typed 1 character');
  assert.strictEqual(events[1].detail, 'typed 1 character');
});

test('click, double-click and right-click keep their distinction', () => {
  const events = input.summarize([
    { time: 1, type: 'click', button: 'left', clicks: 1 },
    { time: 2, type: 'click', button: 'left', clicks: 2 },
    { time: 3, type: 'click', button: 'right', clicks: 1 }
  ]);
  assert.deepStrictEqual(
    events.map((event) => event.detail),
    ['click', 'double-click', 'right-click']
  );
});

test('a Retina click is mapped from desktop points to recording pixels', () => {
  const event = input.normalizeRaw(
    { time: 1, type: 'click', button: 'left', clicks: 1, x: 500, y: 250 },
    {
      bounds: { x: 0, y: 0, width: 1000, height: 500 },
      captureWidth: 2000,
      captureHeight: 1000
    },
    0.25
  );
  assert.deepStrictEqual(event, {
    time: 1.25,
    type: 'click',
    button: 'left',
    clicks: 1,
    screen: 'recorded',
    x: 1000,
    y: 500
  });
});

test('a click on another monitor is kept without pretending it is in the video', () => {
  const event = input.normalizeRaw(
    { time: 2, type: 'click', button: 'right', clicks: 1, x: -200, y: 20 },
    {
      bounds: { x: 0, y: 0, width: 1000, height: 500 },
      captureWidth: 2000,
      captureHeight: 1000
    },
    0
  );
  assert.strictEqual(event.screen, 'other');
  assert.ok(!('x' in event));
  assert.ok(!('y' in event));
});

test('a click during app-window capture keeps its time without invented coordinates', () => {
  const event = input.normalizeRaw(
    { time: 2, type: 'click', button: 'left', clicks: 1, x: 500, y: 250 },
    {
      kind: 'window',
      bounds: null,
      captureWidth: 1600,
      captureHeight: 900
    },
    0.5
  );
  assert.strictEqual(event.time, 2.5);
  assert.ok(!('screen' in event));
  assert.ok(!('x' in event));
  assert.ok(!('y' in event));
});

test('an event is tied to the frame that was on screen at the time', () => {
  const frames = [
    { time: 0, file: 'frames/frame-01.png' },
    { time: 5, file: 'frames/frame-02.png' }
  ];
  const revisits = [{ time: 10, file: 'frames/frame-01.png' }];
  assert.strictEqual(input.frameAt(7, frames, revisits), 'frames/frame-02.png');
  assert.strictEqual(input.frameAt(11, frames, revisits), 'frames/frame-01.png');
});

test('a click says whether it landed inside the framed region', () => {
  const region = { x: 100, y: 200, width: 300, height: 200 };
  assert.strictEqual(input.withinRegion({ x: 100, y: 200 }, region), true);
  assert.strictEqual(input.withinRegion({ x: 399, y: 399 }, region), true);
  assert.strictEqual(input.withinRegion({ x: 400, y: 399 }, region), false);
});

test('JSONL survives a truncated bad line and keeps the valid events', () => {
  const parsed = input.parseJsonl(
    '{"time":1,"kind":"click"}\nnot json\n{"time":2,"kind":"key"}\n'
  );
  assert.deepStrictEqual(parsed, [
    { time: 1, kind: 'click' },
    { time: 2, kind: 'key' }
  ]);
});

test('the summary names what is available without inventing typed text', () => {
  const result = input.describe([
    { kind: 'click' },
    { kind: 'shortcut' },
    { kind: 'typing', count: 9 },
    { kind: 'scroll' }
  ]);
  assert.strictEqual(
    result.summary,
    '1 click, 1 shortcut, 9 typed characters, 1 scroll'
  );
});

test('input timestamps keep hundredths and carry cleanly into the next second', () => {
  assert.strictEqual(input.formatTime(1.234), '00:01.23');
  assert.strictEqual(input.formatTime(59.999), '01:00.00');
  assert.strictEqual(input.formatTime(3661.1), '1:01:01.10');
});

test(
  'the native helper emits valid redacted JSON without posting input',
  { skip: process.platform !== 'darwin' },
  () => {
    const binary = path.join(__dirname, '..', 'vendor', 'input', 'input-tap');
    if (!fs.existsSync(binary)) return;
    const lines = execFileSync(binary, ['--selftest'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.strictEqual(lines[0].type, 'click');
    assert.deepStrictEqual(lines[1].modifiers, ['cmd']);
    const typing = lines.filter((line) => line.typing);
    assert.strictEqual(typing.length, 2);
    typing.forEach((line) => {
      assert.ok(!('code' in line), JSON.stringify(line));
      assert.ok(!('character' in line), JSON.stringify(line));
    });
    assert.strictEqual(lines[4].code, 36);
    assert.strictEqual(lines[5].code, 123);
    assert.deepStrictEqual(lines[5].modifiers, ['alt']);
  }
);
