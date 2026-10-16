import { describe, expect, it } from 'vitest';

import {
  AwsCredentialsError,
  createCredentialProvider,
  type CredentialSources,
} from './credentials.js';

interface Recorded {
  sources: CredentialSources;
  iniProfiles: string[];
  chainCalls: number;
  resolutions: number;
  clock: { now: number };
}

/** Fake SDK sources: each resolution hands out a fresh key, so reuse is visible. */
function fakeSources(opts: { expiresInMs?: number; fail?: boolean } = {}): Recorded {
  const clock = { now: 1_000_000 };
  const recorded: Recorded = {
    iniProfiles: [],
    chainCalls: 0,
    resolutions: 0,
    clock,
    sources: {
      fromIni: ({ profile }) => {
        recorded.iniProfiles.push(profile);
        return resolve;
      },
      fromNodeProviderChain: () => {
        recorded.chainCalls += 1;
        return resolve;
      },
      now: () => clock.now,
    },
  };
  async function resolve() {
    recorded.resolutions += 1;
    if (opts.fail) throw new Error('The SSO session associated with this profile has expired.');
    return {
      accessKeyId: `AKIA${recorded.resolutions}`,
      secretAccessKey: 'secret',
      ...(opts.expiresInMs === undefined
        ? {}
        : { expiration: new Date(clock.now + opts.expiresInMs) }),
    };
  }
  return recorded;
}

describe('createCredentialProvider', () => {
  it('selects fromIni for a named profile', async () => {
    const fake = fakeSources();
    await createCredentialProvider({ profile: 'mysite-prod' }, fake.sources)();
    expect(fake.iniProfiles).toEqual(['mysite-prod']);
    expect(fake.chainCalls).toBe(0);
  });

  it('selects the node provider chain without a profile', async () => {
    for (const profile of [undefined, null]) {
      const fake = fakeSources();
      await createCredentialProvider({ profile }, fake.sources)();
      expect(fake.iniProfiles).toEqual([]);
      expect(fake.chainCalls).toBe(1);
    }
  });

  it('memoizes profile credentials until they near expiry', async () => {
    const fake = fakeSources({ expiresInMs: 60 * 60 * 1000 });
    const provider = createCredentialProvider({ profile: 'p' }, fake.sources);
    expect((await provider()).accessKeyId).toBe('AKIA1');
    expect((await provider()).accessKeyId).toBe('AKIA1');
    fake.clock.now += 56 * 60 * 1000;
    expect((await provider()).accessKeyId).toBe('AKIA2');
  });

  it('raises a provider failure as AwsCredentialsError, keeping the message', async () => {
    const fake = fakeSources({ fail: true });
    const failure = createCredentialProvider({ profile: 'p' }, fake.sources)();
    await expect(failure).rejects.toBeInstanceOf(AwsCredentialsError);
    await expect(failure).rejects.toThrow('The SSO session associated with this profile');
  });

  it('does not cache a failure', async () => {
    const fake = fakeSources({ fail: true });
    const provider = createCredentialProvider({ profile: 'p' }, fake.sources);
    await expect(provider()).rejects.toThrow();
    await expect(provider()).rejects.toThrow();
    expect(fake.resolutions).toBe(2);
  });

  it('falls back to emulator credentials under an override, for both providers', async () => {
    for (const profile of ['p', undefined]) {
      const fake = fakeSources({ fail: true });
      const creds = await createCredentialProvider({ override: true, profile }, fake.sources)();
      expect(creds.accessKeyId).toBe(process.env.AWS_ACCESS_KEY_ID ?? 'test');
    }
  });
});
