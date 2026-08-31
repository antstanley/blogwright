/**
 * This package owns the `pds` config key end to end: validating the block
 * core's `parseConfig` hands off unvalidated, and deriving the
 * `<siteName>/atproto` default `secretName`.
 *
 * `validatePdsConfig` and `resolvePdsSecretName` were lifted verbatim from
 * `packages/core/src/config.ts` (the `cfg.pds` branch of `validateConfig` and
 * the `secretName` line of `mergeConfig`) - same checks, same message
 * strings, same `new URL(...)` try/catch ordering, so a non-URL resolver
 * still reports "must be a URL" before an `http://` one reports "must be
 * https". Core's copies are now gone: these are the only ones.
 */

import type { PdsConfig } from 'blogwright-core';

/**
 * A `pds` config block whose `secretName` has been resolved: never absent,
 * where core's own `PdsConfig` declares it optional because core no longer
 * defaults it. `requirePdsConfig` (`sync.ts`) returns this - built from
 * {@link resolvePdsSecretName} - so every call site downstream keeps a total
 * type on `secretName` with no cast and no `!`.
 */
export interface ResolvedPdsConfig extends PdsConfig {
  secretName: string;
}

/** Characters permitted in a Secrets Manager secret name. */
const SECRET_NAME_PATTERN = /^[\w/+=.@-]+$/;

/** Template pds's default `secretName` is derived from - the one home for it in this package. */
function defaultSecretName(siteName: string): string {
  return `${siteName}/atproto`;
}

/**
 * Validate a raw `pds` config block, boundary-checked as `unknown` because it
 * comes off `parseConfigDocument`'s `raw` half (a plugin's block has no type
 * until its own package narrows it). Throws with the same message strings
 * core's `validateConfig` raises today for these checks.
 */
export function validatePdsConfig(raw: unknown): PdsConfig {
  const cfg = raw as PdsConfig;
  if (!cfg.name?.trim()) throw new Error('config.pds.name is required');
  if (cfg.handleResolver !== undefined) {
    let resolver: URL;
    try {
      resolver = new URL(cfg.handleResolver);
    } catch {
      throw new Error(`config.pds.handleResolver must be a URL, got "${cfg.handleResolver}"`);
    }
    if (resolver.protocol !== 'https:') {
      throw new Error(`config.pds.handleResolver must be https, got "${cfg.handleResolver}"`);
    }
  }
  // `secretName` is optional on `PdsConfig` now that core no longer defaults
  // it, so the character class applies only to a value that is actually
  // present. An absent one is not malformed - it selects the
  // `<siteName>/atproto` default `resolvePdsSecretName` supplies, which
  // trivially satisfies the class. The guard is a narrowing, not a behaviour
  // change: the previous unguarded call handed `undefined` to `RegExp.test`,
  // which coerced it to the string "undefined" and matched, so an absent
  // `secretName` passed this check before the guard existed too.
  if (cfg.secretName !== undefined && !SECRET_NAME_PATTERN.test(cfg.secretName)) {
    throw new Error(`config.pds.secretName has invalid characters: "${cfg.secretName}"`);
  }
  return cfg;
}

/**
 * Resolve the secret name a `pds` block uses: the explicit `secretName` when
 * present, otherwise `<siteName>/atproto`.
 */
export function resolvePdsSecretName(pds: PdsConfig, siteName: string): string {
  return pds.secretName ?? defaultSecretName(siteName);
}
