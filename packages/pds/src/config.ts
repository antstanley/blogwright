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
 *
 * One case core never had to answer is answered here: an ABSENT block. Core
 * gated its checks behind `if (cfg.pds)`, so nothing validated a document
 * with no `pds` key; the host now calls a plugin's validator with
 * `undefined` in exactly that case, and {@link NO_PDS_SECTION_MESSAGE} is
 * what this package returns to an operator for it.
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

/**
 * What an ABSENT `pds` block reports. The same sentence `requirePdsConfig`
 * (`sync.ts`) has always raised for a repo that has not written one, declared
 * here and imported there so the two refusals cannot drift into two different
 * sentences for one situation - whichever of them an operator happens to
 * reach first.
 */
export const NO_PDS_SECTION_MESSAGE =
  'config has no "pds" section - add it to config/production.jsonc';

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
  // ABSENT is not MALFORMED, and the two want different sentences. The host
  // calls this with `undefined` whenever the document carries no `pds` key
  // (`resolvePluginConfig`, `packages/cli/src/plugins.ts`) - deliberately, so
  // a plugin with derivable defaults can supply them. This plugin has none:
  // `name` is an operator's choice and nothing can invent it, so an absent
  // block is a refusal. But it is the ORDINARY first-run refusal, not a
  // defect in a block that was written, so it names the missing section and
  // how to create it rather than a key inside a block that does not exist.
  // Without this guard the first statement below dereferences `undefined` and
  // the operator gets a bare `TypeError` instead (the defect task 29's
  // changeset named as a known issue).
  //
  // `null` joins `undefined` because that is the behaviour a `"pds": null`
  // document has always had: core's own check was gated behind `if (cfg.pds)`
  // and skipped it, and `requirePdsConfig`'s `if (!pds)` then reported it as
  // an absent section. Every other present value stays MALFORMED and falls
  // through to the key-naming checks below, which is where a string, a number
  // or an array already reported `config.pds.name is required`.
  if (raw === undefined || raw === null) throw new Error(NO_PDS_SECTION_MESSAGE);
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
