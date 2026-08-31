import type { PdsConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { resolvePdsSecretName, validatePdsConfig } from './config.js';

/** A minimally valid `pds` block, spread over in each test. */
const BASE = { name: 'My Site', secretName: 'my-site/atproto' };

describe('validatePdsConfig', () => {
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
