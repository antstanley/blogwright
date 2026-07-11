import { describe, expect, it } from 'vitest';

import { allTags, decodeEntities, encodeEntities, textTag } from './xml.js';

const SAMPLE = `<ListBucketResult>
  <Contents><Key>site/index.html</Key><Size>10</Size></Contents>
  <Contents><Key>site/a&amp;b.txt</Key><Size>20</Size></Contents>
  <IsTruncated>false</IsTruncated>
</ListBucketResult>`;

describe('xml helpers', () => {
  it('extracts the first tag value', () => {
    expect(textTag(SAMPLE, 'IsTruncated')).toBe('false');
  });

  it('extracts all repeated tags', () => {
    const contents = allTags(SAMPLE, 'Contents');
    expect(contents).toHaveLength(2);
    expect(textTag(contents[1]!, 'Key')).toBe('site/a&b.txt');
  });

  it('handles attributes on the opening tag', () => {
    expect(textTag('<Code xml:lang="en">NoSuchKey</Code>', 'Code')).toBe('NoSuchKey');
  });

  it('round-trips entities', () => {
    expect(decodeEntities(encodeEntities(`a&b<c>"d'`))).toBe(`a&b<c>"d'`);
  });
});
