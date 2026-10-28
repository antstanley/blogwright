/**
 * A minimal, deterministic zip writer over Node's own `zlib` - raw deflate
 * and CRC-32 - for the archives this repo builds: the repo source zip, the
 * build-agent bundle, and the Lambda deployment packages. It writes exactly
 * what those need and nothing else: regular file entries, no directories, no
 * file modes, no encryption, no ZIP64.
 *
 * Identical entries and `mtime` always produce identical bytes: entries are
 * written in insertion order with one fixed timestamp and one fixed deflate
 * level, and no field reads the clock, the host or the environment.
 */

import { crc32, deflateRawSync } from 'node:zlib';

/** Archive path to file bytes, written in insertion order. */
export type ZipEntries = Readonly<Record<string, Uint8Array>>;

export interface ZipOptions {
  /**
   * Every entry's modification time. A zip stores DOS time, which is local
   * time, so this is read with the local getters - pass a `Date` built from
   * local parts (see {@link REPRODUCIBLE_ZIP_MTIME}) for the same bytes in
   * every timezone.
   */
  mtime: Date;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/** Version 2.0 of the format: the first to define deflate. */
const VERSION = 20;
/** General-purpose flag bit 11: the entry's name is UTF-8. */
const UTF8_NAME = 0x0800;
const STORED = 0;
const DEFLATED = 8;
/** The level every archive in this repo has always been built at. */
const DEFLATE_LEVEL = 6;

/** Without ZIP64, the entry count is 16 bits and every size and offset 32. */
const MAX_ENTRIES = 0xffff;
const MAX_32_BIT = 0xffffffff;

/** The DOS date and time fields for `mtime`, read in local time. */
function dosTimestamp(mtime: Date): { date: number; time: number } {
  const year = mtime.getFullYear();
  if (year < 1980 || year > 2107) {
    throw new Error(`zip mtime ${mtime.toString()} is outside the 1980-2107 range DOS time holds`);
  }
  return {
    date: ((year - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate(),
    time: (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1),
  };
}

/** Raise when a size or offset no longer fits the 32-bit field it is written to. */
function require32Bit(value: number, what: string): number {
  if (value > MAX_32_BIT) {
    throw new Error(`zip ${what} is ${value} bytes, over the 4 GiB a zip without ZIP64 holds`);
  }
  return value;
}

/** Build a zip archive of `entries`, deflating each one unless storing it is smaller. */
export function createZip(entries: ZipEntries, options: ZipOptions): Uint8Array {
  const files = Object.entries(entries);
  if (files.length > MAX_ENTRIES) {
    throw new Error(`zip has ${files.length} entries, over the ${MAX_ENTRIES} a zip holds`);
  }
  const { date, time } = dosTimestamp(options.mtime);

  const chunks: Uint8Array[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const flags = nameBytes.length === name.length ? 0 : UTF8_NAME;
    const deflated = deflateRawSync(data, { level: DEFLATE_LEVEL });
    const method = deflated.length < data.length ? DEFLATED : STORED;
    const body = method === DEFLATED ? deflated : data;
    const checksum = crc32(data);
    const compressedSize = require32Bit(body.length, `entry "${name}" (compressed)`);
    const size = require32Bit(data.length, `entry "${name}"`);

    const local = Buffer.alloc(LOCAL_FILE_HEADER_SIZE);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    // Extra-field length (28) stays 0.

    const central = Buffer.alloc(CENTRAL_DIRECTORY_HEADER_SIZE);
    central.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    central.writeUInt16LE(VERSION, 4); // made by: MS-DOS host, so no Unix modes
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra, comment, disk-start, internal and external attributes (30-41) stay 0.
    central.writeUInt32LE(require32Bit(offset, 'local header offset'), 42);
    centralHeaders.push(central, nameBytes);

    chunks.push(local, nameBytes, body);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralDirectorySize = centralHeaders.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_SIZE);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  // Disk numbers (4, 6) stay 0: one disk.
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(require32Bit(centralDirectorySize, 'central directory'), 12);
  end.writeUInt32LE(require32Bit(offset, 'central directory offset'), 16);
  // Comment length (20) stays 0.

  // Copied out of the Buffer: a small `Buffer.concat` result is a view into
  // Node's shared pool, so a caller reading `.buffer` would get the whole pool.
  return new Uint8Array(Buffer.concat([...chunks, ...centralHeaders, end]));
}
