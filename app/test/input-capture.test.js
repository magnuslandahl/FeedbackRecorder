'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const captureModule = require('../src/main/input-capture');

function fakeHelper(lines) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;

    const end = child.stdin.end.bind(child.stdin);
    child.stdin.end = (...args) => {
      end(...args);
      setImmediate(() => {
        child.stdout.end();
        child.emit('close', 0);
      });
    };
    child.kill = () => {
      child.killed = true;
      child.stdout.end();
      child.emit('close', 0);
    };

    setImmediate(() => {
      lines.forEach((line) => child.stdout.write(`${JSON.stringify(line)}\n`));
    });
    return child;
  };
}

function fixture(platform = 'darwin') {
  const root = fs.mkdtempSync(path.join(__dirname, '.fr-input-test-'));
  const binary = path.join(root, 'vendor', 'input', platform === 'win32' ? 'input-tap.exe' : 'input-tap');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'fake');
  const dir = path.join(root, 'run');
  fs.mkdirSync(dir);
  return { root, dir };
}

test('capture writes a crash-safe stream and returns a summarized timeline', async () => {
  const place = fixture();
  const capture = captureModule.create({
    appRoot: place.root,
    platform: 'darwin',
    spawn: fakeHelper([
      { type: 'status', pointer: true, keyboard: true },
      { time: 0.1, type: 'click', button: 'left', clicks: 2, x: 50, y: 25 },
      { time: 0.2, type: 'key', typing: true },
      { time: 0.3, type: 'key', typing: true },
      { time: 0.4, type: 'key', code: 36, modifiers: [] }
    ])
  });

  const run = {
    id: 'run-1',
    dir: place.dir,
    display: {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      captureWidth: 200,
      captureHeight: 100
    }
  };

  const started = await capture.start(run, { enabled: true, offsetSeconds: 1 });
  assert.strictEqual(started.pointer, true);
  assert.strictEqual(started.keyboard, true);
  assert.strictEqual(capture.active(run.id), true);

  const result = await capture.stop(run.id);
  assert.strictEqual(capture.active(run.id), false);
  assert.deepStrictEqual(result.entries, [
    {
      time: 1.1,
      kind: 'click',
      detail: 'double-click',
      x: 100,
      y: 50,
      screen: 'recorded'
    },
    {
      time: 1.2,
      kind: 'typing',
      detail: 'typed 2 characters',
      count: 2,
      endTime: 1.3
    },
    { time: 1.4, kind: 'key', detail: 'Enter' }
  ]);
  assert.strictEqual(
    fs.existsSync(path.join(place.dir, captureModule.RAW_FILE)),
    false,
    'the private working file must not remain in the package'
  );
  fs.rmSync(place.root, { recursive: true, force: true });
});

test('disabled capture starts no helper and says so', async () => {
  const place = fixture();
  let spawned = false;
  const capture = captureModule.create({
    appRoot: place.root,
    platform: 'darwin',
    spawn: () => {
      spawned = true;
      throw new Error('should not run');
    }
  });
  const state = await capture.start(
    { id: 'off', dir: place.dir, display: {} },
    { enabled: false }
  );
  assert.strictEqual(state.enabled, false);
  assert.strictEqual(spawned, false);
  fs.rmSync(place.root, { recursive: true, force: true });
});

test('unsupported platforms degrade without pretending to capture input', async () => {
  const capture = captureModule.create({
    appRoot: path.join(__dirname, 'missing-helper'),
    platform: 'linux',
    spawn: () => {
      throw new Error('should not run');
    }
  });
  const state = await capture.start(
    { id: 'other', dir: __dirname, display: {} },
    { enabled: true }
  );
  assert.strictEqual(state.supported, false);
  assert.match(state.reason, /macOS and Windows/);
});

test('Windows capture uses the executable and converts physical multi-monitor pixels to Electron DIP', async (t) => {
  const place = fixture('win32');
  t.after(() => fs.rmSync(place.root, { recursive: true, force: true }));
  const points = [];
  let binary;
  const capture = captureModule.create({
    appRoot: place.root,
    platform: 'win32',
    toDipPoint: (point) => {
      points.push(point);
      return { x: point.x / 2, y: point.y / 2 };
    },
    spawn: (file) => {
      binary = file;
      return fakeHelper([
        { type: 'status', pointer: true, keyboard: true },
        { time: 0.1, type: 'click', button: 'left', clicks: 1, x: -150, y: 50 },
        { time: 0.2, type: 'key', typing: true },
        { time: 0.3, type: 'key', platform: 'win32', code: 83, modifiers: ['ctrl'] },
        { time: 0.4, type: 'scroll' }
      ])();
    }
  });
  const run = {
    id: 'windows', dir: place.dir,
    display: { bounds: { x: -100, y: 0, width: 100, height: 100 }, captureWidth: 200, captureHeight: 200 }
  };
  const started = await capture.start(run, { enabled: true, offsetSeconds: 1 });
  assert.strictEqual(started.helper, true);
  assert.strictEqual(started.pointer, true);
  assert.strictEqual(binary, path.join(place.root, 'vendor', 'input', 'input-tap.exe'));
  const result = await capture.stop(run.id);
  assert.deepStrictEqual(points, [{ x: -150, y: 50 }]);
  assert.deepStrictEqual(result.entries, [
    { time: 1.1, kind: 'click', detail: 'click', x: 50, y: 50, screen: 'recorded' },
    { time: 1.2, kind: 'typing', detail: 'typed 1 character', count: 1, endTime: 1.2 },
    { time: 1.3, kind: 'shortcut', detail: 'Ctrl+S' },
    { time: 1.4, kind: 'scroll', detail: 'scrolled', count: 1, endTime: 1.4 }
  ]);
  assert.strictEqual(fs.existsSync(path.join(place.dir, captureModule.RAW_FILE)), false);
});

test('Windows input hook errors are reported without macOS permission instructions', () => {
  assert.match(captureModule.reasonFor({
    supported: true, helper: true, pointer: false, keyboard: false
  }, 'win32'), /Windows.*hooks/);
  assert.match(captureModule.partialReason({
    pointer: true, keyboard: false
  }, 'win32'), /keyboard hook was unavailable/);
  assert.strictEqual(captureModule.locate(__dirname, null, 'linux'), null);
});

test('Windows start reports a partial hook installation without macOS permission advice', async (t) => {
  const place = fixture('win32');
  t.after(() => fs.rmSync(place.root, { recursive: true, force: true }));
  const capture = captureModule.create({
    appRoot: place.root, platform: 'win32',
    toDipPoint: (point) => point,
    spawn: fakeHelper([{ type: 'status', pointer: true, keyboard: false }])
  });
  const run = { id: 'partial', dir: place.dir, display: {} };
  const started = await capture.start(run, { enabled: true });
  assert.strictEqual(started.helper, true);
  assert.strictEqual(started.pointer, true);
  assert.strictEqual(started.keyboard, false);
  assert.match(started.reason, /Windows keyboard hook was unavailable/);
  assert.doesNotMatch(started.reason, /Input Monitoring|Accessibility/);
  await capture.stop(run.id);
});

test('Windows status reports a missing or broken helper instead of claiming hooks are ready', async (t) => {
  const missing = path.join(__dirname, 'missing-helper');
  assert.deepStrictEqual(captureModule.status(missing, null, 'win32'), {
    supported: true, helper: false, pointer: false, keyboard: false,
    reason: 'The input activity helper is missing from this build.'
  });
  const unavailable = captureModule.create({ appRoot: missing, platform: 'win32' });
  assert.deepStrictEqual(await unavailable.start({
    id: 'missing', dir: __dirname, display: {}
  }, { enabled: true }), {
    supported: true, helper: false, enabled: true, pointer: false, keyboard: false,
    reason: 'The input activity helper is missing from this build.'
  });
  const place = fixture('win32');
  t.after(() => fs.rmSync(place.root, { recursive: true, force: true }));
  const packaged = fixture('win32');
  t.after(() => fs.rmSync(packaged.root, { recursive: true, force: true }));
  assert.strictEqual(captureModule.locate(place.root, packaged.root, 'win32'),
    path.join(packaged.root, 'vendor', 'input', 'input-tap.exe'));
  const checked = captureModule.status(place.root, null, 'win32');
  assert.strictEqual(checked.supported, true);
  assert.strictEqual(checked.helper, true);
  assert.strictEqual(checked.pointer, false);
  assert.strictEqual(checked.keyboard, false);
  assert.match(checked.reason, /Windows input hooks could not be checked:/);
  assert.strictEqual(captureModule.requestPermissions(place.root, null, 'win32').helper, true);
});

test('Windows start reports a helper that exits without hook status', async (t) => {
  const place = fixture('win32');
  t.after(() => fs.rmSync(place.root, { recursive: true, force: true }));
  const capture = captureModule.create({
    appRoot: place.root, platform: 'win32',
    toDipPoint: (point) => point,
    spawn: () => {
      const child = fakeHelper([])();
      setImmediate(() => {
        child.stdout.end();
        child.emit('close', 0);
      });
      return child;
    }
  });
  const run = { id: 'early-exit', dir: place.dir, display: {} };
  const started = await capture.start(run, { enabled: true });
  assert.strictEqual(started.helper, true);
  assert.strictEqual(started.pointer, false);
  assert.strictEqual(started.keyboard, false);
  assert.match(started.reason, /exited without reporting hook availability/);
  await capture.stop(run.id);
});

test('native Windows selftest emits only redacted typing and no live input', {
  skip: process.platform !== 'win32'
}, (t) => {
  const binary = path.join(__dirname, '..', 'vendor', 'input', 'input-tap.exe');
  if (!fs.existsSync(binary)) return t.skip('Build the Windows helper with npm run vendor to run this test.');
  const events = execFileSync(binary, ['--selftest'], { encoding: 'utf8' })
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.strictEqual(events[0].x, -120);
  assert.strictEqual(events[1].type, 'scroll');
  assert.deepStrictEqual(events[2].modifiers, ['ctrl']);
  assert.deepStrictEqual(events.filter((event) => event.typing).length, 2);
  for (const event of events.filter((item) => item.typing)) {
    assert.deepStrictEqual(Object.keys(event).sort(), ['time', 'type', 'typing']);
  }
  assert.strictEqual(events[5].code, 13);
});

test('native Windows helper checks hook status and shuts down at recording stop', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const appRoot = path.join(__dirname, '..');
  if (!fs.existsSync(path.join(appRoot, 'vendor', 'input', 'input-tap.exe'))) {
    return t.skip('Build the Windows helper with npm run vendor to run this test.');
  }
  const place = fixture('win32');
  t.after(() => fs.rmSync(place.root, { recursive: true, force: true }));
  const checked = JSON.parse(execFileSync(
    path.join(appRoot, 'vendor', 'input', 'input-tap.exe'),
    ['--check'], { encoding: 'utf8' }
  ).trim());
  assert.strictEqual(checked.type, 'status');
  assert.strictEqual(typeof checked.pointer, 'boolean');
  assert.strictEqual(typeof checked.keyboard, 'boolean');
  const status = captureModule.status(appRoot, null, 'win32');
  assert.strictEqual(status.helper, true);
  assert.strictEqual(status.pointer, checked.pointer);
  assert.strictEqual(status.keyboard, checked.keyboard);
  const capture = captureModule.create({
    appRoot, platform: 'win32', toDipPoint: (point) => point
  });
  const run = { id: 'live-helper', dir: place.dir, display: {} };
  const started = await capture.start(run, { enabled: true });
  assert.strictEqual(started.supported, true);
  assert.strictEqual(started.helper, true);
  assert.strictEqual(typeof started.pointer, 'boolean');
  assert.strictEqual(typeof started.keyboard, 'boolean');
  assert.strictEqual(capture.active(run.id), true);
  const result = await capture.stop(run.id);
  assert.strictEqual(capture.active(run.id), false);
  assert.strictEqual(result.status.malformed, 0);
  assert.strictEqual(fs.existsSync(path.join(place.dir, captureModule.RAW_FILE)), false);
});

test('each missing macOS grant names the pane that fixes it', () => {
  assert.match(
    captureModule.reasonFor({
      supported: true,
      helper: true,
      pointer: false,
      keyboard: true
    }),
    /Accessibility/
  );
  assert.match(
    captureModule.reasonFor({
      supported: true,
      helper: true,
      pointer: true,
      keyboard: false
    }),
    /Input Monitoring/
  );
  assert.match(
    captureModule.reasonFor({
      supported: true,
      helper: true,
      pointer: false,
      keyboard: false
    }),
    /Accessibility and Input Monitoring/
  );
});
