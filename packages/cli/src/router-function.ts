import { createHash } from 'node:crypto';

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
function redirectBlock(redirect: AliasRedirect): string {
  return `  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (${JSON.stringify([...redirect.aliases])}.indexOf(host) !== -1) {
    var parts = [];
    var query = request.querystring;
    for (var key in query) {
      var entries = query[key].multiValue || [query[key]];
      for (var i = 0; i < entries.length; i++) {
        parts.push(entries[i].value === '' ? key : key + '=' + entries[i].value);
      }
    }
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

/**
 * Source of the production/staging CloudFront viewer-request function. With no
 * `redirect` it is the directory-index rewrite alone, byte-for-byte what every
 * existing site already runs. A distribution allows one function per event
 * type, so the alias redirect is folded into this function rather than being a
 * second one.
 */
export function staticRouterCode(redirect?: AliasRedirect): string {
  const block = redirect && redirect.aliases.length > 0 ? redirectBlock(redirect) : '';
  return `function handler(event) {
  var request = event.request;
${block}${INDEX_REWRITE}
}`;
}

/** Stable fingerprint of a function's source, recorded in state to detect a change. */
export function routerCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
