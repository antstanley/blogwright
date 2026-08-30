import { parseConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  type AnalyticsConfig,
  DEFAULT_DASHBOARD_PORT,
  resolveAnalyticsConfig,
  validateAnalyticsConfig,
} from './config.js';

/** The site identity the environment-carrying defaults are derived from. */
const SITE = { env: 'production', siteName: 'example' };

/**
 * A plugin context carrying a validated `analytics` block, built the way the
 * host builds one: `validateAnalyticsConfig` over the raw block, beside the
 * site config `parseConfig` returns. `resolveAnalyticsConfig` reads only these
 * three members, so a `Pick` of them is a whole context as far as it is
 * concerned.
 */
function contextFor(site: { env: string; siteName: string }, raw: unknown) {
  return {
    env: site.env,
    config: parseConfig(JSON.stringify({ siteName: site.siteName })),
    pluginConfig: validateAnalyticsConfig(raw),
  };
}

/** The resolved config a raw block yields for {@link SITE}. */
function resolveFor(raw: unknown) {
  return resolveAnalyticsConfig(contextFor(SITE, raw));
}

describe('validateAnalyticsConfig', () => {
  it('accepts an empty block, applying every default that needs no environment', () => {
    const block = validateAnalyticsConfig({});
    expect(block.namespace).toBe('web');
    expect(block.table).toBe('page_views');
    expect(block.bots).toBe('flag');
    expect(block.dashboard.port).toBe(4317);
  });

  it('treats an absent block as an empty one', () => {
    const block = validateAnalyticsConfig(undefined);
    expect(block.namespace).toBe('web');
    expect(block.table).toBe('page_views');
    expect(block.bots).toBe('flag');
    expect(block.dashboard.port).toBe(4317);
  });

  it('accepts a block naming every setting, returning each unchanged', () => {
    const raw = {
      tableBucket: 'prod-example-analytics',
      namespace: 'web_2',
      table: 'page_views',
      bots: 'filter',
      saltSecretName: 'example/production/analytics-salt',
      dashboard: { port: 8080 },
    };
    const block = validateAnalyticsConfig(raw);
    expect(block).toMatchObject({
      namespace: 'web_2',
      table: 'page_views',
      bots: 'filter',
      dashboard: { port: 8080 },
    });
    // The two environment-carrying settings are sealed on the validated block
    // and read back only through the resolver.
    expect(resolveFor(raw)).toEqual(raw);
  });

  it('rejects a block that is not an object', () => {
    expect(() => validateAnalyticsConfig('nope')).toThrow(
      'config.analytics must be an object, got "nope"',
    );
  });

  it('rejects an unknown key inside the block', () => {
    expect(() => validateAnalyticsConfig({ tableBuckets: 'x' })).toThrow(
      'config.analytics.tableBuckets is not a known setting - allowed keys are tableBucket, namespace, table, bots, saltSecretName, dashboard',
    );
  });

  it('rejects an unknown key inside the dashboard sub-block', () => {
    expect(() => validateAnalyticsConfig({ dashboard: { host: 'localhost' } })).toThrow(
      'config.analytics.dashboard.host is not a known setting - allowed keys are port',
    );
  });

  it('rejects a dashboard that is not an object', () => {
    expect(() => validateAnalyticsConfig({ dashboard: 4317 })).toThrow(
      'config.analytics.dashboard must be an object, got 4317',
    );
  });
});

describe('the environment-carrying settings are sealed on the validated block', () => {
  // These two cases are the reason the split between the validated block and
  // the resolved config exists at all. A downstream node holding
  // `ctx.pluginConfig` must not be able to reach a bucket or salt name that
  // was defaulted without the environment - the collision the module comment
  // describes, where `analytics destroy --yes` in staging deletes
  // production's table bucket. The `@ts-expect-error` lines are the check:
  // each fails `pnpm typecheck` with TS2578 if the field ever becomes
  // readable, so the seal cannot be opened without a gate saying so.

  it('does not let a reader reach tableBucket off ctx.pluginConfig', () => {
    const ctx = contextFor(SITE, {});
    // @ts-expect-error TS2339 - `tableBucket` is not on `AnalyticsConfig`, so
    // `ctx.pluginConfig.tableBucket ?? <env-less fallback>` cannot be written.
    void ctx.pluginConfig.tableBucket;
    expect(resolveAnalyticsConfig(ctx).tableBucket).toBe('production-example-analytics');
  });

  it('does not let a reader reach saltSecretName off ctx.pluginConfig', () => {
    const ctx = contextFor(SITE, {});
    // @ts-expect-error TS2339 - same seal, for the salt the visitor_key hash uses.
    void ctx.pluginConfig.saltSecretName;
    expect(resolveAnalyticsConfig(ctx).saltSecretName).toBe('example/production/analytics-salt');
  });
});

describe('validateAnalyticsConfig tableBucket boundary', () => {
  it('accepts a tableBucket of 3 characters', () => {
    expect(resolveFor({ tableBucket: 'abc' }).tableBucket).toBe('abc');
  });

  it('accepts a tableBucket of 63 characters', () => {
    const name = 'a'.repeat(63);
    expect(resolveFor({ tableBucket: name }).tableBucket).toBe(name);
  });

  it('rejects a tableBucket of 2 characters', () => {
    expect(() => validateAnalyticsConfig({ tableBucket: 'ab' })).toThrow(
      'config.analytics.tableBucket must be 3..63 lowercase alphanumeric/dash characters, got "ab"',
    );
  });

  it('rejects a tableBucket of 64 characters', () => {
    const name = 'a'.repeat(64);
    expect(() => validateAnalyticsConfig({ tableBucket: name })).toThrow(
      `config.analytics.tableBucket must be 3..63 lowercase alphanumeric/dash characters, got "${name}"`,
    );
  });

  it('rejects a tableBucket outside ^[0-9a-z-]$ at a valid length', () => {
    expect(() => validateAnalyticsConfig({ tableBucket: 'Prod_Example' })).toThrow(
      'got "Prod_Example"',
    );
  });
});

describe('validateAnalyticsConfig dashboard.port boundary', () => {
  it('accepts a dashboard.port of 1024', () => {
    expect(validateAnalyticsConfig({ dashboard: { port: 1024 } }).dashboard.port).toBe(1024);
  });

  it('accepts a dashboard.port of 65535', () => {
    expect(validateAnalyticsConfig({ dashboard: { port: 65535 } }).dashboard.port).toBe(65535);
  });

  it('rejects a dashboard.port of 1023', () => {
    expect(() => validateAnalyticsConfig({ dashboard: { port: 1023 } })).toThrow(
      'config.analytics.dashboard.port must be in 1024..65535, got 1023',
    );
  });

  it('rejects a dashboard.port of 65536', () => {
    expect(() => validateAnalyticsConfig({ dashboard: { port: 65536 } })).toThrow(
      'config.analytics.dashboard.port must be in 1024..65535, got 65536',
    );
  });

  it('rejects a fractional dashboard.port', () => {
    expect(() => validateAnalyticsConfig({ dashboard: { port: 4317.5 } })).toThrow(
      'config.analytics.dashboard.port must be in 1024..65535, got 4317.5',
    );
  });

  it('rejects a dashboard.port that is not a number', () => {
    expect(() => validateAnalyticsConfig({ dashboard: { port: '4317' } })).toThrow(
      'config.analytics.dashboard.port must be in 1024..65535, got "4317"',
    );
  });
});

describe('validateAnalyticsConfig negative space', () => {
  it('rejects a namespace outside ^[a-z0-9_]+$', () => {
    expect(() => validateAnalyticsConfig({ namespace: 'Web-Traffic' })).toThrow(
      'config.analytics.namespace must be lowercase alphanumeric/underscores, got "Web-Traffic"',
    );
  });

  it('rejects an empty namespace', () => {
    expect(() => validateAnalyticsConfig({ namespace: '' })).toThrow(
      'config.analytics.namespace must be lowercase alphanumeric/underscores, got ""',
    );
  });

  it('rejects a table outside ^[a-z0-9_]+$', () => {
    expect(() => validateAnalyticsConfig({ table: 'page-views' })).toThrow(
      'config.analytics.table must be lowercase alphanumeric/underscores, got "page-views"',
    );
  });

  it('rejects a bots value outside the union', () => {
    expect(() => validateAnalyticsConfig({ bots: 'exclude' })).toThrow(
      'config.analytics.bots must be one of flag, filter, got "exclude"',
    );
  });

  it('accepts a saltSecretName using the pds secret-name character class', () => {
    // Every character the class allows beyond the plain word ones, in a name
    // deliberately unlike `SITE`'s derived default - so the assertion also
    // fails if the override is ignored and the default is returned instead.
    const name = 'shared_salts/example-v2.1+rotation=1@blogwright';
    expect(resolveFor({ saltSecretName: name }).saltSecretName).toBe(name);
  });

  it('rejects a saltSecretName with invalid characters', () => {
    expect(() => validateAnalyticsConfig({ saltSecretName: 'analytics salt!' })).toThrow(
      'config.analytics.saltSecretName has invalid characters: "analytics salt!"',
    );
  });
});

describe('resolveAnalyticsConfig', () => {
  it('yields every default for a block of {}', () => {
    expect(resolveFor({})).toEqual({
      tableBucket: 'production-example-analytics',
      namespace: 'web',
      table: 'page_views',
      bots: 'flag',
      saltSecretName: 'example/production/analytics-salt',
      dashboard: { port: 4317 },
    });
  });

  it('derives a different table bucket and a different salt secret for each environment', () => {
    const staging = resolveAnalyticsConfig(contextFor({ env: 'staging', siteName: 'example' }, {}));
    const production = resolveAnalyticsConfig(
      contextFor({ env: 'production', siteName: 'example' }, {}),
    );

    // The consequence this pins: share a bucket and `blogwright analytics
    // destroy --yes` in staging deletes production's table bucket; share a
    // salt and both environments hash `visitor_key` the same way.
    expect(staging.tableBucket).not.toBe(production.tableBucket);
    expect(staging.saltSecretName).not.toBe(production.saltSecretName);
    expect(staging.tableBucket).toBe('staging-example-analytics');
    expect(staging.saltSecretName).toBe('example/staging/analytics-salt');
  });

  it('keeps explicit settings over the derived and literal defaults', () => {
    const raw = {
      tableBucket: 'shared-analytics',
      namespace: 'edge',
      table: 'hits',
      bots: 'filter',
      saltSecretName: 'example/salt',
      dashboard: { port: 9000 },
    };
    expect(resolveFor(raw)).toEqual(raw);
  });

  it('applies the dashboard port default when the dashboard sub-block is empty', () => {
    expect(resolveFor({ dashboard: {} }).dashboard.port).toBe(4317);
  });

  it('rejects a derived table bucket of 64 characters', () => {
    // 'staging-' (8) + siteName + '-analytics' (10): 46 characters is one over.
    const siteName = 'a'.repeat(46);
    expect(() => resolveAnalyticsConfig(contextFor({ env: 'staging', siteName }, {}))).toThrow(
      `derived analytics table bucket "staging-${siteName}-analytics" exceeds S3's 63-char limit; shorten env or siteName`,
    );
  });

  it('accepts a derived table bucket of exactly 63 characters', () => {
    const siteName = 'a'.repeat(45);
    const resolved = resolveAnalyticsConfig(contextFor({ env: 'staging', siteName }, {}));
    expect(resolved.tableBucket).toHaveLength(63);
  });

  it('reads the environment and site name off the context it is given', () => {
    // The one home for the site identity: nothing but `ctx.env` and
    // `ctx.config.siteName` feeds the two derivations, so a call site cannot
    // pass an environment other than the one it is running in.
    const resolved = resolveAnalyticsConfig(contextFor({ env: 'preview', siteName: 'other' }, {}));
    expect(resolved.tableBucket).toBe('preview-other-analytics');
    expect(resolved.saltSecretName).toBe('other/preview/analytics-salt');
  });

  it('rejects a block that never went through validateAnalyticsConfig', () => {
    // A raw `{}` on `ctx.pluginConfig`: no sealed overrides, and none of the
    // four literal defaults either. The cast is the whole point - `TConfig` is
    // erased where a host fills `pluginConfig` (the CLI dispatches over
    // `Plugin<unknown>`), and this function is exported, so an unvalidated
    // block reaches it with the compiler none the wiser. Without the check the
    // first read raises `TypeError: Cannot read properties of undefined
    // (reading 'tableBucket')`, naming an internal field and no fix; the
    // message names the function that must run first instead. It cannot
    // recover: the literal defaults are missing too, so a fabricated block
    // would carry `undefined` for fields typed as total.
    const ctx = {
      env: 'staging',
      config: parseConfig(JSON.stringify({ siteName: 'example' })),
      pluginConfig: {} as AnalyticsConfig,
    };
    expect(() => resolveAnalyticsConfig(ctx)).toThrow(
      'analytics config was not validated: ctx.pluginConfig must come from validateAnalyticsConfig, which applies the defaults this resolver reads',
    );
  });
});

describe('DEFAULT_DASHBOARD_PORT', () => {
  it('is the 4317 the dashboard server binds', () => {
    // Exported so the dashboard server imports this number instead of
    // restating it. Pinned here because the two must not drift apart.
    expect(DEFAULT_DASHBOARD_PORT).toBe(4317);
  });
});

describe("core's parseConfig and an analytics block", () => {
  const text = '{ "siteName": "example", "analytics": { "bots": "filter", "namespace": "web" } }';

  it('accepts a config carrying an analytics block when the plugin is not loaded', () => {
    expect(() => parseConfig(text)).not.toThrow();
  });

  it('leaves the analytics block on the parsed config untouched', () => {
    // `OpsConfig` has no index signature - by design, so no caller reads a
    // plugin's key off it - so reading the surviving block back takes a cast.
    // That the block survives unvalidated is the whole assertion: core merges
    // it through and never looks inside it.
    const parsed = parseConfig(text) as unknown as Record<string, unknown>;
    expect(parsed['analytics']).toEqual({ bots: 'filter', namespace: 'web' });
  });
});
