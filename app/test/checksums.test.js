'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const checksums = require('../src/shared/checksums');

const NAME = 'FeedbackRecorder-Windows-x64-Setup.exe';
const CONTENT = Buffer.from('small installer fixture');
const DIGEST = crypto.createHash('sha256').update(CONTENT).digest('hex');

test('the exact selected asset has one valid checksum', () => {
  const manifest = `${DIGEST}  ./${NAME}\n`;
  assert.strictEqual(checksums.expectedFor(manifest, NAME), DIGEST);
});

test('a missing selected asset checksum is rejected', () => {
  assert.throws(
    () => checksums.expectedFor(`${DIGEST}  ./another-file.exe\n`, NAME),
    /no checksum/
  );
});

test('a malformed checksum manifest is rejected', () => {
  assert.throws(
    () => checksums.expectedFor(`not-a-sha256  ./${NAME}\n`, NAME),
    /malformed/
  );
});

test('duplicate selected asset checksums are rejected', () => {
  const manifest = `${DIGEST}  ./${NAME}\n${DIGEST}  ./${NAME}\n`;
  assert.throws(() => checksums.expectedFor(manifest, NAME), /duplicate/);
});

test('a correct completed download is renamed into place', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-checksum-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, NAME);
  const partial = `${target}.part`;
  fs.writeFileSync(partial, CONTENT);

  await checksums.finalizeDownload(partial, target, DIGEST);

  assert.deepStrictEqual(fs.readFileSync(target), CONTENT);
  assert.strictEqual(fs.existsSync(partial), false);
});

test('a checksum mismatch removes both partial and target files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-checksum-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, NAME);
  const partial = `${target}.part`;
  fs.writeFileSync(target, Buffer.from('stale installer'));
  fs.writeFileSync(partial, Buffer.from('tampered installer'));

  await assert.rejects(
    checksums.finalizeDownload(partial, target, DIGEST),
    /did not match/
  );

  assert.strictEqual(fs.existsSync(target), false);
  assert.strictEqual(fs.existsSync(partial), false);
});
