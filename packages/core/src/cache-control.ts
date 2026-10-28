/**
 * Per-path `Cache-Control`: the `cacheControl` config rules, their validation,
 * and the first-match-wins lookup the build agent runs for every file it
 * uploads. Patterns match the site-relative URL path of the built file
 * (`/posts/index.html`), never the S3 key, so one rule set serves production
 * (`site/...`) and previews (`previews/<id>/site/...`) alike.
 */

/** One `cacheControl` rule: the URL path patterns it covers and the header written on them. */
export interface CacheControlRule {
  /** Glob patterns over the site-relative URL path; see {@link createCacheControlLookup}. */
  readonly match: readonly string[];
  /** The `Cache-Control` header value, written verbatim. */
  readonly value: string;
}

/** For content-addressed (hashed) assets: any change gets a new URL, so a year is safe. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * For everything else: browsers revalidate on every use (a cheap 304), so a
 * deploy is never hidden behind a browser's heuristic freshness, while the
 * edge keeps the object for 86,400 s - the same day `CachingOptimized` already
 * applies to an object with no header - until a deploy's invalidation evicts it.
 */
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, must-revalidate';

/**
 * The rules applied when `cacheControl` is absent: Astro's `/_astro/` and
 * SvelteKit's `/_app/immutable/` hold only hashed build output, and the
 * catch-all keeps every other file revalidating in browsers.
 */
export const DEFAULT_CACHE_CONTROL: readonly CacheControlRule[] = [
  { match: ['/_astro/**', '/_app/immutable/**'], value: IMMUTABLE_CACHE_CONTROL },
  { match: ['**'], value: REVALIDATE_CACHE_CONTROL },
];

/** Returns the `Cache-Control` value for a URL path, or undefined when no rule matches. */
export type CacheControlLookup = (urlPath: string) => string | undefined;

const RULE_KEYS = new Set<string>(['match', 'value']);

/** RFC 9110 token characters, the shape of a directive name or bare argument. */
const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
/** An RFC 9110 quoted-string, without control characters. */
const QUOTED_STRING = '"(?:[^"\\\\\\x00-\\x1f\\x7f]|\\\\[^\\x00-\\x1f\\x7f])*"';
const DIRECTIVE = `${TOKEN}(?:=(?:${TOKEN}|${QUOTED_STRING}))?`;
/** Comma-separated directives, the whole of a `Cache-Control` field value. */
const CACHE_CONTROL_VALUE = new RegExp(`^\\s*${DIRECTIVE}(?:\\s*,\\s*${DIRECTIVE})*\\s*$`);

/** Glob syntax deliberately not supported, so a pattern never means something unexpected. */
const UNSUPPORTED_GLOB_CHARACTERS = /[[\]{}\\]/;

/**
 * A percent-encoded octet (`%20`, `%C3`). Patterns match the build output's
 * file paths, which are never encoded, so an escape would only ever match a
 * file whose name literally contains it.
 */
const PERCENT_ENCODED = /%[0-9A-Fa-f]{2}/;

/** Segments a built file's path never contains: the walk yields normalised paths. */
const DOT_SEGMENTS = new Set(['.', '..']);

/** A validated pattern, compiled once. */
interface CompiledPattern {
  /** As written in the config, for error messages. */
  source: string;
  /** With a leading `**` given its implied `/`, so every pattern starts with `/`. */
  rooted: string;
  regex: RegExp;
  /**
   * The directory (`/`, `/_astro/`) under which this pattern matches every
   * file - set for `**` and `/<dir>/**`, also spelled with a trailing `/*`
   * after the `**` - or undefined when it matches only some of them.
   */
  catchAllPrefix: string | undefined;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw `cacheControl` list and return it normalised (`match` always
 * an array). Rejects malformed rules and any pattern that can never match:
 * one no URL path can satisfy, or one an earlier rule's pattern already
 * covers - the first matching rule wins, so a later rule never sees it. A
 * pattern covered by an earlier pattern of its own rule is rejected too.
 */
export function parseCacheControlRules(raw: unknown): CacheControlRule[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      'config.cacheControl must be an array of { "match": ..., "value": ... } rules, ' +
        'checked in order (the first matching rule wins)',
    );
  }
  const rules: CacheControlRule[] = [];
  const earlier: CompiledPattern[] = [];
  for (const [index, entry] of raw.entries()) {
    const rule = parseRule(entry, `config.cacheControl[${index}]`);
    const compiled = rule.match.map((pattern, i) =>
      compilePattern(pattern, `config.cacheControl[${index}].match[${i}]`),
    );
    for (const [i, pattern] of compiled.entries()) {
      rejectRedundantPattern(pattern, compiled.slice(0, i));
      rejectShadowedPattern(pattern, earlier);
    }
    earlier.push(...compiled);
    rules.push(rule);
  }
  return rules;
}

function parseRule(entry: unknown, label: string): CacheControlRule {
  if (!isRecord(entry)) {
    throw new Error(`${label} must be an object with "match" and "value"`);
  }
  for (const key of Object.keys(entry)) {
    if (!RULE_KEYS.has(key)) throw new Error(`${label} has unknown key "${key}"`);
  }
  return { match: parseMatch(entry.match, label), value: parseValue(entry.value, label) };
}

function parseMatch(raw: unknown, label: string): string[] {
  const patterns = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(
      `${label}.match must be a URL path pattern or a non-empty array of them, ` +
        `got ${JSON.stringify(raw)}`,
    );
  }
  return patterns.map((pattern: unknown, i: number) => {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(
        `${label}.match[${i}] must be a non-empty URL path pattern, got ${JSON.stringify(pattern)}`,
      );
    }
    return pattern;
  });
}

function parseValue(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !CACHE_CONTROL_VALUE.test(raw)) {
    throw new Error(
      `${label}.value must be a Cache-Control header value - comma-separated directives ` +
        `such as "public, max-age=3600" - got ${JSON.stringify(raw)}`,
    );
  }
  return raw.trim();
}

/** Validate one pattern's syntax and compile it to an anchored regular expression. */
function compilePattern(source: string, label: string): CompiledPattern {
  const quoted = JSON.stringify(source);
  if (!source.startsWith('/') && !source.startsWith('**')) {
    throw new Error(
      `${label} ${quoted} can never match: patterns match the URL path, which begins with "/" ` +
        `(write "/${source}", or "**/${source}" for any directory)`,
    );
  }
  if (UNSUPPORTED_GLOB_CHARACTERS.test(source)) {
    throw new Error(
      `${label} ${quoted} uses unsupported syntax: only "*", "**" and "?" are wildcards - ` +
        'list alternatives as separate patterns',
    );
  }
  if (PERCENT_ENCODED.test(source)) {
    throw new Error(
      `${label} ${quoted} can never match: patterns match the decoded file path, so write the ` +
        'character itself ("/café.html", not "/caf%C3%A9.html")',
    );
  }
  const rooted = source.startsWith('/') ? source : `/${source}`;
  const segments = rooted.slice(1).split('/');
  if (segments.includes('')) {
    throw new Error(
      `${label} ${quoted} can never match: it has an empty path segment or ends in "/", but ` +
        'patterns match files - a directory URL is served from its index.html, so write ' +
        '".../index.html" or ".../**"',
    );
  }
  if (segments.some((segment) => DOT_SEGMENTS.has(segment))) {
    throw new Error(
      `${label} ${quoted} can never match: built file paths have no "." or ".." segments - ` +
        'write the path they resolve to',
    );
  }
  if (segments.some((segment) => segment.includes('**') && segment !== '**')) {
    throw new Error(
      `${label} ${quoted}: "**" must be a whole path segment ("/a/**/b"); ` +
        'use "*" to match within one segment',
    );
  }
  return {
    source,
    rooted,
    regex: segmentsToRegExp(segments),
    catchAllPrefix: catchAllPrefix(segments),
    label,
  };
}

/**
 * The directory under which the pattern matches every file: a literal head
 * followed by `**` segments and a final `**` or `*` (`*` matches any name,
 * and `**` already spans the directories before it). `/a/*` alone is not
 * one - it misses `/a/b/c`.
 */
function catchAllPrefix(segments: string[]): string | undefined {
  const firstWildcard = segments.findIndex(hasWildcard);
  if (firstWildcard === -1 || segments[firstWildcard] !== '**') return undefined;
  const tail = segments.slice(firstWildcard);
  const last = tail.at(-1);
  const spansDirectories = tail.slice(0, -1).every((segment) => segment === '**');
  if (!spansDirectories || (last !== '**' && last !== '*')) return undefined;
  return `/${segments
    .slice(0, firstWildcard)
    .map((segment) => `${segment}/`)
    .join('')}`;
}

/**
 * `**` spans any number of whole segments (one or more at the end of the
 * pattern, since a file has a name), `*` any run within one segment, `?` one
 * character within one segment.
 */
function segmentsToRegExp(segments: string[]): RegExp {
  const last = segments.length - 1;
  const body = segments
    .map((segment, i) => {
      if (segment === '**') return i === last ? '/.+' : '(?:/[^/]+)*';
      return `/${segmentToRegExp(segment)}`;
    })
    .join('');
  // `u`: "?" and "*" step over whole code points, so "?" matches one emoji.
  return new RegExp(`^${body}$`, 'u');
}

function segmentToRegExp(segment: string): string {
  return Array.from(segment, (char) => {
    if (char === '*') return '[^/]*';
    if (char === '?') return '[^/]';
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * Reject a pattern an earlier rule always matches first. Covered: a repeated
 * pattern, anything after a match-everything pattern (`**`, `**\/*`) or under
 * an earlier literal `<dir>/**` (or `<dir>/**\/*`), and a literal path an
 * earlier pattern matches. Overlaps between two wildcard patterns that are
 * not one of these shapes are allowed.
 */
function rejectShadowedPattern(pattern: CompiledPattern, earlier: CompiledPattern[]): void {
  const shadowing = earlier.find((previous) => covers(previous, pattern.rooted));
  if (shadowing === undefined) return;
  throw new Error(
    `${pattern.label} ${JSON.stringify(pattern.source)} can never match: ${shadowing.label} ` +
      `${JSON.stringify(shadowing.source)} already matches every path it would, and the first ` +
      'matching rule wins - move this rule above that one, or remove it',
  );
}

/**
 * Reject a pattern an earlier pattern of the same rule already covers: it
 * changes nothing, and is most likely a typo for a different path.
 */
function rejectRedundantPattern(pattern: CompiledPattern, siblings: CompiledPattern[]): void {
  const covering = siblings.find((previous) => covers(previous, pattern.rooted));
  if (covering === undefined) return;
  throw new Error(
    `${pattern.label} ${JSON.stringify(pattern.source)} is redundant: ${covering.label} ` +
      `${JSON.stringify(covering.source)} in the same rule already matches every path it would - ` +
      'remove it',
  );
}

function covers(previous: CompiledPattern, rooted: string): boolean {
  if (previous.rooted === rooted) return true;
  if (!hasWildcard(rooted)) return previous.regex.test(rooted);
  return previous.catchAllPrefix !== undefined && rooted.startsWith(previous.catchAllPrefix);
}

/**
 * Compile validated rules into a lookup over site-relative URL paths
 * (`/index.html`, `/_astro/app.1a2b.js`). Rules are tried in order and the
 * first rule with a matching pattern supplies the value; undefined means no
 * rule matched and the object is written without `Cache-Control`.
 */
export function createCacheControlLookup(rules: readonly CacheControlRule[]): CacheControlLookup {
  const compiled = rules.map((rule, index) => ({
    value: rule.value,
    patterns: rule.match.map(
      (pattern, i) => compilePattern(pattern, `cacheControl[${index}].match[${i}]`).regex,
    ),
  }));
  return (urlPath) =>
    compiled.find((rule) => rule.patterns.some((regex) => regex.test(urlPath)))?.value;
}
