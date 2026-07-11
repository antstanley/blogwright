import type { SeoConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { resolveSeo } from './seo.js';

function ctx(env: string, preview: boolean, seo: SeoConfig): OpsContext {
  return { env, preview, config: { seo } } as unknown as OpsContext;
}

const AUTO: SeoConfig = { robots: 'auto', sitemap: 'auto' };

describe('resolveSeo', () => {
  it('production auto: indexable robots + sitemap referencing the origin', () => {
    const r = resolveSeo(ctx('production', false, AUTO), 'https://example.com');
    expect(r.robots).toContain('Allow: /');
    expect(r.robots).not.toContain('Disallow: /');
    expect(r.robots).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(r.sitemapBaseUrl).toBe('https://example.com');
  });

  it('non-production auto: blocks all crawlers and emits no sitemap', () => {
    const r = resolveSeo(ctx('staging', false, AUTO), 'https://x.cloudfront.net');
    expect(r.robots).toContain('Disallow: /');
    expect(r.robots).not.toContain('Allow: /');
    expect(r.sitemapBaseUrl).toBeUndefined();
  });

  it('preview auto: treated as non-production (blocked, no sitemap)', () => {
    const r = resolveSeo(ctx('preview', true, AUTO), 'https://pr-2.preview.example.com');
    expect(r.robots).toContain('Disallow: /');
    expect(r.sitemapBaseUrl).toBeUndefined();
  });

  it('force index in a non-production env', () => {
    const r = resolveSeo(ctx('staging', false, { robots: 'index', sitemap: 'off' }), 'https://s');
    expect(r.robots).toContain('Allow: /');
    expect(r.robots).not.toContain('Sitemap:'); // sitemap off → no directive
    expect(r.sitemapBaseUrl).toBeUndefined();
  });

  it('force noindex in production', () => {
    const r = resolveSeo(
      ctx('production', false, { robots: 'noindex', sitemap: 'auto' }),
      'https://d',
    );
    expect(r.robots).toContain('Disallow: /');
    // sitemap still generated (auto+prod), just not referenced by the blocked robots.txt.
    expect(r.sitemapBaseUrl).toBe('https://d');
  });

  it('robots off: leaves the build output (no robots body emitted)', () => {
    const r = resolveSeo(ctx('production', false, { robots: 'off', sitemap: 'off' }), 'https://d');
    expect(r.robots).toBeUndefined();
  });

  it('explicit robotsContent overrides the computed body', () => {
    const seo: SeoConfig = { robots: 'auto', sitemap: 'off', robotsContent: 'User-agent: x\n' };
    const r = resolveSeo(ctx('production', false, seo), 'https://d');
    expect(r.robots).toBe('User-agent: x\n');
  });

  it('sitemap on: forces a sitemap even outside production', () => {
    const r = resolveSeo(ctx('staging', false, { robots: 'auto', sitemap: 'on' }), 'https://s');
    expect(r.sitemapBaseUrl).toBe('https://s');
  });

  it('normalises a trailing slash on the base URL', () => {
    const r = resolveSeo(ctx('production', false, AUTO), 'https://example.com/');
    expect(r.sitemapBaseUrl).toBe('https://example.com');
    expect(r.robots).toContain('Sitemap: https://example.com/sitemap.xml');
  });
});
