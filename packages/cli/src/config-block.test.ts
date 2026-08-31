import { parseConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { renderConfigBlock, spliceConfigBlock } from './config-block.js';

const PATH = '/repo/config/production.jsonc';

describe('renderConfigBlock', () => {
  it("matches renderConfig's comma-and-comment style, one nesting level deeper", () => {
    const rendered = renderConfigBlock('analytics', [
      { prop: '"bucket": "logs-bucket"', comment: 'holds ingested CloudFront logs' },
      { prop: '"prefix": "cf/"' },
    ]);
    expect(rendered).toBe(
      [
        '  "analytics": {',
        '    "bucket": "logs-bucket", // holds ingested CloudFront logs',
        '    "prefix": "cf/"',
        '  }',
      ].join('\n'),
    );
  });

  it('renders an empty entry list as an empty object', () => {
    expect(renderConfigBlock('empty', [])).toBe('  "empty": {}');
  });
});

describe('spliceConfigBlock - comment and formatting preservation (pinned)', () => {
  it('comes back byte-identical outside the inserted region', () => {
    const text = [
      '// config/production.jsonc - created by `blogwright init`',
      '{',
      '    "region": "us-east-1", // primary region',
      '    /* stable slug - never change it */',
      '    "siteName": "myblog"',
      '}',
      '',
    ].join('\n');
    const rendered = renderConfigBlock('analytics', [
      { prop: '"bucket": "logs-bucket"', comment: 'holds ingested CloudFront logs' },
      { prop: '"prefix": "cf/"' },
    ]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '// config/production.jsonc - created by `blogwright init`',
        '{',
        '    "region": "us-east-1", // primary region',
        '    /* stable slug - never change it */',
        '    "siteName": "myblog",',
        '  "analytics": {',
        '    "bucket": "logs-bucket", // holds ingested CloudFront logs',
        '    "prefix": "cf/"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    // The inserted block reads like a wizard-written one.
    expect(parseConfig(result).siteName).toBe('myblog');
  });
});

describe('spliceConfigBlock - an operator comment stays attached to its entry', () => {
  it('keeps a trailing // comment on the last entry, not displaced after the new block', () => {
    // The default wizard output ends exactly like this: `siteName` carries a
    // same-line comment and is the last entry (init.ts:52, 104-107).
    const text = [
      '{',
      '  "region": "us-east-1",',
      '  "siteName": "myblog" // stable slug in every AWS resource name - never change it',
      '}',
      '',
    ].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "region": "us-east-1",',
        '  "siteName": "myblog", // stable slug in every AWS resource name - never change it',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const parsed = parseConfig(result);
    expect(parsed.siteName).toBe('myblog');
  });

  it("matches the document's CRLF line endings and leaves no spurious blank line", () => {
    const text = ['{', '  "siteName": "myblog"', '}', ''].join('\r\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "siteName": "myblog",',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\r\n'),
    );
    const parsed = parseConfig(result);
    expect(parsed.siteName).toBe('myblog');
  });
});

describe('spliceConfigBlock - comma handling at the validity boundary', () => {
  it('inserts a comma after a last entry that has none', () => {
    const text = ['{', '  "region": "us-east-1",', '  "siteName": "myblog"', '}', ''].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "region": "us-east-1",',
        '  "siteName": "myblog",',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const parsed = parseConfig(result);
    expect(parsed.siteName).toBe('myblog');
  });

  it('does not double a comma already present after the last entry', () => {
    const text = ['{', '  "region": "us-east-1",', '  "siteName": "myblog",', '}', ''].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "region": "us-east-1",',
        '  "siteName": "myblog",',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const parsed = parseConfig(result);
    expect(parsed.siteName).toBe('myblog');
  });

  it('inserts into an empty object with no leading comma', () => {
    const text = '{}';
    // Splice a flat entry directly (spliceConfigBlock does not care what
    // `rendered` contains) so the result is a real, parseable config.
    const rendered = '  "siteName": "myblog"';

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'siteName', rendered });

    expect(result).toBe(['{', '  "siteName": "myblog"', '}'].join('\n'));
    const parsed = parseConfig(result);
    expect(parsed.siteName).toBe('myblog');
  });
});

describe('spliceConfigBlock - refusals', () => {
  it('refuses a duplicate key, naming the key and the file path', () => {
    const text = [
      '{',
      '  "siteName": "myblog",',
      '  "analytics": {',
      '    "bucket": "existing-bucket"',
      '  }',
      '}',
      '',
    ].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "new-bucket"' }]);

    expect(() => spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered })).toThrow(
      /analytics/,
    );
    expect(() => spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered })).toThrow(
      new RegExp(PATH.replace(/[/.]/g, '\\$&')),
    );
  });

  it('refuses an array document', () => {
    const text = '[\n  1,\n  2\n]\n';
    expect(() =>
      spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered: '  "analytics": {}' }),
    ).toThrow(/an array/);
  });

  it('refuses a document with a second top-level value', () => {
    const text = '{\n  "siteName": "myblog"\n}\n{\n  "extra": 1\n}\n';
    expect(() =>
      spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered: '  "analytics": {}' }),
    ).toThrow(/second top-level value/);
  });

  it('refuses a bare value document', () => {
    const text = '42\n';
    expect(() =>
      spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered: '  "analytics": {}' }),
    ).toThrow(/a bare value/);
  });

  it('refuses an unterminated object', () => {
    const text = '{\n  "siteName": "myblog"\n';
    expect(() =>
      spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered: '  "analytics": {}' }),
    ).toThrow(/unterminated object/);
  });
});

describe('spliceConfigBlock - scanner discipline', () => {
  it('only a top-level occurrence of the key counts as a duplicate, not a nested one', () => {
    const text = [
      '{',
      '  "siteName": "myblog",',
      '  "otherPlugin": {',
      '    "pds": "not the top-level pds key"',
      '  }',
      '}',
      '',
    ].join('\n');
    const rendered = renderConfigBlock('pds', [{ prop: '"name": "My Blog"' }]);

    // A nested key of the same name must not be refused.
    const result = spliceConfigBlock({ path: PATH, text }, { key: 'pds', rendered });
    expect(parseConfig(result).siteName).toBe('myblog');

    // A genuine top-level occurrence still is.
    const withTopLevelPds = [
      '{',
      '  "siteName": "myblog",',
      '  "pds": { "name": "old" }',
      '}',
      '',
    ].join('\n');
    expect(() =>
      spliceConfigBlock({ path: PATH, text: withTopLevelPds }, { key: 'pds', rendered }),
    ).toThrow(/pds/);
  });

  it('does not let a brace inside a block comment shift the object boundary or the splice point', () => {
    const text = [
      '{',
      '  "siteName": "myblog" /* legacy shape was { "old": true } */',
      '}',
      '',
    ].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "siteName": "myblog", /* legacy shape was { "old": true } */',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(parseConfig(result).siteName).toBe('myblog');
  });

  it('does not let an escaped quote before a brace end a string early', () => {
    // The string value decodes to `a"}` - an escaped quote immediately
    // followed by a closing brace, both inside the string.
    const text = ['{', '  "siteName": "myblog",', '  "note": "a\\"}"', '}', ''].join('\n');
    const rendered = renderConfigBlock('analytics', [{ prop: '"bucket": "logs-bucket"' }]);

    const result = spliceConfigBlock({ path: PATH, text }, { key: 'analytics', rendered });

    expect(result).toBe(
      [
        '{',
        '  "siteName": "myblog",',
        '  "note": "a\\"}",',
        '  "analytics": {',
        '    "bucket": "logs-bucket"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const parsed = parseConfig(result) as unknown as Record<string, unknown>;
    expect(parsed['note']).toBe('a"}');
  });
});

describe('spliceConfigBlock - scanner invariants the refactor rests on', () => {
  // Both cases below were correct in the shipped scanner but pinned by nothing:
  // task 12's gate mutated each line and watched all 16 tests stay green.

  it('does not mistake a top-level string VALUE for a key', () => {
    // Pins `expectKey = false` (config-block.ts:156). Without it every top-level
    // value string is recorded as a key, so this splice would be refused as a
    // duplicate of a key the document does not actually declare.
    const source = '{\n  "siteName": "analytics"\n}\n';
    const out = spliceConfigBlock(
      { path: PATH, text: source },
      { key: 'analytics', rendered: '  "analytics": {\n    "namespace": "web"\n  }' },
    );
    expect(out).toContain('"analytics": {');
    expect(parseConfig(out).siteName).toBe('analytics');
  });

  it('still detects a top-level duplicate that follows an array-valued entry', () => {
    // Pins `containers.pop()` (config-block.ts:200). Without it the stack stays
    // topped by 'array' after the nested array closes, so the following depth-1
    // comma stops expecting a key, the real `analytics` key is never recorded,
    // and the splice emits it a SECOND time instead of refusing - the exact
    // silent duplication this module exists to prevent.
    const source = '{\n  "tags": ["a", "b"],\n  "analytics": { "namespace": "web" }\n}\n';
    expect(() =>
      spliceConfigBlock(
        { path: PATH, text: source },
        { key: 'analytics', rendered: '  "analytics": {}' },
      ),
    ).toThrow(/already declares a "analytics" key/);
  });
});
