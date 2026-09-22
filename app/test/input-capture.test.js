'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-input-test-'));
  const binary = path.join(root, 'vendor', 'input', 'input-tap');
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
    appRoot: '/does/not/matter',
    platform: 'win32',
    spawn: () => {
      throw new Error('should not run');
    }
  });
  const state = await capture.start(
    { id: 'other', dir: '/tmp', display: {} },
    { enabled: true }
  );
  assert.strictEqual(state.supported, false);
  assert.match(state.reason, /macOS/);
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
