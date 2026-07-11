import { join } from 'node:path';

import { createMemoryFileSystem, createNodeFileSystem } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from './test-support.js';
import { listPublishablePosts, parseFrontmatter } from './content.js';

const ROOT = '/repo';
const CONTENT_DIR = `${ROOT}/src/content/blog`;

function postFile(frontmatter: string, body = 'Hello.'): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe('parseFrontmatter', () => {
  it('parses bare, single-quoted, and double-quoted scalars', () => {
    const fields = parseFrontmatter(
      `---\ntitle: 'It''s a title'\ndescription: "with \\"quotes\\""\npubDate: 2026-06-28\n---\n`,
      'x.md',
    );
    expect(fields.title).toBe("It's a title");
    expect(fields.description).toBe('with "quotes"');
    expect(fields.pubDate).toBe('2026-06-28');
  });

  it('rejects a file without a frontmatter block', () => {
    expect(() => parseFrontmatter('no frontmatter', 'x.md')).toThrow(/frontmatter/);
  });

  it('rejects non key-value lines (nested YAML is unsupported by design)', () => {
    expect(() => parseFrontmatter('---\ntags:\n  - a\n---\n', 'x.md')).toThrow(/unsupported/);
  });
});

describe('listPublishablePosts', () => {
  it('enumerates posts with slugs matching the Astro glob-loader ids', async () => {
    const fs = createMemoryFileSystem({
      [`${CONTENT_DIR}/hello-world.md`]: postFile(
        `title: 'Hello world'\ndescription: 'First post.'\npubDate: 2026-06-20`,
      ),
      [`${CONTENT_DIR}/building-with-astro.md`]: postFile(
        `title: 'Building this site with Astro'\ndescription: 'Notes.'\npubDate: 2026-06-28`,
      ),
      [`${CONTENT_DIR}/notes.txt`]: 'not a post',
    });
    const posts = await listPublishablePosts(fs, ROOT);
    expect(posts.map((p) => p.slug)).toEqual(['building-with-astro', 'hello-world']);
    expect(posts[1]?.title).toBe('Hello world');
    expect(posts[1]?.pubDate.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });

  it('skips drafts, matching [...slug].astro getStaticPaths', async () => {
    const fs = createMemoryFileSystem({
      [`${CONTENT_DIR}/wip.md`]: postFile(
        `title: 'WIP'\ndescription: 'x'\npubDate: 2026-06-20\ndraft: true`,
      ),
      [`${CONTENT_DIR}/live.md`]: postFile(
        `title: 'Live'\ndescription: 'x'\npubDate: 2026-06-20\ndraft: false`,
      ),
    });
    const posts = await listPublishablePosts(fs, ROOT);
    expect(posts.map((p) => p.slug)).toEqual(['live']);
  });

  it('includes nested files with directory-qualified slugs', async () => {
    const fs = createMemoryFileSystem({
      [`${CONTENT_DIR}/series/part-one.md`]: postFile(
        `title: 'One'\ndescription: 'x'\npubDate: 2026-06-20`,
      ),
    });
    const posts = await listPublishablePosts(fs, ROOT);
    expect(posts.map((p) => p.slug)).toEqual(['series/part-one']);
  });

  it('includes .mdx posts, strips a trailing /index, and honours a frontmatter slug', async () => {
    const fs = createMemoryFileSystem({
      [`${CONTENT_DIR}/series/part-one/index.md`]: postFile(
        `title: 'Part one'\ndescription: 'd'\npubDate: 2026-06-20`,
      ),
      [`${CONTENT_DIR}/component-post.mdx`]: postFile(
        `title: 'MDX'\ndescription: 'd'\npubDate: 2026-06-21`,
      ),
      [`${CONTENT_DIR}/renamed.md`]: postFile(
        `title: 'Renamed'\ndescription: 'd'\npubDate: 2026-06-22\nslug: my-custom-slug`,
      ),
    });

    const slugs = (await listPublishablePosts(fs, ROOT)).map((p) => p.slug);

    expect(slugs).toEqual(['component-post', 'my-custom-slug', 'series/part-one']);
  });

  it('errors clearly on missing required fields and bad dates', async () => {
    const missingField = createMemoryFileSystem({
      [`${CONTENT_DIR}/bad.md`]: postFile(`title: 'No description'\npubDate: 2026-06-20`),
    });
    await expect(listPublishablePosts(missingField, ROOT)).rejects.toThrow(/bad\.md.*description/);

    const badDate = createMemoryFileSystem({
      [`${CONTENT_DIR}/bad-date.md`]: postFile(`title: 'x'\ndescription: 'x'\npubDate: not-a-date`),
    });
    await expect(listPublishablePosts(badDate, ROOT)).rejects.toThrow(/invalid pubDate/);
  });

  it('errors when the content directory does not exist', async () => {
    const fs = createMemoryFileSystem({ [`${ROOT}/readme.md`]: 'no content collection' });
    await expect(listPublishablePosts(fs, ROOT)).rejects.toThrow(/not found/);
  });

  it('enumerates a real directory tree through the node adapter', async () => {
    const root = await makeTempDir('pds-content');
    try {
      const fs = createNodeFileSystem();
      await fs.writeText(
        join(root, 'src/content/blog/series/part-one.md'),
        postFile(`title: 'One'\ndescription: 'x'\npubDate: 2026-06-20`),
      );
      const posts = await listPublishablePosts(fs, root);
      expect(posts.map((p) => p.slug)).toEqual(['series/part-one']);
    } finally {
      await removeTempDir(root);
    }
  });
});
