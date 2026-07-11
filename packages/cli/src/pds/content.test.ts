import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listPublishablePosts, parseFrontmatter } from './content.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pds-content-'));
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function post(name: string, frontmatter: string, body = 'Hello.'): Promise<void> {
  await writeFile(join(root, 'src/content/blog', name), `---\n${frontmatter}\n---\n\n${body}\n`);
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
    await post(
      'hello-world.md',
      `title: 'Hello world'\ndescription: 'First post.'\npubDate: 2026-06-20`,
    );
    await post(
      'building-with-astro.md',
      `title: 'Building this site with Astro'\ndescription: 'Notes.'\npubDate: 2026-06-28`,
    );
    const posts = await listPublishablePosts(root);
    expect(posts.map((p) => p.slug)).toEqual(['building-with-astro', 'hello-world']);
    expect(posts[1]?.title).toBe('Hello world');
    expect(posts[1]?.pubDate.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });

  it('skips drafts, matching [...slug].astro getStaticPaths', async () => {
    await post('wip.md', `title: 'WIP'\ndescription: 'x'\npubDate: 2026-06-20\ndraft: true`);
    await post('live.md', `title: 'Live'\ndescription: 'x'\npubDate: 2026-06-20\ndraft: false`);
    const posts = await listPublishablePosts(root);
    expect(posts.map((p) => p.slug)).toEqual(['live']);
  });

  it('includes nested files with directory-qualified slugs', async () => {
    await mkdir(join(root, 'src/content/blog/series'), { recursive: true });
    await post('series/part-one.md', `title: 'One'\ndescription: 'x'\npubDate: 2026-06-20`);
    const posts = await listPublishablePosts(root);
    expect(posts.map((p) => p.slug)).toEqual(['series/part-one']);
  });

  it('errors clearly on missing required fields and bad dates', async () => {
    await post('bad.md', `title: 'No description'\npubDate: 2026-06-20`);
    await expect(listPublishablePosts(root)).rejects.toThrow(/bad\.md.*description/);
    await rm(join(root, 'src/content/blog/bad.md'));
    await post('bad-date.md', `title: 'x'\ndescription: 'x'\npubDate: not-a-date`);
    await expect(listPublishablePosts(root)).rejects.toThrow(/invalid pubDate/);
  });
});
