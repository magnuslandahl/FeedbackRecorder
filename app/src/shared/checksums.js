'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const SHA256 = /^[a-f0-9]{64}$/i;

function parseManifest(text) {
  const entries = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);

  for (const line of lines) {
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64}) ([ *])(.+)$/i);
    if (!match || /[\r\n]/.test(match[3])) {
      throw new Error('SHA256SUMS.txt contains a malformed entry');
    }
    entries.push({
      sha256: match[1].toLowerCase(),
      name: match[3].startsWith('./') ? match[3].slice(2) : match[3]
    });
  }

  return entries;
}

function expectedFor(text, assetName) {
  const name = String(assetName || '');
  if (!name || /[\\/\r\n]/.test(name)) {
    throw new Error('the selected update has an invalid asset name');
  }

  const matches = parseManifest(text).filter((entry) => entry.name === name);
  if (matches.length === 0) {
    throw new Error(`SHA256SUMS.txt has no checksum for ${name}`);
  }
  if (matches.length !== 1) {
    throw new Error(`SHA256SUMS.txt has duplicate checksums for ${name}`);
  }
  return matches[0].sha256;
}

function equal(left, right) {
  if (!SHA256.test(String(left || '')) || !SHA256.test(String(right || ''))) return false;
  const a = Buffer.from(String(left).toLowerCase(), 'hex');
  const b = Buffer.from(String(right).toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function removeDownload(target) {
  fs.rmSync(`${target}.part`, { force: true });
  fs.rmSync(target, { force: true });
}

async function finalizeDownload(partial, target, expected) {
  const actual = await hashFile(partial);
  if (!equal(actual, expected)) {
    removeDownload(target);
    throw new Error(
      `the checksum for ${require('node:path').basename(target)} did not match SHA256SUMS.txt`
    );
  }

  fs.rmSync(target, { force: true });
  fs.renameSync(partial, target);
  return { path: target, sha256: actual };
}

module.exports = {
  SHA256,
  parseManifest,
  expectedFor,
  equal,
  hashFile,
  removeDownload,
  finalizeDownload
};
