/**
 * This package owns the `pds` config key end to end: validating the block
 * core's `parseConfig` hands off unvalidated, and deriving the
 * `<siteName>/atproto` default `secretName` core applies today.
 *
 * `validatePdsConfig` and `resolvePdsSecretName` are lifted verbatim from
 * `packages/core/src/config.ts` (the `cfg.pds` branch of `validateConfig` and
 * the `secretName` line of `mergeConfig`) - same checks, same message
 * strings, same `new URL(...)` try/catch ordering, so a non-URL resolver
 * still reports "must be a URL" before an `http://` one reports "must be
 * https". Core still validates this block itself for now; a later task
 * removes core's copy once the plugin dispatch path calls this one instead.
 */

import type { PdsConfig } from 'blogwright-core';

/**
 * A `pds` config block whose `secretName` has been resolved: never absent,
 * regardless of whether core's own `PdsConfig` still requires it (today) or
 * makes it optional once core stops defaulting it. `requirePdsConfig`
 * (`sync.ts`) returns this - built from {@link resolvePdsSecretName} - so
 * every call site downstream keeps a total type on `secretName` with no
 * cast and no `!`.
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
  if (!SECRET_NAME_PATTERN.test(cfg.secretName)) {
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
