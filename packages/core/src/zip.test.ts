import { randomBytes } from 'node:crypto';

// An independent reader: the archives this writer produces must open in any
// standard unzip, so the tests read them back with one that shares no code.
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { REPRODUCIBLE_ZIP_MTIME } from './util.js';
import { createZip } from './zip.js';

const MTIME = REPRODUCIBLE_ZIP_MTIME;
const text = (value: string) => new TextEncoder().encode(value);

/** The compression method of the entry whose local header starts at `offset`. */
function methodAt(zip: Uint8Array, offset: number): number {
  return new DataView(zip.buffer, zip.byteOffset).getUint16(offset + 8, true);
}

describe('createZip', () => {
  it('round-trips every entry, in order, through an independent reader', () => {
    const entries = {
      'index.js': text('export const value = 1;\n'.repeat(200)),
      'nested/dir/data.bin': new Uint8Array(randomBytes(4096)),
      'empty.txt': new Uint8Array(0),
      'naïve-ünïcode.md': text('# héllo\n'),
    };

    const unzipped = unzipSync(createZip(entries, { mtime: MTIME }));

    expect(Object.keys(unzipped)).toEqual(Object.keys(entries));
    for (const [name, data] of Object.entries(entries)) {
      expect(unzipped[name]).toEqual(data);
    }
  });

  it('deflates what compresses and stores what does not', () => {
    const compressible = text('a'.repeat(10_000));
    const random = new Uint8Array(randomBytes(1024));

    const zip = createZip({ 'a.txt': compressible }, { mtime: MTIME });
    expect(methodAt(zip, 0)).toBe(8);
    expect(zip.length).toBeLessThan(compressible.length);
    expect(methodAt(createZip({ 'r.bin': random }, { mtime: MTIME }), 0)).toBe(0);
  });

  it('is byte-identical for identical input, and stamps the local DOS date of mtime', () => {
    const entries = { 'b.txt': text('beta'), 'a.txt': text('alpha') };

    const first = createZip(entries, { mtime: MTIME });
    expect(createZip(entries, { mtime: MTIME })).toEqual(first);
    const header = new DataView(first.buffer, first.byteOffset);
    // 1980-01-02 00:00:00 local: year offset 0, month 1, day 2, time 0.
    expect(header.getUint16(12, true)).toBe((1 << 5) | 2);
    expect(header.getUint16(10, true)).toBe(0);
  });

  it('refuses an mtime DOS time cannot hold rather than writing a wrong one', () => {
    expect(() => createZip({ 'a.txt': text('a') }, { mtime: new Date(1979, 11, 31) })).toThrow(
      /outside the 1980-2107 range/,
    );
  });

  it('returns bytes that own their buffer, not a view into a shared pool', () => {
    const zip = createZip({ 'a.txt': text('a') }, { mtime: MTIME });
    expect(zip.byteOffset).toBe(0);
    expect(zip.buffer.byteLength).toBe(zip.length);
  });
});
