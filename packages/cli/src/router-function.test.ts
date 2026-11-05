import { describe, expect, it } from 'vitest';

import {
  routerCodeFits,
  routerCodeHash,
  ssrRouterCode,
  staticRouterCode,
} from './router-function.js';

interface Result {
  uri?: string;
  statusCode?: number;
  headers?: { location: { value: string } };
}
type Handler = (event: unknown) => Result;

function load(code: string): Handler {
  return new Function(`${code}; return handler;`)() as Handler;
}

function run(
  code: string,
  host: string | undefined,
  uri: string,
  querystring: Record<string, unknown> = {},
): Result {
  const headers = host === undefined ? {} : { host: { value: host } };
  return load(code)({ request: { uri, headers, querystring } });
}

const REDIRECT = {
  primary: 'example.com',
  aliases: ['www.example.com', 'example.org'],
};

describe('staticRouterCode', () => {
  it('without a redirect is exactly the directory-index router every site already runs', () => {
    expect(staticRouterCode()).toBe(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) { uri += 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { uri += '/index.html'; }
  request.uri = uri;
  return request;
}`);
  });

  it('treats an empty alias list as no redirect', () => {
    expect(staticRouterCode({ primary: 'example.com', aliases: [] })).toBe(staticRouterCode());
  });

  it.each([
    ['/', '/index.html'],
    ['/projects/', '/projects/index.html'],
    ['/projects', '/projects/index.html'],
    ['/app.js', '/app.js'],
  ])('still resolves the index for %s on the primary and for non-alias hosts', (uri, want) => {
    const code = staticRouterCode(REDIRECT);
    expect(run(code, 'example.com', uri).uri).toBe(want);
    expect(run(code, 'd1.cloudfront.net', uri).uri).toBe(want);
  });

  it('301s every alias to the same path on the primary', () => {
    const code = staticRouterCode(REDIRECT);
    for (const host of REDIRECT.aliases) {
      const res = run(code, host, '/blog/post/');
      expect(res.statusCode).toBe(301);
      expect(res.headers?.location.value).toBe('https://example.com/blog/post/');
    }
  });

  it('redirects the URL the viewer asked for, not the rewritten origin key', () => {
    const res = run(staticRouterCode(REDIRECT), 'www.example.com', '/');
    expect(res.headers?.location.value).toBe('https://example.com/');
  });

  it('carries the query string, including repeated and empty values', () => {
    const res = run(staticRouterCode(REDIRECT), 'www.example.com', '/search', {
      q: { value: 'a' },
      tag: { value: 'x', multiValue: [{ value: 'x' }, { value: 'y' }] },
      flag: { value: '' },
    });
    expect(res.headers?.location.value).toBe('https://example.com/search?q=a&tag=x&tag=y&flag');
  });

  it('matches the host case-insensitively and tolerates a missing host header', () => {
    const code = staticRouterCode(REDIRECT);
    expect(run(code, 'WWW.Example.COM', '/').statusCode).toBe(301);
    expect(run(code, undefined, '/x/').uri).toBe('/x/index.html');
  });
});

describe('routerCodeHash', () => {
  it('differs when the redirect set differs and is stable otherwise', () => {
    const a = routerCodeHash(staticRouterCode(REDIRECT));
    expect(a).toBe(routerCodeHash(staticRouterCode(REDIRECT)));
    expect(a).not.toBe(routerCodeHash(staticRouterCode()));
    expect(a).not.toBe(
      routerCodeHash(staticRouterCode({ ...REDIRECT, aliases: ['www.example.com'] })),
    );
  });
});

describe('path redirects', () => {
  const PATHS = [
    { from: '/about.php', to: '/about/' },
    { from: '/old-blog/*', to: '/news/:splat', status: 302 as const },
    { from: '/old-blog/special/*', to: 'https://other.example/x?a=1' },
    { from: '/gone/', to: '/', status: 308 as const },
  ];
  const q = (v: string): Record<string, unknown> => ({ k: { value: v } });

  it('is byte-identical with no redirects', () => {
    expect(staticRouterCode(REDIRECT, [])).toBe(staticRouterCode(REDIRECT));
    expect(staticRouterCode(undefined, [])).toBe(staticRouterCode());
  });

  it('redirects an exact path with its query, tolerating a trailing slash', () => {
    for (const uri of ['/about.php', '/about.php/']) {
      const r = run(staticRouterCode(undefined, PATHS), 'example.com', uri, q('v'));
      expect(r.statusCode).toBe(301);
      expect(r.headers?.location.value).toBe('/about/?k=v');
    }
  });

  it('matches a from written with a trailing slash', () => {
    const r = run(staticRouterCode(undefined, PATHS), 'example.com', '/gone');
    expect(r.statusCode).toBe(308);
    expect(r.headers?.location.value).toBe('/');
  });

  it('carries the splat, including an empty remainder, and uses the status', () => {
    const code = staticRouterCode(undefined, PATHS);
    expect(run(code, 'example.com', '/old-blog/2020/post/').headers?.location.value).toBe(
      '/news/2020/post/',
    );
    const bare = run(code, 'example.com', '/old-blog');
    expect(bare.statusCode).toBe(302);
    expect(bare.headers?.location.value).toBe('/news/');
    expect(run(code, 'example.com', '/old-blog/').headers?.location.value).toBe('/news/');
  });

  it('prefers the longest prefix and appends to an existing query', () => {
    const r = run(staticRouterCode(undefined, PATHS), 'example.com', '/old-blog/special/a', q('v'));
    expect(r.headers?.location.value).toBe('https://other.example/x?a=1&k=v');
  });

  it('prefers an exact match over a prefix', () => {
    const code = staticRouterCode(undefined, [
      { from: '/a/*', to: '/p/:splat' },
      { from: '/a/b', to: '/exact' },
    ]);
    expect(run(code, 'h', '/a/b').headers?.location.value).toBe('/exact');
    expect(run(code, 'h', '/a/c').headers?.location.value).toBe('/p/c');
  });

  it('passes multi-value query parameters through', () => {
    const r = run(staticRouterCode(undefined, PATHS), 'h', '/about.php', {
      t: { value: 'x', multiValue: [{ value: 'x' }, { value: 'y' }] },
    });
    expect(r.headers?.location.value).toBe('/about/?t=x&t=y');
  });

  it('does not touch other requests, which still get the index rewrite', () => {
    expect(run(staticRouterCode(undefined, PATHS), 'h', '/other/').uri).toBe('/other/index.html');
  });

  it('answers an alias request with a path redirect in one hop, else the host redirect', () => {
    const code = staticRouterCode(REDIRECT, PATHS);
    expect(run(code, 'www.example.com', '/about.php').headers?.location.value).toBe(
      'https://example.com/about/',
    );
    expect(run(code, 'example.com', '/about.php').headers?.location.value).toBe('/about/');
    expect(run(code, 'www.example.com', '/x', q('v')).headers?.location.value).toBe(
      'https://example.com/x?k=v',
    );
  });

  it('SSR form redirects and otherwise passes through without a rewrite', () => {
    const code = ssrRouterCode(undefined, PATHS);
    expect(run(code, 'h', '/about.php').statusCode).toBe(301);
    expect(run(code, 'h', '/other').uri).toBe('/other');
  });

  it('reports the compiled size against the CloudFront limit', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      from: `/some/long/path/segment/number-${i}`,
      to: `/another/long/path/segment/target-${i}`,
    }));
    expect(routerCodeFits(staticRouterCode(undefined, PATHS))).toBe(true);
    expect(routerCodeFits(staticRouterCode(undefined, many))).toBe(false);
  });
});
