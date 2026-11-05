import { createHash } from 'node:crypto';

import { isPrefixRedirect, normalizeRedirectFrom, type PathRedirect } from 'blogwright-core';

/** CloudFront Function source limit, in bytes. */
export const ROUTER_CODE_LIMIT = 10_240;

/** True when the compiled router source fits the CloudFront Function limit. */
export function routerCodeFits(code: string): boolean {
  return Buffer.byteLength(code, 'utf8') <= ROUTER_CODE_LIMIT;
}

/** Hosts whose requests redirect, and the host they redirect to. */
export interface AliasRedirect {
  /** The canonical host (`OpsConfig.domain`); the redirect target. */
  primary: string;
  /** Hosts that answer with a `301` to `primary`. */
  aliases: readonly string[];
}

/**
 * The directory-index rewrite every static-mode request goes through. The
 * S3 origin is the private REST endpoint (via OAC), which - unlike an S3
 * website endpoint - does no index-document resolution, so `/projects/`
 * becomes `/projects/index.html` here. The `/site` origin path is applied by
 * the distribution, so this must not add it.
 */
const INDEX_REWRITE = `  var uri = request.uri;
  if (uri.endsWith('/')) { uri += 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { uri += '/index.html'; }
  request.uri = uri;
  return request;`;

/**
 * Host check that runs ahead of the rewrite when `redirectToPrimary` is set:
 * a request for an alias answers `301` to the same path and query on the
 * primary. It reads `request.uri` before the rewrite touches it, so the
 * redirect target is the URL the viewer asked for, not the origin key.
 */
function redirectBlock(redirect: AliasRedirect, declareHost = true): string {
  return `${declareHost ? HOST_LINE : ''}  if (${JSON.stringify([...redirect.aliases])}.indexOf(host) !== -1) {
${queryParts('    ')}
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://' + ${JSON.stringify(redirect.primary)} + request.uri + (parts.length ? '?' + parts.join('&') : '') }
      }
    };
  }
`;
}

const HOST_LINE = `  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
`;

/** Rebuilds the request's query string into `parts`; shared by both redirect blocks. */
function queryParts(indent: string): string {
  return [
    'var parts = [];',
    'var query = request.querystring;',
    'for (var key in query) {',
    '  var entries = query[key].multiValue || [query[key]];',
    '  for (var i = 0; i < entries.length; i++) {',
    "    parts.push(entries[i].value === '' ? key : key + '=' + entries[i].value);",
    '  }',
    '}',
  ]
    .map((line) => indent + line)
    .join('\n');
}

/**
 * Path-redirect check that runs ahead of the alias host check and the rewrite.
 * Exact matches are one object lookup; prefix matches are an array walked
 * longest-first. For an alias request (when `redirectToPrimary` applies) a
 * relative target is made absolute on the primary, so the request reaches the
 * final URL in one hop.
 */
function pathRedirectsBlock(paths: readonly PathRedirect[], alias?: AliasRedirect): string {
  const exact: Record<string, [string, number]> = {};
  const prefixes: [string, string, number][] = [];
  for (const r of paths) {
    const from = normalizeRedirectFrom(r.from);
    const status = r.status ?? 301;
    if (isPrefixRedirect(from)) prefixes.push([from.slice(0, -2), r.to, status]);
    else exact[from] = [r.to, status];
  }
  prefixes.sort((a, b) => b[0].length - a[0].length);
  const aliasCheck = alias ? `${JSON.stringify([...alias.aliases])}.indexOf(host) !== -1` : 'false';
  const primary = alias ? JSON.stringify(alias.primary) : '""';
  return `${alias ? HOST_LINE : ''}  var uri = request.uri;
  var key = uri.length > 1 && uri.charAt(uri.length - 1) === '/' ? uri.slice(0, -1) : uri;
  var exact = ${JSON.stringify(exact)};
  var prefixes = ${JSON.stringify(prefixes)};
  var to = null;
  var status = 301;
  if (exact.hasOwnProperty(key)) {
    to = exact[key][0];
    status = exact[key][1];
  } else {
    for (var p = 0; p < prefixes.length; p++) {
      var base = prefixes[p][0];
      if (key === base || key.indexOf(base + '/') === 0) {
        to = prefixes[p][1].split(':splat').join(uri.length > base.length ? uri.slice(base.length + 1) : '');
        status = prefixes[p][2];
        // A splat that begins with slashes (\`/old//evil.com\`) must not turn a
        // relative target into a protocol-relative one (\`//evil.com\`).
        if (to.charAt(0) === '/') { to = '/' + to.replace(/^[\\/\\\\]+/, ''); }
        break;
      }
    }
  }
  if (to !== null) {
${queryParts('    ')}
    if (to.charAt(0) === '/' && ${aliasCheck}) { to = 'https://' + ${primary} + to; }
    if (parts.length) { to += (to.indexOf('?') === -1 ? '?' : '&') + parts.join('&'); }
    return {
      statusCode: status,
      statusDescription: { 301: 'Moved Permanently', 302: 'Found', 307: 'Temporary Redirect', 308: 'Permanent Redirect' }[status],
      headers: { location: { value: to } }
    };
  }
`;
}

/** The redirect checks that precede the rewrite: path redirects, then the alias host check. */
function checks(redirect: AliasRedirect | undefined, paths: readonly PathRedirect[]): string {
  const alias = redirect && redirect.aliases.length > 0 ? redirect : undefined;
  if (paths.length > 0)
    return pathRedirectsBlock(paths, alias) + (alias ? redirectBlock(alias, false) : '');
  return alias ? redirectBlock(alias) : '';
}

/**
 * Source of the production/staging CloudFront viewer-request function. With no
 * `redirect` it is the directory-index rewrite alone, byte-for-byte what every
 * existing site already runs. A distribution allows one function per event
 * type, so the alias redirect is folded into this function rather than being a
 * second one.
 */
export function staticRouterCode(
  redirect?: AliasRedirect,
  paths: readonly PathRedirect[] = [],
): string {
  const block = checks(redirect, paths);
  return `function handler(event) {
  var request = event.request;
${block}${INDEX_REWRITE}
}`;
}

/**
 * Source of the viewer-request function an SSR distribution runs when
 * `redirectToPrimary` is set. The application owns its own routing, so unlike
 * the static router there is no directory-index rewrite: alias hosts get the
 * `301` and every other request passes through untouched.
 */
export function ssrRouterCode(
  redirect: AliasRedirect | undefined,
  paths: readonly PathRedirect[] = [],
): string {
  const block = checks(redirect, paths);
  return `function handler(event) {
  var request = event.request;
${block}  return request;
}`;
}

/** Stable fingerprint of a function's source, recorded in state to detect a change. */
export function routerCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
