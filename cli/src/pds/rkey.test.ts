import { describe, expect, it } from 'vitest';

// The site keeps its own copy of the vendored algorithm (see rkey.ts header).
// Importing it here pins both copies to the same vectors so they cannot drift apart.
import * as site from '../../../../src/lib/atproto.ts';

import { documentUri, extractDate, postPath, tidFromPath } from './rkey.js';

/**
 * Pinned vectors. These are on-the-wire identity: changing any output orphans the
 * corresponding PDS record and breaks published link tags. Never update them for an
 * existing path.
 */
const VECTORS: Array<[path: string, tid: string]> = [
  ['/posts/hello-world/', '7m7eb4ia7xeuo'],
  ['/posts/building-with-astro/', '5zku6kcmbo4tc'],
  // Dated path exercises the timestamp branch of the TID layout.
  ['/blog/2026/06/05/how-to/', '3mnitfsis22os'],
  // Trailing slash is significant — this must differ from the first vector.
  ['/posts/hello-world', '3wkwuregyshfn'],
];

describe('tidFromPath', () => {
  it.each(VECTORS)('derives the pinned rkey for %s', (path, tid) => {
    expect(tidFromPath(path)).toBe(tid);
  });

  it('always emits 13 base32-sortable chars', () => {
    for (const [path] of VECTORS) {
      expect(tidFromPath(path)).toMatch(/^[2-7a-z]{13}$/);
    }
  });

  it('rejects an effectively empty path', () => {
    expect(() => tidFromPath('///')).toThrow(/empty path/);
  });

  it('extracts dates in both slash and dash forms', () => {
    expect(extractDate('/blog/2026/06/05/x')).toBe('2026-06-05');
    expect(extractDate('/blog/2026-06-05-x')).toBe('2026-06-05');
    expect(extractDate('/posts/hello-world/')).toBeUndefined();
  });
});

describe('postPath / documentUri', () => {
  it('builds the canonical trailing-slash post path', () => {
    expect(postPath('hello-world')).toBe('/posts/hello-world/');
  });

  it('builds the document AT-URI from did + slug', () => {
    expect(documentUri('did:plc:abc', 'hello-world')).toBe(
      'at://did:plc:abc/site.standard.document/7m7eb4ia7xeuo',
    );
  });
});

describe('site copy (src/lib/atproto.ts)', () => {
  it('matches the ops copy on every vector', () => {
    for (const [path, tid] of VECTORS) {
      expect(site.tidFromPath(path)).toBe(tid);
    }
  });

  it('matches postPath and documentUri', () => {
    expect(site.postPath('hello-world')).toBe(postPath('hello-world'));
    expect(site.documentUri('did:plc:abc', 'x')).toBe(documentUri('did:plc:abc', 'x'));
  });
});
