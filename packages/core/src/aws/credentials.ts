import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export type CredentialProvider = () => Promise<AwsCredentials>;

/**
 * Resolve ambient AWS credentials (env vars, shared config/credentials files, SSO,
 * container/instance metadata) via the standard Node provider chain.
 *
 * When an endpoint override is in play (floci/localstack) and no real credentials
 * are configured, fall back to the emulator's dummy `test/test` pair so signing
 * still succeeds — floci does not validate signatures.
 */
export function createCredentialProvider(opts: {
  override?: boolean | undefined;
}): CredentialProvider {
  const chain = fromNodeProviderChain();
  return async () => {
    try {
      const creds = await chain();
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      };
    } catch (err) {
      if (opts.override) {
        return {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        };
      }
      throw err;
    }
  };
}

/** A fixed-credentials provider, useful for tests. */
export function staticCredentials(creds: AwsCredentials): CredentialProvider {
  return () => Promise.resolve(creds);
}
