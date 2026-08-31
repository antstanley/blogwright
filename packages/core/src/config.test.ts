import { describe, expect, it } from 'vitest';

import {
  deriveNames,
  parseConfig,
  parseConfigDocument,
  pluginBlock,
  stripJsonComments,
  stripTrailingCommas,
} from './config.js';

/** Wrap a config fragment with the required siteName. */
const withSite = (fragment: string): string =>
  fragment === '{}' ? '{ "siteName": "example" }' : `{ "siteName": "example", ${fragment.slice(1)}`;

describe('stripJsonComments', () => {
  it('removes line and block comments but keeps string contents', () => {
    const src = `{
      // a line comment
      "url": "http://x/y", /* trailing */
      "note": "a // b /* c"
    }`;
    const parsed = JSON.parse(stripJsonComments(src)) as { url: string; note: string };
    expect(parsed.url).toBe('http://x/y');
    expect(parsed.note).toBe('a // b /* c');
  });
});

describe('stripTrailingCommas', () => {
  it('drops commas before closing braces and brackets, across whitespace', () => {
    const src = '{ "a": [1, 2,], "b": { "c": 1, }, }';
    expect(JSON.parse(stripTrailingCommas(src))).toEqual({ a: [1, 2], b: { c: 1 } });
  });

  it('leaves commas inside strings alone', () => {
    const src = '{ "note": "a, }", "list": [1,] }';
    expect(JSON.parse(stripTrailingCommas(src))).toEqual({ note: 'a, }', list: [1] });
  });

  it('parseConfig accepts a config with comments and trailing commas together', () => {
    const cfg = parseConfig(`{
      "region": "us-east-1",
      "siteName": "example", // required
      "domain": "example.com",
    }`);
    expect(cfg.siteName).toBe('example');
    expect(cfg.domain).toBe('example.com');
  });
});

describe('parseConfig', () => {
  it('applies defaults and merges nested objects', () => {
    const cfg = parseConfig(withSite('{ "domain": "example.com", "microvm": { "memory": 8 } }'));
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.siteName).toBe('example');
    expect(cfg.domain).toBe('example.com');
    expect(cfg.microvm.memory).toBe(8);
    expect(cfg.microvm.idle.maxIdleDurationSeconds).toBe(300);
    expect(cfg.retention.microvmDays).toBe(365);
    expect(cfg.paths).toEqual({
      publicDir: 'public',
      content: 'src/content/blog',
      atprotoJson: 'src/data/atproto.json',
      app: '.',
      dist: 'dist',
    });
  });

  it('requires siteName', () => {
    expect(() => parseConfig('{}')).toThrow(/siteName is required/);
  });

  it('rejects invalid siteName', () => {
    expect(() => parseConfig('{ "siteName": "Bad Name" }')).toThrow(/siteName/);
  });

  it('merges paths overrides over defaults', () => {
    const cfg = parseConfig(withSite('{ "paths": { "content": "src/content/notes" } }'));
    expect(cfg.paths.content).toBe('src/content/notes');
    expect(cfg.paths.publicDir).toBe('public');
  });

  it('rejects out-of-range maxDurationSeconds', () => {
    expect(() => parseConfig(withSite('{ "microvm": { "maxDurationSeconds": 999999 } }'))).toThrow(
      /maxDuration/,
    );
  });

  it('rejects a memory value outside the supported MicroVM sizes', () => {
    expect(() => parseConfig(withSite('{ "microvm": { "memory": 3 } }'))).toThrow(/memory/);
  });

  it('leaves pds undefined when the section is absent', () => {
    expect(parseConfig(withSite('{}')).pds).toBeUndefined();
  });

  // The four pds cases that used to live here - defaulting `secretName`,
  // keeping explicit overrides, rejecting a blank `name`, rejecting a
  // non-https `handleResolver` - moved to `packages/pds/src/config.test.ts`
  // with the code they exercise. Core neither defaults nor judges a plugin's
  // block; what it owes that block is the pass-through the cases below pin.

  it('passes a plugin block core knows nothing about through byte-equal', () => {
    const cfg = parseConfig(withSite('{ "analytics": { "table": "events", "sample": 0.5 } }'));
    // `OpsConfig` declares no `analytics`, so the key is only reachable off
    // the parsed object at runtime - which is exactly the survival being
    // pinned. The index read is the test's, not a hole in the type.
    const seen = (cfg as unknown as Record<string, unknown>)['analytics'];
    expect(seen).toEqual({ table: 'events', sample: 0.5 });
    expect(JSON.stringify(seen)).toBe('{"table":"events","sample":0.5}');
  });

  it('parses a malformed plugin block without throwing, since core no longer judges one', () => {
    // Negative space: every one of these would be rejected by the owning
    // plugin's own `validateConfig`, and none of them is core's business.
    expect(() => parseConfig(withSite('{ "analytics": { "table": 42 } }'))).not.toThrow();
    expect(() => parseConfig(withSite('{ "analytics": "not an object" }'))).not.toThrow();
    expect(() => parseConfig(withSite('{ "analytics": null }'))).not.toThrow();
    expect(() => parseConfig(withSite('{ "pds": { "name": " " } }'))).not.toThrow();
    expect(() =>
      parseConfig(withSite('{ "pds": { "name": "x", "handleResolver": "http://resolver" } }')),
    ).not.toThrow();
    expect(() =>
      parseConfig(withSite('{ "pds": { "name": "x", "secretName": "has a space" } }')),
    ).not.toThrow();
  });

  it('round-trips a pds block exactly as written, including an absent secretName', () => {
    const cfg = parseConfig(
      withSite(
        '{ "pds": { "name": "Ant Stanley", "description": "d", "handleResolver": "https://resolver.example" } }',
      ),
    );
    // Byte-equal, not merely a superset: no `secretName` is added, so this
    // fails the moment core starts defaulting the block again.
    expect(cfg.pds).toEqual({
      name: 'Ant Stanley',
      description: 'd',
      handleResolver: 'https://resolver.example',
    });
    expect(Object.keys(cfg.pds ?? {})).toEqual(['name', 'description', 'handleResolver']);
    expect(cfg.pds?.secretName).toBeUndefined();
  });

  it('keeps an explicit secretName on the pds block untouched', () => {
    const cfg = parseConfig(withSite('{ "pds": { "name": "x", "secretName": "me/secret" } }'));
    expect(cfg.pds).toEqual({ name: 'x', secretName: 'me/secret' });
  });
});

describe('parseConfigDocument', () => {
  it('returns a config byte-identical to parseConfig, plus a raw document carrying an unknown top-level key', () => {
    const text = withSite('{ "domain": "example.com", "analytics": { "table": "events" } }');

    const { config, raw } = parseConfigDocument(text);

    expect(config).toEqual(parseConfig(text));
    expect(raw['siteName']).toBe('example');
    expect(raw['domain']).toBe('example.com');
    // `analytics` survives the `...raw` spread mergeConfig already does, so
    // it round-trips into `raw` too - `OpsConfig`'s *type* has no declared
    // property for it (a compile-time fact: `config[key]` is a `TS7053` for
    // an arbitrary string `key`), which is why `pluginBlock` reads it off
    // `raw`, never off `config`.
    expect(raw['analytics']).toEqual({ table: 'events' });
  });

  it('parseConfig keeps its existing signature as the config half of parseConfigDocument', () => {
    const text = withSite('{ "domain": "example.com" }');
    expect(parseConfig(text)).toEqual(parseConfigDocument(text).config);
  });
});

describe('pluginBlock', () => {
  it('reads a plugin key out of the raw document', () => {
    const { raw } = parseConfigDocument(withSite('{ "analytics": { "table": "events" } }'));
    expect(pluginBlock(raw, 'analytics')).toEqual({ table: 'events' });
  });

  it('returns undefined for a key the document does not carry', () => {
    const { raw } = parseConfigDocument(withSite('{}'));
    expect(pluginBlock(raw, 'analytics')).toBeUndefined();
  });
});

describe('deployment shape config', () => {
  it('defaults app/dist/spa/sourceInclude for a stock repo-root site', () => {
    const cfg = parseConfig(withSite('{}'));
    expect(cfg.paths.app).toBe('.');
    expect(cfg.paths.dist).toBe('dist');
    expect(cfg.spa).toBe(false);
    expect(cfg.sourceInclude).toEqual([]);
  });

  it('accepts a monorepo layout and SPA mode', () => {
    const cfg = parseConfig(
      withSite(
        '{ "spa": true, "paths": { "app": "web", "dist": "web/build" }, "sourceInclude": ["web/src/lib/pkg/"] }',
      ),
    );
    expect(cfg.paths.app).toBe('web');
    expect(cfg.paths.dist).toBe('web/build');
    expect(cfg.spa).toBe(true);
    expect(cfg.sourceInclude).toEqual(['web/src/lib/pkg/']);
  });

  it('rejects escaping or absolute app/dist/sourceInclude paths', () => {
    expect(() => parseConfig(withSite('{ "paths": { "app": "../up" } }'))).toThrow(/paths.app/);
    expect(() => parseConfig(withSite('{ "paths": { "dist": "/abs" } }'))).toThrow(/paths.dist/);
    expect(() => parseConfig(withSite('{ "sourceInclude": ["a/../b"] }'))).toThrow(/sourceInclude/);
  });
});

describe('deriveNames', () => {
  it('produces deterministic env-prefixed names', () => {
    const cfg = parseConfig(withSite('{}'));
    const names = deriveNames('staging', '123456789012', cfg);
    expect(names.bucket).toBe('staging-example-123456789012');
    expect(names.buildRole).toBe('staging-example-build-role');
    expect(names.execRole).toBe('staging-example-exec-role');
    expect(names.microvmImage).toBe('staging-example-builder');
    expect(names.microvmLogGroup).toBe('/aws/lambda/microvms/staging-example-builder');
    expect(names.cloudfrontLogGroup).toBe('/example/staging/cloudfront');
  });

  it('pins the GitHub OIDC deploy role name so no existing role is renamed', () => {
    // `<env>-<siteName>-gh` is the value `githubOidcRoleNode` derived privately
    // before this field existed (`packages/cli/src/nodes.ts`), and it is the
    // name `blogwright-pds` attaches its own inline policy to. A change here
    // silently orphans every deployed role.
    const cfg = parseConfig(withSite('{}'));
    expect(deriveNames('production', '123456789012', cfg).githubRole).toBe('production-example-gh');
    expect(deriveNames('staging', '123456789012', cfg).githubRole).toBe('staging-example-gh');
  });

  it('rejects an invalid environment name', () => {
    expect(() => deriveNames('Prod!', '1', parseConfig(withSite('{}')))).toThrow(/environment/);
  });

  it('rejects a derived bucket name over the 63-char S3 limit', () => {
    const cfg = parseConfig(`{ "siteName": "${'x'.repeat(50)}" }`);
    expect(() => deriveNames('production', '123456789012', cfg)).toThrow(/63-char/);
  });
});
