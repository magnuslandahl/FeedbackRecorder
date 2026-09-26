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
