import { describe, expect, it } from 'vitest';

import {
  AwsCredentialsError,
  createCredentialProvider,
  type CredentialSources,
} from './credentials.js';

interface Recorded {
  sources: CredentialSources;
  iniProfiles: string[];
  ignoreCache: boolean[];
  chainCalls: number;
  chainProfiles: (string | undefined)[];
  environmentCalls: number;
  resolutions: number;
  clock: { now: number };
}

/** Fake SDK sources: each resolution hands out a fresh key, so reuse is visible. */
function fakeSources(opts: { expiresInMs?: number; fail?: boolean } = {}): Recorded {
  const clock = { now: 1_000_000 };
  const recorded: Recorded = {
    iniProfiles: [],
    ignoreCache: [],
    chainCalls: 0,
    chainProfiles: [],
    environmentCalls: 0,
    resolutions: 0,
    clock,
    sources: {
      fromIni: ({ profile, ignoreCache }) => {
        recorded.iniProfiles.push(profile);
        recorded.ignoreCache.push(ignoreCache);
        return resolve;
      },
      fromEnvironment: () => {
        recorded.environmentCalls += 1;
        return resolve;
      },
      fromNodeProviderChain: ({ profile, ignoreCache }) => {
        recorded.chainCalls += 1;
        recorded.chainProfiles.push(profile);
        recorded.ignoreCache.push(ignoreCache);
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

const PROFILE_P = { selection: { kind: 'profile', name: 'p' } } as const;

describe('createCredentialProvider', () => {
  it('selects fromIni for a named profile', async () => {
    const fake = fakeSources();
    const selection = { kind: 'profile', name: 'mysite-prod' } as const;
    await createCredentialProvider({ selection }, fake.sources)();
    expect(fake.iniProfiles).toEqual(['mysite-prod']);
    expect(fake.chainCalls + fake.environmentCalls).toBe(0);
  });

  it('selects only the exported credentials for an environment selection', async () => {
    const fake = fakeSources();
    await createCredentialProvider({ selection: { kind: 'environment' } }, fake.sources)();
    expect(fake.environmentCalls).toBe(1);
    expect(fake.iniProfiles).toEqual([]);
    expect(fake.chainCalls).toBe(0);
  });

  it('selects the node provider chain by default', async () => {
    for (const selection of [undefined, { kind: 'chain' } as const]) {
      const fake = fakeSources();
      await createCredentialProvider({ selection }, fake.sources)();
      expect(fake.iniProfiles).toEqual([]);
      expect(fake.chainCalls).toBe(1);
    }
  });

  it('holds the chain to the default profile for a default-profile selection', async () => {
    const fake = fakeSources();
    await createCredentialProvider({ selection: { kind: 'default-profile' } }, fake.sources)();
    await createCredentialProvider({ selection: { kind: 'chain' } }, fake.sources)();
    expect(fake.chainProfiles).toEqual(['default', undefined]);
  });

  it('never lets the SDK reuse shared files it read earlier', async () => {
    const fake = fakeSources();
    await createCredentialProvider({ selection: { kind: 'profile', name: 'p' } }, fake.sources)();
    await createCredentialProvider({}, fake.sources)();
    expect(fake.ignoreCache).toEqual([true, true]);
  });

  it('memoizes profile credentials until they near expiry', async () => {
    const fake = fakeSources({ expiresInMs: 60 * 60 * 1000 });
    const provider = createCredentialProvider(PROFILE_P, fake.sources);
    expect((await provider()).accessKeyId).toBe('AKIA1');
    expect((await provider()).accessKeyId).toBe('AKIA1');
    fake.clock.now += 56 * 60 * 1000;
    expect((await provider()).accessKeyId).toBe('AKIA2');
  });

  it('raises a provider failure as AwsCredentialsError, keeping the message', async () => {
    const fake = fakeSources({ fail: true });
    const failure = createCredentialProvider(PROFILE_P, fake.sources)();
    await expect(failure).rejects.toBeInstanceOf(AwsCredentialsError);
    await expect(failure).rejects.toThrow('The SSO session associated with this profile');
  });

  it('does not cache a failure', async () => {
    const fake = fakeSources({ fail: true });
    const provider = createCredentialProvider(PROFILE_P, fake.sources);
    await expect(provider()).rejects.toThrow();
    await expect(provider()).rejects.toThrow();
    expect(fake.resolutions).toBe(2);
  });

  it('falls back to emulator credentials under an override, for every selection', async () => {
    for (const selection of [PROFILE_P.selection, { kind: 'environment' } as const, undefined]) {
      const fake = fakeSources({ fail: true });
      const creds = await createCredentialProvider({ override: true, selection }, fake.sources)();
      expect(creds.accessKeyId).toBe(process.env.AWS_ACCESS_KEY_ID ?? 'test');
    }
  });
});
