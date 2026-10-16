import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export type CredentialProvider = () => Promise<AwsCredentials>;

/** What the SDK's providers resolve: credentials, optionally with an expiry. */
interface SdkCredentials extends AwsCredentials {
  expiration?: Date | undefined;
}

type SdkCredentialProvider = () => Promise<SdkCredentials>;

/**
 * The SDK provider factories and clock {@link createCredentialProvider} builds
 * from. Injectable so a test can assert which provider a profile selects
 * without reading the operator's real AWS files.
 */
export interface CredentialSources {
  fromIni(init: { profile: string }): SdkCredentialProvider;
  fromNodeProviderChain(): SdkCredentialProvider;
  now(): number;
}

const SDK_SOURCES: CredentialSources = {
  fromIni,
  fromNodeProviderChain: () => fromNodeProviderChain(),
  now: () => Date.now(),
};

/**
 * Credentials this close to expiry are refreshed rather than reused, so a
 * request signed with them does not expire in flight.
 */
const EXPIRY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Raised when the credential provider itself fails - no credentials, an
 * expired SSO or console session, a failing `credential_process` - as opposed
 * to AWS rejecting a signed request. The SDK's own error is kept as `cause`.
 */
export class AwsCredentialsError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'AwsCredentialsError';
  }
}

/** Reuse resolved credentials until they near expiry; a failure is never cached. */
function memoizeUntilExpiry(
  provider: SdkCredentialProvider,
  now: () => number,
): SdkCredentialProvider {
  let cached: SdkCredentials | undefined;
  let inFlight: Promise<SdkCredentials> | undefined;
  const isFresh = (creds: SdkCredentials) =>
    creds.expiration === undefined || creds.expiration.getTime() - now() > EXPIRY_WINDOW_MS;
  return () => {
    if (cached && isFresh(cached)) return Promise.resolve(cached);
    inFlight ??= provider()
      .then((creds) => {
        cached = creds;
        return creds;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

/**
 * Resolve AWS credentials. With a `profile`, the SDK's `fromIni` resolves that
 * named profile exactly as the AWS CLI does (SSO, `login_session`,
 * `credential_process`, `source_profile` role chains) and environment keys are
 * never consulted. Without one, the standard Node provider chain (environment,
 * shared files, SSO, container/instance metadata) applies. Both are memoized
 * until their credentials near expiry.
 *
 * When an endpoint override is in play (floci/localstack) and resolution
 * fails, fall back to the environment's keys or the emulator's dummy
 * `test/test` pair so signing still succeeds - floci does not validate
 * signatures. Any other failure is raised as {@link AwsCredentialsError}.
 */
export function createCredentialProvider(
  opts: {
    override?: boolean | undefined;
    profile?: string | null | undefined;
  },
  sources: CredentialSources = SDK_SOURCES,
): CredentialProvider {
  const resolve = opts.profile
    ? memoizeUntilExpiry(sources.fromIni({ profile: opts.profile }), sources.now)
    : sources.fromNodeProviderChain();
  return async () => {
    try {
      const creds = await resolve();
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
      throw new AwsCredentialsError(err);
    }
  };
}

/** A fixed-credentials provider, useful for tests. */
export function staticCredentials(creds: AwsCredentials): CredentialProvider {
  return () => Promise.resolve(creds);
}
