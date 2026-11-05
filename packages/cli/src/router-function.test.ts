import { describe, expect, it } from 'vitest';

import { routerCodeHash, staticRouterCode } from './router-function.js';

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

const REDIRECT = { primary: 'example.com', aliases: ['www.example.com', 'example.org'] };

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
