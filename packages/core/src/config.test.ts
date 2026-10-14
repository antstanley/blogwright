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

describe('ssr config', () => {
  it('is absent by default, and every field defaults when the block is empty', () => {
    expect(parseConfig(withSite('{}')).ssr).toBeUndefined();
    const ssr = parseConfig(withSite('{ "ssr": {}, "paths": { "dist": "web/build" } }')).ssr;
    expect(ssr).toEqual({
      packageDir: 'web/build', // paths.dist
      entryPoint: 'index.js',
      staticPaths: [],
      cacheKeyHeaders: [],
      env: {},
      timeoutSeconds: 30,
      maxConcurrencyPerEnvironment: 64,
    });
  });

  it('rejects a non-object block and unknown keys inside it', () => {
    for (const block of ['null', '"ssr"', '[]', '42', 'true']) {
      expect(() => parseConfig(withSite(`{ "ssr": ${block} }`))).toThrow(/config\.ssr/);
    }
    expect(() => parseConfig(withSite('{ "ssr": { "entrPoint": "x.js" } }'))).toThrow(
      /unknown key "entrPoint"/,
    );
  });

  it('validates the entry point: non-empty, "/"-separated, relative, inside the package', () => {
    expect(
      parseConfig(withSite('{ "ssr": { "entryPoint": "server/lambda.mjs" } }')).ssr?.entryPoint,
    ).toBe('server/lambda.mjs');
    for (const bad of ['""', '"/abs.js"', '"../up.js"', '"a/../b.js"', '"a\\\\b.js"']) {
      expect(() => parseConfig(withSite(`{ "ssr": { "entryPoint": ${bad} } }`))).toThrow(
        /entryPoint/,
      );
    }
  });

  it('rejects escaping packageDir/staticDir and requires staticDir/staticPaths together', () => {
    expect(() => parseConfig(withSite('{ "ssr": { "packageDir": "../out" } }'))).toThrow(
      /ssr\.packageDir/,
    );
    expect(() => parseConfig(withSite('{ "ssr": { "staticDir": "/abs" } }'))).toThrow(
      /ssr\.staticDir/,
    );
    expect(() => parseConfig(withSite('{ "ssr": { "staticDir": "dist/client" } }'))).toThrow(
      /staticPaths is required/,
    );
    expect(() => parseConfig(withSite('{ "ssr": { "staticPaths": ["/_astro/*"] } }'))).toThrow(
      /staticDir is required/,
    );
    expect(() =>
      parseConfig(withSite('{ "ssr": { "staticPaths": ["_astro/*"], "staticDir": "d" } }')),
    ).toThrow(/must be a CloudFront path pattern beginning "\/"/);
    expect(
      parseConfig(
        withSite(
          '{ "ssr": { "staticDir": "dist/client", "staticPaths": ["/_astro/*", "/favicon.svg"] } }',
        ),
      ).ssr?.staticPaths,
    ).toEqual(['/_astro/*', '/favicon.svg']);
  });

  it('accepts cacheKeyHeaders tokens and rejects malformed, duplicate, denied and too many', () => {
    expect(
      parseConfig(withSite('{ "ssr": { "cacheKeyHeaders": ["Authorization", "X-Tenant"] } }')).ssr
        ?.cacheKeyHeaders,
    ).toEqual(['Authorization', 'X-Tenant']);
    expect(() => parseConfig(withSite('{ "ssr": { "cacheKeyHeaders": ["has space"] } }'))).toThrow(
      /RFC 7230 token/,
    );
    expect(() =>
      parseConfig(withSite('{ "ssr": { "cacheKeyHeaders": ["Authorization", "authorization"] } }')),
    ).toThrow(/more than once/);
    expect(() => parseConfig(withSite('{ "ssr": { "cacheKeyHeaders": ["Host"] } }'))).toThrow(
      /cannot list "Host"/,
    );
    expect(() =>
      parseConfig(withSite('{ "ssr": { "cacheKeyHeaders": ["Lambda-Web-Trace"] } }')),
    ).toThrow(/cannot list "Lambda-Web-Trace"/);
    const eleven = Array.from({ length: 11 }, (_, i) => `"X-H${i}"`).join(', ');
    expect(() => parseConfig(withSite(`{ "ssr": { "cacheKeyHeaders": [${eleven}] } }`))).toThrow(
      /at most 10/,
    );
    // Per-name boundary (confirmed against the live API): 128 characters pass,
    // 129 are refused.
    const atNameLimit = `"${'a'.repeat(128)}"`;
    expect(
      parseConfig(withSite(`{ "ssr": { "cacheKeyHeaders": [${atNameLimit}] } }`)).ssr
        ?.cacheKeyHeaders,
    ).toHaveLength(1);
    expect(() =>
      parseConfig(withSite(`{ "ssr": { "cacheKeyHeaders": ["${'a'.repeat(129)}"] } }`)),
    ).toThrow(/128-character header-name limit/);

    // Combined-length boundary (also confirmed live): a 1,023-character joined
    // list passes and 1,024 - the quota itself - is refused. Nine distinct
    // 101-character names plus one of 105 give 1,014 characters, joined by nine
    // commas to exactly 1,023.
    const nineNames = Array.from({ length: 9 }, (_, i) => `"${'a'.repeat(100)}${i}"`).join(', ');
    const total = (extra: number): string =>
      `{ "ssr": { "cacheKeyHeaders": [${nineNames}, "${'b'.repeat(extra)}"] } }`;
    expect(parseConfig(withSite(total(105))).ssr?.cacheKeyHeaders).toHaveLength(10);
    expect(() => parseConfig(withSite(total(106)))).toThrow(/1,?024-character cache-policy quota/);
  });

  it('accepts ssr.env keys and values, rejecting reserved keys and malformed ones', () => {
    expect(
      parseConfig(withSite('{ "ssr": { "env": { "ORIGIN": "https://example.com", "A1": "x" } } }'))
        .ssr?.env,
    ).toEqual({ ORIGIN: 'https://example.com', A1: 'x' });
    expect(() => parseConfig(withSite('{ "ssr": { "env": { "HAS-DASH": "x" } } }'))).toThrow(
      /must match/,
    );
    expect(() => parseConfig(withSite('{ "ssr": { "env": { "EMPTY": "" } } }'))).toThrow(
      /non-empty string/,
    );
    expect(() => parseConfig(withSite('{ "ssr": { "env": { "AWS_REGION": "x" } } }'))).toThrow(
      /reserved by Lambda/,
    );
    expect(() =>
      parseConfig(withSite('{ "ssr": { "env": { "AWS_LAMBDA_NODEJS_ENTRYPOINT": "a.js" } } }')),
    ).toThrow(/entryPoint instead/);
  });

  it('accepts ssr.shim listen variables, with host optional', () => {
    expect(
      parseConfig(withSite('{ "ssr": { "shim": { "host": "HOST", "port": "PORT" } } }')).ssr?.shim,
    ).toEqual({ host: 'HOST', port: 'PORT' });
    expect(parseConfig(withSite('{ "ssr": { "shim": { "port": "PORT" } } }')).ssr?.shim).toEqual({
      port: 'PORT',
    });
    expect(parseConfig(withSite('{ "ssr": {} }')).ssr?.shim).toBeUndefined();
  });

  it('rejects a malformed ssr.shim', () => {
    const shim =
      (block: string, extra = ''): (() => unknown) =>
      () =>
        parseConfig(withSite(`{ "ssr": { "shim": ${block}${extra} } }`));
    for (const block of ['null', '"PORT"', '[]']) {
      expect(shim(block)).toThrow(/ssr\.shim must be an object/);
    }
    expect(shim('{ "host": "HOST" }')).toThrow(/ssr\.shim\.port is required/);
    expect(shim('{ "port": "PORT", "hots": "HOST" }')).toThrow(/unknown key "hots"/);
    expect(shim('{ "port": "HAS-DASH" }')).toThrow(/shim\.port must be an environment variable/);
    expect(shim('{ "port": 8080 }')).toThrow(/shim\.port must be an environment variable/);
    expect(shim('{ "port": "PORT", "host": "PORT" }')).toThrow(/must differ/);
    expect(shim('{ "port": "AWS_LAMBDA_HTTP_ENDPOINT" }')).toThrow(/reserved by Lambda/);
    expect(shim('{ "port": "PORT" }', ', "env": { "PORT": "3000" }')).toThrow(
      /names "PORT", which ssr\.env also sets/,
    );
    // An inherited property name is not an ssr.env key.
    expect(shim('{ "port": "toString" }')).not.toThrow();
    expect(shim('{ "port": "PORT" }', ', "entryPoint": "server/blogwright-entry.mjs"')).toThrow(
      /cannot be named "blogwright-entry\.mjs"/,
    );
  });

  it('bounds timeoutSeconds and maxConcurrencyPerEnvironment one below/at/above', () => {
    const parse = (timeout: number, concurrency: number): unknown =>
      parseConfig(
        withSite(
          `{ "ssr": { "timeoutSeconds": ${timeout}, "maxConcurrencyPerEnvironment": ${concurrency} } }`,
        ),
      ).ssr?.timeoutSeconds;
    expect(parse(3, 1)).toBe(3);
    expect(parse(900, 128)).toBe(900);
    for (const [timeout, concurrency] of [
      [2, 1],
      [901, 1],
      [30, 0],
      [30, 129],
      [3.5, 1],
      [30, 1.5],
    ] as const) {
      expect(() => parse(timeout, concurrency)).toThrow(/must be an integer in/);
    }
  });

  it('rejects ssr together with spa, and an unsupported region', () => {
    expect(() => parseConfig(withSite('{ "spa": true, "ssr": {} }'))).toThrow(/mutually exclusive/);
    expect(() => parseConfig(withSite('{ "region": "eu-central-1", "ssr": {} }'))).toThrow(
      /us-east-1, us-east-2, us-west-2, ap-northeast-1, eu-west-1/,
    );
    for (const region of ['us-east-1', 'us-east-2', 'us-west-2', 'ap-northeast-1', 'eu-west-1']) {
      expect(parseConfig(withSite(`{ "region": "${region}", "ssr": {} }`)).ssr).toBeDefined();
    }
    // A static site keeps accepting any region.
    expect(parseConfig(withSite('{ "region": "eu-central-1" }')).region).toBe('eu-central-1');
  });

  it('defaults retention.webFunctionDays to 90 and requires it positive', () => {
    expect(parseConfig(withSite('{}')).retention.webFunctionDays).toBe(90);
    expect(
      parseConfig(withSite('{ "retention": { "webFunctionDays": 7 } }')).retention.webFunctionDays,
    ).toBe(7);
    expect(() => parseConfig(withSite('{ "retention": { "webFunctionDays": 0 } }'))).toThrow(
      /positive/,
    );
  });

  it('derives the Web Function names from the environment prefix', () => {
    const cfg = parseConfig(withSite('{ "ssr": {} }'));
    const names = deriveNames('staging', '123456789012', cfg);
    expect(names.webFunction).toBe('staging-example-web');
    expect(names.webRole).toBe('staging-example-web-role');
    expect(names.webLogGroup).toBe('/example/staging/web');
    expect(names.webLocalLogGroup).toBe('/example/staging/web.local');
    expect(names.webOac).toBe('staging-example-web-oac');
    expect(names.ssrCachePolicy).toBe('staging-example-ssr');
  });
});
