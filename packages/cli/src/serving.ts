/**
 * What the environment serves and from where: the configured and recorded
 * serving modes (static or SSR), the guard that refuses to publish in a mode
 * the distribution is not serving, and the site's canonical origin. Shared by
 * the build-and-publish commands and the release commands.
 */

import type { OpsContext } from './context.js';

/**
 * Canonical origin the live site is served from: the custom domain if configured,
 * else the distribution's CloudFront domain. Used for robots.txt / sitemap.xml URLs.
 */
export function siteBaseUrl(ctx: OpsContext): string | undefined {
  if (ctx.domain) return `https://${ctx.domain}`;
  const cf = ctx.state.resources['cloudfront-distribution']?.domainName;
  return typeof cf === 'string' ? `https://${cf}` : undefined;
}

/** The serving mode the config asks for. */
export function configuredMode(ctx: OpsContext): 'static' | 'ssr' {
  return ctx.config.ssr ? 'ssr' : 'static';
}

/**
 * The serving mode the live distribution was left in, or undefined before the
 * first bootstrap. A distribution recorded without a mode was created before
 * SSR existed, so it is static - reading that as "unknown" would let the very
 * stacks the switch guard exists for through it.
 */
export function recordedMode(ctx: OpsContext): 'static' | 'ssr' | undefined {
  const distribution = ctx.state.resources['cloudfront-distribution'];
  if (typeof distribution?.id !== 'string') return undefined;
  return distribution.mode === 'ssr' ? 'ssr' : 'static';
}

/**
 * Refuse to publish in a mode the distribution is not serving. The config and
 * the stack disagree only between editing `ssr` and re-bootstrapping, and a
 * deploy in that gap publishes where nothing serves from - or, static over
 * SSR, deletes the `site/` assets the live revision still references.
 */
export function assertServingModeMatches(ctx: OpsContext): void {
  const recorded = recordedMode(ctx);
  const configured = configuredMode(ctx);
  if (recorded === undefined || recorded === configured) return;
  throw new Error(
    `"${ctx.env}" is configured for ${configured} serving but its distribution serves ` +
      `${recorded}. Run \`blogwright bootstrap ${ctx.env} --switch-mode\` first; nothing was ` +
      'built or published.',
  );
}
