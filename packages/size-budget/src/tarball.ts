/**
 * Reads the unpacked size of an npm tarball - the sum of its regular files'
 * sizes, the figure npm publishes as `dist.unpackedSize` - straight from the
 * gzipped ustar stream, so no extraction or tar dependency is needed.
 */

import { gunzipSync } from 'node:zlib';

/** ustar header and data blocks are 512 bytes. */
const BLOCK_SIZE = 512;

const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPE_OFFSET = 156;

/** Type flags of a regular file: `'0'`, and NUL from pre-POSIX writers. */
const REGULAR_FILE_TYPES = new Set(['0', '\0']);

export interface TarballContents {
  /** Sum of the regular files' sizes, in bytes. */
  readonly unpackedSize: number;
  readonly fileCount: number;
}

/** Measure a gzipped tarball. Raises when it is not gzip or a header is malformed. */
export function measureTarball(gzipped: Uint8Array): TarballContents {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzipped);
  } catch (err) {
    throw new Error(`tarball is not valid gzip: ${(err as Error).message}`, { cause: err });
  }

  let unpackedSize = 0;
  let fileCount = 0;
  let offset = 0;
  while (offset + BLOCK_SIZE <= tar.length && !isZeroBlock(tar, offset)) {
    const size = entrySize(tar, offset);
    if (REGULAR_FILE_TYPES.has(String.fromCharCode(tar[offset + TYPE_OFFSET] ?? 0))) {
      unpackedSize += size;
      fileCount += 1;
    }
    offset += BLOCK_SIZE + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  if (offset > tar.length) {
    throw new Error(`tarball is truncated: an entry runs to byte ${offset} of ${tar.length}`);
  }
  return { unpackedSize, fileCount };
}

function isZeroBlock(tar: Buffer, offset: number): boolean {
  return tar.subarray(offset, offset + BLOCK_SIZE).every((byte) => byte === 0);
}

/** The entry's data size: an octal ASCII field, NUL- or space-terminated. */
function entrySize(tar: Buffer, offset: number): number {
  const field = headerField(tar, offset + SIZE_OFFSET, SIZE_LENGTH).trim();
  if (!/^[0-7]+$/.test(field)) {
    const name = headerField(tar, offset, NAME_LENGTH);
    throw new Error(`tarball entry "${name}" has a malformed size field ${JSON.stringify(field)}`);
  }
  return Number.parseInt(field, 8);
}

/** A header text field, which ends at its first NUL or fills its full length. */
function headerField(tar: Buffer, start: number, length: number): string {
  const text = tar.toString('latin1', start, start + length);
  const end = text.indexOf('\0');
  return end === -1 ? text : text.slice(0, end);
}
