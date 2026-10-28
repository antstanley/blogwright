import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { measureTarball } from './tarball.js';
import { tarball, tarFile, tarHeader } from './test-support.js';

describe('measureTarball', () => {
  it('sums the sizes of regular files', () => {
    const measured = measureTarball(
      tarball([tarFile('package/a.js', 'x'.repeat(700)), tarFile('package/b.js', 'y')]),
    );
    expect(measured).toEqual({ unpackedSize: 701, fileCount: 2 });
  });

  it('counts a file whose size is an exact multiple of the block size', () => {
    const measured = measureTarball(
      tarball([tarFile('package/a.js', 'x'.repeat(512)), tarFile('package/b.js', 'yy')]),
    );
    expect(measured).toEqual({ unpackedSize: 514, fileCount: 2 });
  });

  it('skips directories and pax headers but steps over their data', () => {
    const measured = measureTarball(
      tarball([
        { name: 'package/', type: '5', content: '' },
        { name: 'PaxHeader', type: 'x', content: '30 path=package/a-long-name.js\n' },
        tarFile('package/a-long-name.js', 'abc'),
      ]),
    );
    expect(measured).toEqual({ unpackedSize: 3, fileCount: 1 });
  });

  it('measures an empty archive as zero', () => {
    expect(measureTarball(tarball([]))).toEqual({ unpackedSize: 0, fileCount: 0 });
  });

  it('rejects data that is not gzip', () => {
    expect(() => measureTarball(Buffer.from('not a tarball'))).toThrow(/not valid gzip/);
  });

  it('rejects an entry whose size field is not octal', () => {
    const broken = tarHeader(tarFile('package/a.js', ''));
    broken.write('zzzzzzzzzzz\0', 124, 'latin1');
    expect(() => measureTarball(gzipSync(Buffer.concat([broken, Buffer.alloc(1024)])))).toThrow(
      /"package\/a.js" has a malformed size field/,
    );
  });

  it('rejects an archive cut off inside an entry', () => {
    const truncated = tarHeader(tarFile('package/a.js', 'x'.repeat(2000)));
    expect(() => measureTarball(gzipSync(truncated))).toThrow(/truncated/);
  });
});
