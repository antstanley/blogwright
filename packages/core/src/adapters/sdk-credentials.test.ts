/*
 * `createCredentialProvider` driven through the real AWS SDK providers and
 * real files, because the defects it guards against live in the SDK: its
 * process-wide shared-file cache, the order its default chain tries sources,
 * and the chain reading `AWS_PROFILE` from the process itself. It sits with
 * the adapters because it writes the files the SDK reads with node:fs.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  it('holds a default-profile selection to [default] whatever AWS_PROFILE says', async () => {
    await writeFile(
      configFile,
      '[default]\naws_access_key_id = AKIDDEFAULT\naws_secret_access_key = secret\n' +
        '[profile personal]\naws_access_key_id = AKIDPERSONAL\naws_secret_access_key = secret\n',
    );
    vi.stubEnv('AWS_PROFILE', 'personal');
    const held = createCredentialProvider({ selection: { kind: 'default-profile' } });
    expect((await held()).accessKeyId).toBe('AKIDDEFAULT');
    const ambient = createCredentialProvider({ selection: { kind: 'chain' } });
    expect((await ambient()).accessKeyId).toBe('AKIDPERSONAL');
  });

  it('uses a container credentials endpoint over a [default] profile', async () => {
    await writeFile(
      configFile,
      '[default]\naws_access_key_id = AKIDDEFAULT\naws_secret_access_key = secret\n',
    );
    const server = await serveContainerCredentials('AKIDCONTAINER');
    try {
      const { port } = server.address() as AddressInfo;
      vi.stubEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI', `http://127.0.0.1:${port}/creds`);
      const provider = createCredentialProvider({ selection: { kind: 'environment' } });
      expect((await provider()).accessKeyId).toBe('AKIDCONTAINER');
    } finally {
      server.close();
    }
  });
});

/** A loopback container credentials endpoint, as ECS and EKS Pod Identity serve one. */
async function serveContainerCredentials(accessKeyId: string): Promise<Server> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        AccessKeyId: accessKeyId,
        SecretAccessKey: 'secret',
        Token: 'token',
        Expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
