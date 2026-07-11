import { describe, expect, it } from 'vitest';

import { documentUri, extractDate, postPath, tidFromPath } from './rkey.js';

/**
 * The `blogwright/rkey` subpath is a published contract; since task 08 it is a
 * re-export of blogwright-pds. These tests pin the re-exported surface — the
 * exhaustive on-the-wire vectors live in packages/pds/src/rkey.test.ts.
 */
describe('blogwright/rkey re-export', () => {
  it('exposes the rkey surface consuming sites import', () => {
    expect(postPath('hello-world')).toBe('/posts/hello-world/');
    expect(extractDate('/blog/2026/06/05/how-to/')).toBe('2026-06-05');
    expect(documentUri('did:plc:me', 'hello-world')).toBe(
      `at://did:plc:me/site.standard.document/${tidFromPath('/posts/hello-world/')}`,
    );
  });

  it('derives the same pinned rkey as the implementation package', () => {
    expect(tidFromPath('/posts/hello-world/')).toBe('7m7eb4ia7xeuo');
  });

  it('still rejects an empty path', () => {
    expect(() => tidFromPath('///')).toThrow(/empty path/);
  });
});
