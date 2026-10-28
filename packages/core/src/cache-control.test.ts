import { describe, expect, it } from 'vitest';

import {
  createCacheControlLookup,
  DEFAULT_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  parseCacheControlRules,
  REVALIDATE_CACHE_CONTROL,
} from './cache-control.js';

const LONG = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=0, must-revalidate';

function lookup(rules: unknown) {
  return createCacheControlLookup(parseCacheControlRules(rules));
}

describe('createCacheControlLookup', () => {
  it('lets the first matching rule win', () => {
    const find = lookup([
      { match: '/_app/immutable/**', value: LONG },
      { match: '**/*.js', value: 'public, max-age=60' },
      { match: '**', value: SHORT },
    ]);
    expect(find('/_app/immutable/chunks/app.1a2b.js')).toBe(LONG);
    expect(find('/service-worker.js')).toBe('public, max-age=60');
    expect(find('/index.html')).toBe(SHORT);
  });

  it('returns undefined for a path no rule matches', () => {
    const find = lookup([{ match: '/_astro/**', value: LONG }]);
    expect(find('/index.html')).toBeUndefined();
  });

  it('writes no header at all for an empty rule list', () => {
    expect(lookup([])('/index.html')).toBeUndefined();
  });

  it('treats "**" as zero or more whole segments, and at the end as one or more', () => {
    const find = lookup([
      { match: '/posts/**/index.html', value: 'a' },
      { match: '/assets/**', value: 'b' },
    ]);
    expect(find('/posts/index.html')).toBe('a');
    expect(find('/posts/2026/hello/index.html')).toBe('a');
    expect(find('/assets/logo.svg')).toBe('b');
    expect(find('/assets/fonts/inter.woff2')).toBe('b');
    expect(find('/assets')).toBeUndefined();
    expect(find('/assets-old/logo.svg')).toBeUndefined();
  });

  it('roots a leading "**" so "**/*.html" matches a top-level file too', () => {
    const find = lookup([{ match: '**/*.html', value: SHORT }]);
    expect(find('/index.html')).toBe(SHORT);
    expect(find('/a/b/c.html')).toBe(SHORT);
    expect(find('/a/b/c.htm')).toBeUndefined();
  });

  it('keeps "*" and "?" within one segment', () => {
    const find = lookup([
      { match: '/*.html', value: 'top' },
      { match: '/img/logo-?.png', value: 'logo' },
    ]);
    expect(find('/about.html')).toBe('top');
    expect(find('/blog/about.html')).toBeUndefined();
    expect(find('/img/logo-a.png')).toBe('logo');
    expect(find('/img/logo-ab.png')).toBeUndefined();
  });

  it('treats "?" as one code point, so it matches a character outside the BMP', () => {
    const find = lookup([{ match: '/icons/?.svg', value: 'x' }]);
    expect(find('/icons/\u{1F600}.svg')).toBe('x');
    expect(find('/icons/é.svg')).toBe('x');
    expect(find('/icons/ab.svg')).toBeUndefined();
  });

  it('matches non-ASCII file names written as themselves', () => {
    const find = lookup([{ match: '/blog/café/*.html', value: 'x' }]);
    expect(find('/blog/café/index.html')).toBe('x');
  });

  it('matches regex metacharacters in a pattern literally', () => {
    const find = lookup([{ match: '/a+b.(1).js', value: 'x' }]);
    expect(find('/a+b.(1).js')).toBe('x');
    expect(find('/aab.(1).js')).toBeUndefined();
    expect(find('/a+bx(1).js')).toBeUndefined();
  });

  it('applies the default rules: hashed asset directories for a year, everything else revalidates', () => {
    const find = createCacheControlLookup(DEFAULT_CACHE_CONTROL);
    expect(find('/_astro/index.Bx1a2b.css')).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(find('/_app/immutable/entry/start.js')).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(find('/_app/version.json')).toBe(REVALIDATE_CACHE_CONTROL);
    expect(find('/index.html')).toBe(REVALIDATE_CACHE_CONTROL);
    expect(find('/404.html')).toBe(REVALIDATE_CACHE_CONTROL);
    expect(find('/service-worker.js')).toBe(REVALIDATE_CACHE_CONTROL);
  });
});

describe('parseCacheControlRules', () => {
  it('normalises a single match string into a list and trims the value', () => {
    expect(parseCacheControlRules([{ match: '**', value: '  public, max-age=0 ' }])).toEqual([
      { match: ['**'], value: 'public, max-age=0' },
    ]);
  });

  it('accepts the default rules', () => {
    expect(parseCacheControlRules(DEFAULT_CACHE_CONTROL)).toEqual(DEFAULT_CACHE_CONTROL);
  });

  it('rejects a non-array', () => {
    expect(() => parseCacheControlRules({ match: '**', value: SHORT })).toThrow(
      /config\.cacheControl must be an array/,
    );
  });

  it('rejects a rule that is not an object, or carries an unknown key', () => {
    expect(() => parseCacheControlRules(['**'])).toThrow(/cacheControl\[0\] must be an object/);
    expect(() => parseCacheControlRules([{ match: '**', value: SHORT, path: '/x' }])).toThrow(
      /cacheControl\[0\] has unknown key "path"/,
    );
  });

  it('rejects a missing or empty match', () => {
    expect(() => parseCacheControlRules([{ value: SHORT }])).toThrow(/cacheControl\[0\]\.match/);
    expect(() => parseCacheControlRules([{ match: [], value: SHORT }])).toThrow(/non-empty array/);
    expect(() => parseCacheControlRules([{ match: ['/a', ''], value: SHORT }])).toThrow(
      /cacheControl\[0\]\.match\[1\] must be a non-empty URL path pattern/,
    );
  });

  describe('header values', () => {
    it.each([
      'no-store',
      'public, max-age=0, s-maxage=86400, must-revalidate',
      'private="set-cookie, x-token", max-age=60',
      'max-age=60,stale-while-revalidate=30',
    ])('accepts %j', (value) => {
      expect(() => parseCacheControlRules([{ match: '**', value }])).not.toThrow();
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['space instead of "="', 'max-age 3600'],
      ['a dangling comma', 'public,'],
      ['a header injection', 'max-age=0\r\nx-evil: 1'],
      ['an unterminated quote', 'private="set-cookie'],
      ['a number', 3600],
    ])('rejects %s', (_label, value) => {
      expect(() => parseCacheControlRules([{ match: '**', value }])).toThrow(
        /cacheControl\[0\]\.value must be a Cache-Control header value/,
      );
    });
  });

  describe('patterns that can never match', () => {
    it.each([
      ['no leading slash', '*.html', /can never match: patterns match the URL path/],
      ['a trailing slash', '/posts/', /ends in "\/"/],
      ['an empty segment', '/posts//index.html', /empty path segment/],
      ['"**" inside a segment', '/posts**', /"\*\*" must be a whole path segment/],
      ['a character class', '/img/[ab].png', /unsupported syntax/],
      ['a brace alternative', '/{a,b}.js', /unsupported syntax/],
      ['a backslash', '/a\\b.js', /unsupported syntax/],
      ['a "." segment', '/a/./b.html', /no "\." or "\.\." segments/],
      ['a ".." segment', '/a/../b.html', /no "\." or "\.\." segments/],
      ['a trailing ".." segment', '/a/..', /no "\." or "\.\." segments/],
      ['a percent-encoded space', '/a%20b.html', /decoded file path/],
      ['percent-encoded UTF-8', '/caf%C3%A9.html', /decoded file path/],
      ['a lowercase escape', '/caf%c3%a9.html', /decoded file path/],
    ])('rejects %s', (_label, pattern, message) => {
      expect(() => parseCacheControlRules([{ match: pattern, value: SHORT }])).toThrow(message);
    });

    it('rejects any rule after a catch-all, naming both patterns', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '**', value: SHORT },
          { match: '/_astro/**', value: LONG },
        ]),
      ).toThrow(
        'config.cacheControl[1].match[0] "/_astro/**" can never match: ' +
          'config.cacheControl[0].match[0] "**" already matches',
      );
      expect(() =>
        parseCacheControlRules([
          { match: '/**', value: SHORT },
          { match: '**/*.html', value: LONG },
        ]),
      ).toThrow(/can never match/);
    });

    it.each([['**/*'], ['/**/*'], ['/**/**'], ['/**/**/*']])(
      'treats %s as a catch-all, rejecting any rule after it',
      (catchAll) => {
        for (const later of ['/_astro/**', '**/*.html', '/blog/*']) {
          expect(() =>
            parseCacheControlRules([
              { match: catchAll, value: SHORT },
              { match: later, value: LONG },
            ]),
          ).toThrow(/cacheControl\[1\]\.match\[0\] .* can never match/);
        }
      },
    );

    it('rejects a pattern under an earlier "/<dir>/**/*", the same as "/<dir>/**"', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '/_astro/**/*', value: LONG },
          { match: '/_astro/fonts/*.woff2', value: SHORT },
        ]),
      ).toThrow(/"\/_astro\/fonts\/\*\.woff2" can never match/);
    });

    it('does not treat a one-level "/<dir>/*" or a filtered "**/*.js" as a catch-all', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '/_astro/*', value: LONG },
          { match: '/_astro/fonts/*.woff2', value: SHORT },
          { match: '**/*.js', value: SHORT },
          { match: '/app/*.css', value: LONG },
        ]),
      ).not.toThrow();
    });

    it('rejects a pattern under an earlier literal directory wildcard', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '/_astro/**', value: LONG },
          { match: '/_astro/fonts/*.woff2', value: SHORT },
        ]),
      ).toThrow(/cacheControl\[1\]\.match\[0\] "\/_astro\/fonts\/\*\.woff2" can never match/);
    });

    it('rejects a literal path an earlier pattern already matches', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '**/*.html', value: SHORT },
          { match: ['/feed.xml', '/404.html'], value: 'no-store' },
        ]),
      ).toThrow(/cacheControl\[1\]\.match\[1\] "\/404\.html" can never match/);
    });

    it('rejects a repeated pattern', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '/sw.js', value: SHORT },
          { match: '/sw.js', value: 'no-store' },
        ]),
      ).toThrow(/can never match/);
    });

    it('rejects a pattern repeated within one rule', () => {
      expect(() =>
        parseCacheControlRules([{ match: ['/sw.js', '/manifest.json', '/sw.js'], value: SHORT }]),
      ).toThrow(
        'config.cacheControl[0].match[2] "/sw.js" is redundant: ' +
          'config.cacheControl[0].match[0] "/sw.js" in the same rule already matches',
      );
    });

    it('rejects a pattern an earlier pattern of the same rule already covers', () => {
      expect(() =>
        parseCacheControlRules([{ match: ['/_astro/**', '/_astro/app.js'], value: LONG }]),
      ).toThrow(/match\[1\] "\/_astro\/app\.js" is redundant/);
      expect(() => parseCacheControlRules([{ match: ['**', '/x/**'], value: LONG }])).toThrow(
        /is redundant/,
      );
    });

    it('accepts distinct patterns within one rule, in either order', () => {
      expect(() =>
        parseCacheControlRules([
          { match: ['/_app/immutable/**', '/_astro/**'], value: LONG },
          { match: ['/sw.js', '/manifest.webmanifest'], value: SHORT },
        ]),
      ).not.toThrow();
    });

    it('accepts the specific rule when it comes first', () => {
      const rules = parseCacheControlRules([
        { match: '/404.html', value: 'no-store' },
        { match: '/_astro/fonts/*.woff2', value: SHORT },
        { match: '/_astro/**', value: LONG },
        { match: '**/*.html', value: SHORT },
        { match: '**', value: SHORT },
      ]);
      expect(rules).toHaveLength(5);
    });

    it('allows overlapping wildcard patterns it cannot prove are shadowed', () => {
      // "/blog/*.html" overlaps "**/*.html" but is not one of the detected shapes.
      expect(() =>
        parseCacheControlRules([
          { match: '**/*.html', value: SHORT },
          { match: '/blog/*.html', value: LONG },
        ]),
      ).not.toThrow();
    });

    it('allows a directory wildcard after a sibling directory', () => {
      expect(() =>
        parseCacheControlRules([
          { match: '/_astro/**', value: LONG },
          { match: '/_astro-legacy/**', value: SHORT },
        ]),
      ).not.toThrow();
    });
  });
});
