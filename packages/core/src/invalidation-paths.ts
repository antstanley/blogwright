/**
 * Which CloudFront URL paths a changed S3 key invalidates. Shared by the
 * build agent, which records the changed paths of a build, and the CLI, which
 * computes them itself when it promotes a staged release.
 */

/**
 * Map a changed S3 key to the CloudFront URL path(s) to invalidate. For
 * directory index documents, invalidate both the `index.html` key and the
 * directory URL a viewer would actually request (e.g. `site/posts/index.html`
 * → `/posts/index.html` + `/posts/`).
 */
export function invalidationPaths(key: string, prefix: string): string[] {
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const paths = [`/${rel}`];
  if (rel === 'index.html') paths.push('/');
  else if (rel.endsWith('/index.html')) paths.push(`/${rel.slice(0, -'index.html'.length)}`);
  return paths;
}
