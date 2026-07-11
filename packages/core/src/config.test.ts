import { describe, expect, it } from 'vitest';

import { deriveNames, parseConfig, stripJsonComments, stripTrailingCommas } from './config.js';

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

  it('applies pds defaults (secretName from siteName)', () => {
    const cfg = parseConfig(withSite('{ "pds": { "name": "Ant Stanley" } }'));
    expect(cfg.pds).toEqual({
      name: 'Ant Stanley',
      secretName: 'example/atproto',
    });
  });

  it('keeps explicit pds overrides', () => {
    const cfg = parseConfig(
      withSite(
        '{ "pds": { "name": "x", "handleResolver": "https://resolver.example", "secretName": "me/secret", "description": "d" } }',
      ),
    );
    expect(cfg.pds?.handleResolver).toBe('https://resolver.example');
    expect(cfg.pds?.secretName).toBe('me/secret');
    expect(cfg.pds?.description).toBe('d');
  });

  it('rejects a pds section without a name', () => {
    expect(() => parseConfig(withSite('{ "pds": { "name": " " } }'))).toThrow(/pds.name/);
  });

  it('rejects a non-https pds handleResolver', () => {
    expect(() =>
      parseConfig(withSite('{ "pds": { "name": "x", "handleResolver": "http://resolver" } }')),
    ).toThrow(/https/);
    expect(() =>
      parseConfig(withSite('{ "pds": { "name": "x", "handleResolver": "nope" } }')),
    ).toThrow(/URL/);
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
      withSite('{ "spa": true, "paths": { "app": "web", "dist": "web/build" }, "sourceInclude": ["web/src/lib/pkg/"] }'),
    );
    expect(cfg.paths.app).toBe('web');
    expect(cfg.paths.dist).toBe('web/build');
    expect(cfg.spa).toBe(true);
    expect(cfg.sourceInclude).toEqual(['web/src/lib/pkg/']);
  });

  it('rejects escaping or absolute app/dist/sourceInclude paths', () => {
    expect(() => parseConfig(withSite('{ "paths": { "app": "../up" } }'))).toThrow(/paths.app/);
    expect(() => parseConfig(withSite('{ "paths": { "dist": "/abs" } }'))).toThrow(/paths.dist/);
    expect(() => parseConfig(withSite('{ "sourceInclude": ["a/../b"] }'))).toThrow(
      /sourceInclude/,
    );
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

  it('rejects an invalid environment name', () => {
    expect(() => deriveNames('Prod!', '1', parseConfig(withSite('{}')))).toThrow(/environment/);
  });

  it('rejects a derived bucket name over the 63-char S3 limit', () => {
    const cfg = parseConfig(`{ "siteName": "${'x'.repeat(50)}" }`);
    expect(() => deriveNames('production', '123456789012', cfg)).toThrow(/63-char/);
  });
});
