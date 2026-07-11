/**
 * URL-derived AT Protocol record keys for standard.site documents.
 *
 * `tidFromPath`, `extractDate`, `hashBits`, and `encodeTid` are vendored from
 * https://github.com/mastrojs/atproto (src/rkey.ts), MIT License, © 2025 Mastro.
 * Behaviour must not diverge: rkeys derived here must match link tags any
 * standard.site-aware client reconstructs with the reference implementation.
 *
 * Exported from the package as the `./rkey` subpath so the consuming site can
 * derive its document <link> tags from the same implementation. rkey.test.ts pins
 * the outputs to on-the-wire vectors that must never change for an existing path.
 */

/** Derive a TID-format rkey from a URL path (deterministic, no PDS round-trip). */
export const tidFromPath = (path: string): string => {
  if (path.replaceAll('/', '').length === 0) {
    throw Error(`tidFromPath received empty path (after slashes were removed): ${path}`);
  }
  const dateStr = extractDate(path);
  // TID: 64-bit int (bit 63 = 0)
  // - bits 62-10 = microsecond timestamp (53 bits)
  // - bits 9-0 = clock ID (10 bits)
  let tid: bigint;
  if (dateStr) {
    const date = new Date(dateStr);
    const micros = (BigInt(date.getTime()) * 1000n) & ((1n << 53n) - 1n);
    const clockId = hashBits(path, 10);
    tid = (micros << 10n) | clockId;
  } else {
    tid = hashBits(path, 63);
  }
  return encodeTid(tid);
};

/** Exported only for tests. */
export const extractDate = (path: string): string | undefined => {
  const m = path.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return undefined;
};

/** FNV-1a hash truncated to `nrOfBits` bits. */
const hashBits = (s: string, nrOfBits: number): bigint => {
  const mask = (1n << BigInt(nrOfBits)) - 1n;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h & mask;
};

const encodeTid = (n: bigint): string => {
  let result = '';
  for (let i = 0; i < 13; i++) {
    result = BASE32[Number(n & 31n)] + result;
    n >>= 5n;
  }
  return result;
};

const BASE32 = '234567abcdefghijklmnopqrstuvwxyz';

// --- iamstan-specific helpers (not vendored) ---

/**
 * Canonical URL path for a blog post — the shape `src/pages/posts/index.astro` links
 * (trailing slash). Rkeys derive from this string, so slugs must never change after
 * publication.
 */
export const postPath = (slug: string): string => `/posts/${slug}/`;

/** AT-URI of the standard.site document record for a post. */
export const documentUri = (did: string, slug: string): string =>
  `at://${did}/site.standard.document/${tidFromPath(postPath(slug))}`;
