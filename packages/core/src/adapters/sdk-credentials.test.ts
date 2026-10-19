/*
 * `createCredentialProvider` driven through the real AWS SDK providers and
 * real files, because the defects it guards against live in the SDK: its
 * process-wide shared-file cache, and the order its default chain tries
 * sources. It sits with the adapters because it writes the files the SDK
 * reads with node:fs.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AwsCredentialsError, createCredentialProvider } from '../aws/credentials.js';

describe('createCredentialProvider against the SDK', () => {
  let dir: string;
  let configFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blogwright-credentials-'));
    configFile = join(dir, 'config');
    vi.stubEnv('AWS_CONFIG_FILE', configFile);
    vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(dir, 'credentials'));
    for (const name of [
      'AWS_PROFILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_WEB_IDENTITY_TOKEN_FILE',
      'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
      'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    ]) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the profile afresh when rebuilt after a sign-in rewrote the files', async () => {
    const selection = { kind: 'profile', name: 'site' } as const;
    await writeFile(configFile, '[profile site]\nregion = eu-west-2\n');
    await expect(createCredentialProvider({ selection })()).rejects.toBeInstanceOf(
      AwsCredentialsError,
    );
    await writeFile(
      configFile,
      '[profile site]\naws_access_key_id = AKIDSIGNEDIN\naws_secret_access_key = secret\n',
    );
    expect((await createCredentialProvider({ selection })()).accessKeyId).toBe('AKIDSIGNEDIN');
  });

  it('never falls back to the [default] profile for an environment selection', async () => {
    await writeFile(
      configFile,
      '[default]\naws_access_key_id = AKIDDEFAULT\naws_secret_access_key = secret\n',
    );
    const provider = createCredentialProvider({ selection: { kind: 'environment' } });
    await expect(provider()).rejects.toThrow('no credentials are exported');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDEXPORTED');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');
    const exported = createCredentialProvider({ selection: { kind: 'environment' } });
    expect((await exported()).accessKeyId).toBe('AKIDEXPORTED');
  });
});
