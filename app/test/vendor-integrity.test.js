'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const vendor = require('../scripts/fetch-vendor');

function integrity(data) {
  return {
    size: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-vendor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'asset.bin');
}

function directoryFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-vendor-directory-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a valid vendor download is accepted only after exact verification', async (t) => {
  const target = fixture(t);
  const content = Buffer.from('verified vendor input');

  await vendor.download(
    'https://example.invalid/asset',
    target,
    integrity(content),
    async () => new Response(content, { status: 200 })
  );

  assert.deepStrictEqual(fs.readFileSync(target), content);
  assert.strictEqual(fs.existsSync(`${target}.part`), false);
});

test('a valid cached vendor file is reused without a network request', async (t) => {
  const target = fixture(t);
  const content = Buffer.from('cached and verified');
  fs.writeFileSync(target, content);
  let requests = 0;

  await vendor.download(
    'https://example.invalid/asset',
    target,
    integrity(content),
    async () => {
      requests += 1;
      return new Response(content, { status: 200 });
    }
  );

  assert.strictEqual(requests, 0);
});

test('a corrupt cached vendor file is replaced with a verified copy', async (t) => {
  const target = fixture(t);
  const content = Buffer.from('correct replacement');
  fs.writeFileSync(target, Buffer.alloc(content.length, 0x78));
  let requests = 0;

  await vendor.download(
    'https://example.invalid/asset',
    target,
    integrity(content),
    async () => {
      requests += 1;
      return new Response(content, { status: 200 });
    }
  );

  assert.strictEqual(requests, 1);
  assert.deepStrictEqual(fs.readFileSync(target), content);
});

test('failed vendor verification leaves no target or partial file', async (t) => {
  const target = fixture(t);
  const expected = Buffer.from('expected');

  await assert.rejects(
    vendor.download(
      'https://example.invalid/asset',
      target,
      integrity(expected),
      async () => new Response(Buffer.from('tampered'), { status: 200 })
    ),
    /failed integrity verification/
  );

  assert.strictEqual(fs.existsSync(target), false);
  assert.strictEqual(fs.existsSync(`${target}.part`), false);
});

test('archive extraction replaces the entire executable directory', (t) => {
  const root = directoryFixture(t);
  const archive = path.join(root, 'verified.tar.gz');
  const dest = path.join(root, 'whisper');
  fs.writeFileSync(archive, 'fixture');
  fs.mkdirSync(path.join(dest, 'stale'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'stale', 'whisper-cli'), 'untrusted executable');

  vendor.replaceArchiveDirectory(archive, dest, (_source, target) => {
    fs.mkdirSync(path.join(target, 'current'), { recursive: true });
    fs.writeFileSync(path.join(target, 'current', 'whisper-cli'), 'verified executable');
  });

  assert.strictEqual(fs.existsSync(path.join(dest, 'stale', 'whisper-cli')), false);
  assert.strictEqual(
    fs.readFileSync(path.join(dest, 'current', 'whisper-cli'), 'utf8'),
    'verified executable'
  );
});

test('failed archive extraction leaves no partially trusted directory', (t) => {
  const root = directoryFixture(t);
  const archive = path.join(root, 'verified.tar.gz');
  const dest = path.join(root, 'whisper');
  fs.writeFileSync(archive, 'fixture');

  assert.throws(
    () => vendor.replaceArchiveDirectory(archive, dest, (_source, target) => {
      fs.writeFileSync(path.join(target, 'partial-whisper-cli'), 'partial');
      throw new Error('extract failed');
    }),
    /extract failed/
  );

  assert.strictEqual(fs.existsSync(dest), false);
});

test('a macOS cache cannot bypass exact source revision verification', (t) => {
  const root = directoryFixture(t);
  const vendorRoot = path.join(root, 'vendor');
  const dest = path.join(vendorRoot, 'whisper');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'whisper-cli'), 'cached executable');
  let revisionChecks = 0;

  const fakeExec = (command, args) => {
    if (args.includes('--version')) return Buffer.from('ok');
    if (command === 'git' && args.includes('rev-parse')) {
      revisionChecks += 1;
      return '0000000000000000000000000000000000000000\n';
    }
    return Buffer.from('');
  };

  assert.throws(
    () => vendor.buildWhisperForMac({
      execFileSync: fakeExec,
      vendor: vendorRoot,
      temp: root,
      cpuCount: 1
    }),
    /resolved to .* expected/
  );
  assert.strictEqual(revisionChecks, 1);
  assert.strictEqual(
    fs.readFileSync(path.join(dest, 'whisper-cli'), 'utf8'),
    'cached executable'
  );
});

test('a verified macOS build replaces the final tree instead of merging into it', (t) => {
  const root = directoryFixture(t);
  const vendorRoot = path.join(root, 'vendor');
  const dest = path.join(vendorRoot, 'whisper');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'stale-backend.dylib'), 'stale');

  const fakeExec = (command, args) => {
    if (args.includes('--version')) return Buffer.from('ok');
    if (command === 'git' && args.includes('rev-parse')) {
      return `${vendor.WHISPER_COMMIT}\n`;
    }
    if (command === 'cmake' && args[0] === '--build') {
      const built = path.join(args[1], 'bin', 'whisper-cli');
      fs.mkdirSync(path.dirname(built), { recursive: true });
      fs.writeFileSync(built, 'verified build');
    }
    return Buffer.from('');
  };

  vendor.buildWhisperForMac({
    execFileSync: fakeExec,
    vendor: vendorRoot,
    temp: root,
    cpuCount: 1
  });

  assert.strictEqual(fs.existsSync(path.join(dest, 'stale-backend.dylib')), false);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'whisper-cli'), 'utf8'), 'verified build');
});
