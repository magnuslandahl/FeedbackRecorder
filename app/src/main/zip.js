'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// A ZIP writer, because this app ships no production dependencies and a zip is a
// documented container rather than a mystery. It writes what the format calls a
// "clean" archive: every local header carries its final CRC and sizes, with no
// data descriptors. That needs seeking backwards, which is free here because the
// target is a real file rather than a pipe, and it is the form every extractor
// agrees on.
//
// Entries are streamed, so a multi-gigabyte recording never sits in memory.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

// Past this, the 32-bit size and offset fields cannot hold the value and the
// ZIP64 records are required. Injectable so the ZIP64 path can be tested with a
// small file instead of a 4 GB one.
const ZIP64_THRESHOLD = MAX32;

const CHUNK = 1 << 20;

// MS-DOS packed date and time, which is what the format stores. It has
// two-second resolution and starts at 1980; both are the format's, not ours.
function dosDateTime(date) {
  const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  };
}

// Zip stores forward slashes on every platform, including Windows.
function normalizeEntryName(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function tally(state) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      state.crc = zlib.crc32(chunk, state.crc);
      state.uncompressed += chunk.length;
      callback(null, chunk);
    }
  });
}

// Writes at an explicit position rather than appending, so the caller stays in
// control of the layout and can go back and correct a header afterwards.
function positionedWriter(handle, startOffset, onWritten) {
  let offset = startOffset;
  return new Writable({
    highWaterMark: CHUNK,
    write(chunk, _encoding, callback) {
      handle
        .write(chunk, 0, chunk.length, offset)
        .then((result) => {
          offset += result.bytesWritten;
          onWritten(result.bytesWritten);
          callback();
        })
        .catch(callback);
    }
  });
}

function localHeader(entry, useZip64) {
  const nameBytes = Buffer.from(entry.name, 'utf8');
  const extraLength = useZip64 ? 20 : 0;
  const header = Buffer.alloc(30 + nameBytes.length + extraLength);

  header.writeUInt32LE(SIG_LOCAL, 0);
  // 4.5 is what ZIP64 requires; 2.0 is what deflate requires.
  header.writeUInt16LE(useZip64 ? 45 : 20, 4);
  // Bit 11: the name is UTF-8. Without it, anything outside ASCII is guesswork
  // for the extractor.
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc >>> 0, 14);
  header.writeUInt32LE(useZip64 ? MAX32 : entry.compressed, 18);
  header.writeUInt32LE(useZip64 ? MAX32 : entry.uncompressed, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(extraLength, 28);
  nameBytes.copy(header, 30);

  if (useZip64) {
    // In a local header both sizes are always present, in this order.
    const at = 30 + nameBytes.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(16, at + 2);
    header.writeBigUInt64LE(BigInt(entry.uncompressed), at + 4);
    header.writeBigUInt64LE(BigInt(entry.compressed), at + 12);
  }

  return header;
}

function centralHeader(entry) {
  const nameBytes = Buffer.from(entry.name, 'utf8');

  // Unlike the local header, only the fields that actually overflowed appear
  // here, and they appear in a fixed order.
  const overflowed = [];
  if (entry.uncompressed >= entry.threshold) overflowed.push(BigInt(entry.uncompressed));
  if (entry.compressed >= entry.threshold) overflowed.push(BigInt(entry.compressed));
  if (entry.offset >= entry.threshold) overflowed.push(BigInt(entry.offset));

  const extraLength = overflowed.length ? 4 + overflowed.length * 8 : 0;
  const header = Buffer.alloc(46 + nameBytes.length + extraLength);

  header.writeUInt32LE(SIG_CENTRAL, 0);
  // Made by 3.0 on Unix, so the external attributes below are read as a mode.
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(entry.zip64 ? 45 : 20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(entry.compressed >= entry.threshold ? MAX32 : entry.compressed, 20);
  header.writeUInt32LE(entry.uncompressed >= entry.threshold ? MAX32 : entry.uncompressed, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(extraLength, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  // 0644, shifted into the high half where Unix permissions live.
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(entry.offset >= entry.threshold ? MAX32 : entry.offset, 42);
  nameBytes.copy(header, 46);

  if (extraLength) {
    const at = 46 + nameBytes.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(overflowed.length * 8, at + 2);
    overflowed.forEach((value, index) => header.writeBigUInt64LE(value, at + 4 + index * 8));
  }

  return header;
}

function endRecords(options) {
  const { count, centralSize, centralOffset, threshold } = options;

  // The 32-bit end record cannot express these, so when any of them overflows a
  // ZIP64 end record goes in front of it and the old one is left holding the
  // markers that say "look there instead".
  const needsZip64 =
    count >= MAX16 || centralSize >= threshold || centralOffset >= threshold;

  const parts = [];

  if (needsZip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(SIG_EOCD64, 0);
    record.writeBigUInt64LE(BigInt(44), 4); // size of the rest of this record
    record.writeUInt16LE(0x031e, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(centralSize), 40);
    record.writeBigUInt64LE(BigInt(centralOffset), 48);
    parts.push(record);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(SIG_EOCD64_LOCATOR, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(locator);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count >= MAX16 ? MAX16 : count, 8);
  eocd.writeUInt16LE(count >= MAX16 ? MAX16 : count, 10);
  eocd.writeUInt32LE(centralSize >= threshold ? MAX32 : centralSize, 12);
  eocd.writeUInt32LE(centralOffset >= threshold ? MAX32 : centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  parts.push(eocd);

  return Buffer.concat(parts);
}

// entries: [{ name, sourcePath, method }] where method is 'store' or 'deflate'.
async function writeZip(options) {
  const target = options.target;
  const entries = options.entries || [];
  const threshold = Number(options.zip64Threshold) || ZIP64_THRESHOLD;
  const stamp = dosDateTime(options.date);

  if (!entries.length) throw new Error('There is nothing to put in the zip.');

  const handle = await fs.promises.open(target, 'w');
  const written = [];
  let offset = 0;

  try {
    for (const entry of entries) {
      const name = normalizeEntryName(entry.name);
      const size = (await fs.promises.stat(entry.sourcePath)).size;
      const method = entry.method === 'store' ? METHOD_STORE : METHOD_DEFLATE;

      // Decided before the header is written, because it changes the header's
      // length. The uncompressed size is known now; the compressed size is
      // checked against the same limit once it is.
      const zip64 = size >= threshold || offset >= threshold;

      const placeholder = localHeader(
        { name, method, crc: 0, compressed: 0, uncompressed: size, ...stamp },
        zip64
      );
      await handle.write(placeholder, 0, placeholder.length, offset);

      const headerOffset = offset;
      const dataOffset = offset + placeholder.length;
      const state = { crc: 0, uncompressed: 0, compressed: 0 };

      const stages = [fs.createReadStream(entry.sourcePath, { highWaterMark: CHUNK }), tally(state)];
      if (method === METHOD_DEFLATE) stages.push(zlib.createDeflateRaw({ level: 6 }));
      stages.push(positionedWriter(handle, dataOffset, (n) => {
        state.compressed += n;
      }));
      await pipeline(stages);

      if (!zip64 && (state.compressed >= threshold || state.uncompressed >= threshold)) {
        // Deflate can grow incompressible data slightly. Refusing is the only
        // honest option: writing it anyway would produce an archive that looks
        // fine until somebody tries to open it.
        throw new Error(`${name} grew past what a 32-bit zip entry can describe.`);
      }

      // Now that the CRC and the sizes are known, the placeholder is replaced.
      const finalHeader = localHeader(
        {
          name,
          method,
          crc: state.crc,
          compressed: state.compressed,
          uncompressed: state.uncompressed,
          ...stamp
        },
        zip64
      );
      await handle.write(finalHeader, 0, finalHeader.length, headerOffset);

      offset = dataOffset + state.compressed;
      written.push({
        name,
        method,
        crc: state.crc,
        compressed: state.compressed,
        uncompressed: state.uncompressed,
        offset: headerOffset,
        zip64,
        threshold,
        ...stamp
      });
    }

    const centralOffset = offset;
    const central = Buffer.concat(written.map((entry) => centralHeader(entry)));
    await handle.write(central, 0, central.length, centralOffset);

    const tail = endRecords({
      count: written.length,
      centralSize: central.length,
      centralOffset,
      threshold
    });
    await handle.write(tail, 0, tail.length, centralOffset + central.length);

    return {
      path: target,
      bytes: centralOffset + central.length + tail.length,
      entries: written.length
    };
  } finally {
    await handle.close();
  }
}

module.exports = { writeZip, ZIP64_THRESHOLD, dosDateTime, normalizeEntryName };
