import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// https://llmstxt.org - a plain-text/markdown index that points LLMs at the
// machine-readable (Markdown) version of every docs page.

// Mirrors the sidebar groups in astro.config.mjs; pages list in sidebar order.
const GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: 'getting-started/', label: 'Getting started' },
  { prefix: 'guides/', label: 'Guides' },
  { prefix: 'examples/', label: 'Examples' },
  { prefix: 'plugins/', label: 'Plugins' },
  { prefix: 'reference/', label: 'Reference' },
];

export const GET: APIRoute = async ({ site }) => {
  const abs = (path: string) => (site ? new URL(path, site).href : path);
  const docs = await getCollection('docs');

  const lines: string[] = [];
  lines.push('# blogwright');
  lines.push('');
  lines.push(
    '> Deploy static sites, single-page apps and server-rendered apps to AWS with one ' +
      'CLI: S3 + CloudFront hosting, builds in a Lambda MicroVM, Lambda Web Functions ' +
      'for SSR, PR previews, GitHub-OIDC CI deploys, and plugins for traffic analytics ' +
      'and standard.site (AT Protocol) publishing. No CloudFormation, Terraform or CDK.',
  );
  lines.push('');
  lines.push(
    'Every documentation page is available as Markdown by appending `.md` to its ' +
      `URL path (e.g. ${abs('/reference/cli.md')}).`,
  );
  lines.push('');

  for (const group of GROUPS) {
    const entries = docs
      .filter((doc) => doc.id.startsWith(group.prefix))
      .sort((a, b) => (a.data.sidebar?.order ?? 99) - (b.data.sidebar?.order ?? 99));
    if (entries.length === 0) continue;
    lines.push(`## ${group.label}`);
    lines.push('');
    for (const doc of entries) {
      const desc = doc.data.description ? `: ${doc.data.description}` : '';
      lines.push(`- [${doc.data.title}](${abs(`/${doc.id}.md`)})${desc}`);
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
