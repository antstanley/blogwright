import { describe, expect, it } from 'vitest';

import { deriveNames, parseConfig, stripJsonComments } from './config.js';

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

describe('parseConfig', () => {
  it('applies defaults and merges nested objects', () => {
    const cfg = parseConfig('{ "domain": "example.com", "microvm": { "memory": 8 } }');
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.siteName).toBe('iamstan');
    expect(cfg.domain).toBe('example.com');
    expect(cfg.microvm.memory).toBe(8);
    expect(cfg.microvm.idle.maxIdleDurationSeconds).toBe(300);
    expect(cfg.retention.microvmDays).toBe(365);
  });

  it('rejects invalid siteName', () => {
    expect(() => parseConfig('{ "siteName": "Bad Name" }')).toThrow(/siteName/);
  });

  it('rejects out-of-range maxDurationSeconds', () => {
    expect(() => parseConfig('{ "microvm": { "maxDurationSeconds": 999999 } }')).toThrow(
      /maxDuration/,
    );
  });

  it('rejects a memory value outside the supported MicroVM sizes', () => {
    expect(() => parseConfig('{ "microvm": { "memory": 3 } }')).toThrow(/memory/);
  });

  it('leaves pds undefined when the section is absent', () => {
    expect(parseConfig('{}').pds).toBeUndefined();
  });

  it('applies pds defaults (secretName from siteName)', () => {
    const cfg = parseConfig('{ "pds": { "name": "Ant Stanley" } }');
    expect(cfg.pds).toEqual({
      name: 'Ant Stanley',
      secretName: 'iamstan/atproto',
    });
  });

  it('keeps explicit pds overrides', () => {
    const cfg = parseConfig(
      '{ "pds": { "name": "x", "handleResolver": "https://resolver.example", "secretName": "me/secret", "description": "d" } }',
    );
    expect(cfg.pds?.handleResolver).toBe('https://resolver.example');
    expect(cfg.pds?.secretName).toBe('me/secret');
    expect(cfg.pds?.description).toBe('d');
  });

  it('rejects a pds section without a name', () => {
    expect(() => parseConfig('{ "pds": { "name": " " } }')).toThrow(/pds.name/);
  });

  it('rejects a non-https pds handleResolver', () => {
    expect(() =>
      parseConfig('{ "pds": { "name": "x", "handleResolver": "http://resolver" } }'),
    ).toThrow(/https/);
    expect(() => parseConfig('{ "pds": { "name": "x", "handleResolver": "nope" } }')).toThrow(
      /URL/,
    );
  });
});

describe('deriveNames', () => {
  it('produces deterministic env-prefixed names', () => {
    const cfg = parseConfig('{}');
    const names = deriveNames('staging', '123456789012', cfg);
    expect(names.bucket).toBe('staging-iamstan-123456789012');
    expect(names.buildRole).toBe('staging-iamstan-build-role');
    expect(names.execRole).toBe('staging-iamstan-exec-role');
    expect(names.microvmImage).toBe('staging-iamstan-builder');
    expect(names.microvmLogGroup).toBe('/aws/lambda/microvms/staging-iamstan-builder');
    expect(names.cloudfrontLogGroup).toBe('/iamstan/staging/cloudfront');
  });

  it('rejects an invalid environment name', () => {
    expect(() => deriveNames('Prod!', '1', parseConfig('{}'))).toThrow(/environment/);
  });

  it('rejects a derived bucket name over the 63-char S3 limit', () => {
    const cfg = parseConfig(`{ "siteName": "${'x'.repeat(50)}" }`);
    expect(() => deriveNames('production', '123456789012', cfg)).toThrow(/63-char/);
  });
});
