import type { OpsContext } from './context.js';

/** Robots/sitemap directives handed to the build agent for a single deploy. */
export interface SeoDirectives {
  /** robots.txt body to publish; omitted means "leave the build's own robots.txt". */
  robots?: string;
  /** When set, the agent generates sitemap.xml from the built pages using this origin. */
  sitemapBaseUrl?: string;
}

function blockAllRobots(): string {
  return 'User-agent: *\nDisallow: /\n';
}

function indexRobots(sitemapUrl: string | undefined): string {
  let out = 'User-agent: *\nAllow: /\n';
  if (sitemapUrl) out += `\nSitemap: ${sitemapUrl}\n`;
  return out;
}

/**
 * Resolve robots.txt / sitemap.xml directives for a deploy from the environment + config.
 * `baseUrl` is the canonical origin the site is served from (e.g. https://example.com).
 * Defaults are environment-aware: production is indexable with a sitemap; every other
 * environment blocks crawlers and skips the sitemap — all overridable via config.seo.
 */
export function resolveSeo(ctx: OpsContext, baseUrl: string | undefined): SeoDirectives {
  const isProd = !ctx.preview && ctx.env === 'production';
  const seo = ctx.config.seo;

  const sitemapOn = seo.sitemap === 'on' || (seo.sitemap === 'auto' && isProd);
  const sitemapBaseUrl = sitemapOn && baseUrl ? baseUrl.replace(/\/+$/, '') : undefined;

  if (seo.robots === 'off') {
    return sitemapBaseUrl ? { sitemapBaseUrl } : {};
  }

  const content =
    seo.robotsContent ??
    (seo.robots === 'index' || (seo.robots === 'auto' && isProd)
      ? indexRobots(sitemapBaseUrl ? `${sitemapBaseUrl}/sitemap.xml` : undefined)
      : blockAllRobots());

  return sitemapBaseUrl ? { robots: content, sitemapBaseUrl } : { robots: content };
}
