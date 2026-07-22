import type { CollectionEntry } from 'astro:content';

/**
 * Serialize a docs entry back to a standalone Markdown document: YAML
 * frontmatter followed by the page's raw Markdown body. Used to serve
 * `/<slug>.md` for LLM scrapers and plain-text readers.
 */
export function docToMarkdown(doc: CollectionEntry<'docs'>): string {
  const { title, description } = doc.data;

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    '---',
  ].join('\n');

  const body = (doc.body ?? '').trim();

  return `${frontmatter}\n\n${body}\n`;
}
