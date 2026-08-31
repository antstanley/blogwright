import type { PdsConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { resolvePdsSecretName, validatePdsConfig } from './config.js';

/** A minimally valid `pds` block, spread over in each test. */
const BASE = { name: 'My Site', secretName: 'my-site/atproto' };

/** Whatever the call threw, or `undefined` when it returned. */
function thrownBy(raw: unknown): unknown {
  try {
    validatePdsConfig(raw);
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('validatePdsConfig', () => {
  /*
   * ABSENT vs MALFORMED. The host calls a plugin's validator with
   * `undefined` whenever the config document carries no block for it
   * (`resolvePluginConfig`, `packages/cli/src/plugins.ts`), so an absent
   * `pds` block reaches this function on an ordinary first-run
   * `blogwright pds keygen`. It is a refusal either way - this plugin has no
   * derivable defaults, since `name` is an operator's choice - but the two
   * situations get different sentences, and the message strings below are
   * written out as literals rather than compared against the module's own
   * exported constant: a test that asserts a constant equals itself cannot
   * tell a changed message from an unchanged one.
   */
  it('refuses an ABSENT block by naming the missing section and where to add it', () => {
    expect(() => validatePdsConfig(undefined)).toThrow(
      'config has no "pds" section - add it to config/production.jsonc',
    );
  });

  it('refuses an absent block with a plain Error, never a TypeError from a property read', () => {
    // The defect this replaced: `cfg.name?.trim()` on `undefined` threw
    // `TypeError: Cannot read properties of undefined (reading 'name')`,
    // which the dispatch wrapper then presented to an operator as the
    // plugin's reason for refusing their config.
    const err = thrownBy(undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toMatch(/Cannot read properties/);
  });

  it("treats an explicit null block as absent, the way core's `if (cfg.pds)` gate always did", () => {
    // `"pds": null` in a config document was skipped by core's own check and
    // then reported by `requirePdsConfig`'s `if (!pds)` as a missing section.
    expect(() => validatePdsConfig(null)).toThrow(
      'config has no "pds" section - add it to config/production.jsonc',
    );
  });

  it('names the offending KEY for a malformed block, never the missing section', () => {
    // The other side of the split: a block that WAS written and is wrong
    // must not be reported as one that was never written.
    for (const raw of [{ name: '' }, { name: 'x', handleResolver: 'http://r' }, 42, 'pds', []]) {
      expect(thrownBy(raw)).toBeInstanceOf(Error);
      expect(String(thrownBy(raw))).toContain('config.pds.');
      expect(String(thrownBy(raw))).not.toContain('has no "pds" section');
    }
    // A present, non-object block keeps the message it has always had - the
    // absent-block guard is narrow, and does not swallow it.
    expect(() => validatePdsConfig(42)).toThrow('config.pds.name is required');
  });

  it('rejects a blank name', () => {
    expect(() => validatePdsConfig({ ...BASE, name: '' })).toThrow('config.pds.name is required');
  });

  it('rejects a whitespace-only name', () => {
    expect(() => validatePdsConfig({ ...BASE, name: '   ' })).toThrow(
      'config.pds.name is required',
    );
  });

  it('accepts a real name', () => {
    expect(validatePdsConfig({ ...BASE, name: 'My Site' })).toEqual({ ...BASE, name: 'My Site' });
  });

  it('rejects a non-URL handleResolver', () => {
    expect(() => validatePdsConfig({ ...BASE, handleResolver: 'nope' })).toThrow(
      'config.pds.handleResolver must be a URL, got "nope"',
    );
  });

  it('rejects an http:// handleResolver', () => {
    expect(() => validatePdsConfig({ ...BASE, handleResolver: 'http://resolver.example' })).toThrow(
      'config.pds.handleResolver must be https, got "http://resolver.example"',
    );
  });

  it('accepts an https:// handleResolver', () => {
    expect(validatePdsConfig({ ...BASE, handleResolver: 'https://resolver.example' })).toEqual({
      ...BASE,
      handleResolver: 'https://resolver.example',
    });
  });

  it('omits the "must be https" check for the non-URL rejection (try/catch ordering)', () => {
    // A non-URL resolver must fail the "must be a URL" check, not fall through
    // to the https check - `new URL(...)` throwing is what selects the message.
    expect(() => validatePdsConfig({ ...BASE, handleResolver: 'nope' })).not.toThrow(
      /must be https/,
    );
  });

  it('rejects a secretName with a character outside the permitted class', () => {
    expect(() => validatePdsConfig({ ...BASE, secretName: 'my site/atproto' })).toThrow(
      'config.pds.secretName has invalid characters: "my site/atproto"',
    );
  });

  it('accepts a secretName built only from the permitted class', () => {
    expect(validatePdsConfig({ ...BASE, secretName: 'My_Site-1/at+proto=2.3@x' })).toEqual({
      ...BASE,
      secretName: 'My_Site-1/at+proto=2.3@x',
    });
  });

  it('accepts a block with no secretName at all, and adds none', () => {
    // An absent `secretName` selects `resolvePdsSecretName`'s
    // `<siteName>/atproto` default; it is not a malformed value, so the
    // character class must not be applied to it. This is also the behaviour
    // the unguarded `RegExp.test(undefined)` had by accident - it coerced to
    // the string "undefined", which matches the class - so narrowing the call
    // had to keep it. `validatePdsConfig` is a validator, not a defaulter: it
    // returns the block as given.
    expect(validatePdsConfig({ name: 'My Site' })).toEqual({ name: 'My Site' });
  });
});

describe('resolvePdsSecretName', () => {
  // A `pds` block legitimately carries no `secretName`: core parses the block
  // through untouched and no longer defaults it, so `PdsConfig.secretName` is
  // optional and this is a plain object literal, not a cast.
  const withoutSecretName: PdsConfig = { name: 'My Site' };
  const withSecretName: PdsConfig = { name: 'My Site', secretName: 'custom/name' };

  it('derives "<siteName>/atproto" when secretName is absent', () => {
    expect(resolvePdsSecretName(withoutSecretName, 'my-site')).toBe('my-site/atproto');
  });

  it('keeps an explicit secretName instead of the default', () => {
    expect(resolvePdsSecretName(withSecretName, 'my-site')).toBe('custom/name');
  });
});
