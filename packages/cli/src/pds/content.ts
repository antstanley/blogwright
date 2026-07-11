import { join } from 'node:path';

import type { FileSystem } from 'blogwright-core';

/** A publishable blog post, as enumerated from the Astro content collection. */
export interface PostMeta {
  /** Content-collection id: the file path under src/content/blog minus `.md`. */
  slug: string;
  title: string;
  description: string;
  pubDate: Date;
}

/** Default content-collection directory; overridable via `config.paths.content`. */
const DEFAULT_CONTENT_DIR = 'src/content/blog';
const REQUIRED_FIELDS = ['title', 'description', 'pubDate'] as const;

/**
 * Parse the flat frontmatter subset used by src/content.config.ts: scalar
 * `key: value` lines where value is a bare token, a quoted string, a date, or a
 * boolean. Deliberately not a YAML parser — the schema is flat by construction.
 */
export function parseFrontmatter(source: string, file: string): Record<string, string> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) throw new Error(`${file}: no frontmatter block`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) throw new Error(`${file}: unsupported frontmatter line "${line}"`);
    const key = kv[1] as string;
    let value = (kv[2] ?? '').trim();
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replaceAll("''", "'");
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replaceAll('\\"', '"');
    }
    fields[key] = value;
  }
  return fields;
}

/**
 * Enumerate publishable posts from the content collection, mirroring the Astro
 * build: slug = file path minus `.md` (the glob-loader id), drafts excluded.
 */
export async function listPublishablePosts(
  fs: FileSystem,
  repoRoot: string,
  contentDir: string = DEFAULT_CONTENT_DIR,
): Promise<PostMeta[]> {
  const dir = join(repoRoot, contentDir);
  const posts: PostMeta[] = [];
  for (const file of await fs.listFiles(dir)) {
    const rel = file.replaceAll('\\', '/');
    if (!rel.endsWith('.md')) continue;
    const slug = rel.slice(0, -'.md'.length);
    const fields = parseFrontmatter(await fs.readText(join(dir, file)), rel);
    if (fields.draft === 'true') continue;
    for (const key of REQUIRED_FIELDS) {
      if (!fields[key]) throw new Error(`${rel}: frontmatter is missing "${key}"`);
    }
    const pubDate = new Date(fields.pubDate as string);
    if (Number.isNaN(pubDate.getTime())) {
      throw new Error(`${rel}: invalid pubDate "${fields.pubDate}"`);
    }
    posts.push({
      slug,
      title: fields.title as string,
      description: fields.description as string,
      pubDate,
    });
  }
  return posts.sort((a, b) => a.slug.localeCompare(b.slug));
}
