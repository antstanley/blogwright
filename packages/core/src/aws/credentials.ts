// The individual provider packages, not the `@aws-sdk/credential-providers`
// umbrella: it re-exports these same functions but also installs the Cognito
// provider and its client, which nothing here uses.
import { fromEnv } from '@aws-sdk/credential-provider-env';
import { fromHttp } from '@aws-sdk/credential-provider-http';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { defaultProvider as fromNodeProviderChain } from '@aws-sdk/credential-provider-node';
import { fromTokenFile } from '@aws-sdk/credential-provider-web-identity';
import { fromContainerMetadata } from '@smithy/credential-provider-imds';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export type CredentialProvider = () => Promise<AwsCredentials>;

/**
 * Which credentials to resolve: a named profile from the shared AWS files,
 * only the credentials exported into the environment (access keys, a web
 * identity token file, a container credentials endpoint), the default Node
 * provider chain over the shared files' `default` profile whatever
 * `AWS_PROFILE` says (`default-profile`, for a caller that has already
 * decided `AWS_PROFILE` does not apply), or the SDK's ambient default chain,
 * which reads `AWS_PROFILE` itself (`chain`).
 */
export type CredentialSelection =
  | { kind: 'profile'; name: string }
  | { kind: 'environment' }
  | { kind: 'default-profile' }
  | { kind: 'chain' };

/** The profile the default chain reads from the shared files when `AWS_PROFILE` is unset. */
const DEFAULT_CHAIN_PROFILE = 'default';

/** What the SDK's providers resolve: credentials, optionally with an expiry. */
interface SdkCredentials extends AwsCredentials {
  expiration?: Date | undefined;
}

type SdkCredentialProvider = () => Promise<SdkCredentials>;

/**
 * Whether the SDK may reuse shared-file contents it read earlier in the
 * process. Always false here: the SDK caches `~/.aws/config` and the console
 * login token for the life of the process, so a provider built after
 * `aws login` rewrote them would otherwise resolve the stale contents.
 */
interface SharedFileReads {
  ignoreCache: boolean;
}

/**
 * The SDK provider factories and clock {@link createCredentialProvider} builds
 * from. Injectable so a test can assert which provider a selection uses
 * without reading the operator's real AWS files or environment.
 */
export interface CredentialSources {
  fromIni(init: { profile: string } & SharedFileReads): SdkCredentialProvider;
  fromEnvironment(): SdkCredentialProvider;
  fromNodeProviderChain(init: { profile?: string } & SharedFileReads): SdkCredentialProvider;
  now(): number;
}

/** Try each provider in order; the first to resolve wins, else the last failure is raised. */
function firstResolving(providers: readonly SdkCredentialProvider[]): SdkCredentialProvider {
  return async () => {
    let failure: unknown = new Error('no credentials are exported in the environment');
    for (const provider of providers) {
      try {
        return await provider();
      } catch (err) {
        failure = err;
      }
    }
    throw failure;
  };
}

/**
 * Only the exported credentials, in the order the Node chain tries them:
 * access keys, then a web identity token file, then a container credentials
 * endpoint. Unlike the full chain, a `[default]` profile in the shared files
 * is never consulted, so exported credentials always win.
 */
function fromExportedEnvironment(env: NodeJS.ProcessEnv): SdkCredentialProvider {
  const providers: SdkCredentialProvider[] = [];
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) providers.push(fromEnv());
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE) providers.push(fromTokenFile());
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    providers.push(fromHttp(), fromContainerMetadata());
  }
  return firstResolving(providers);
}

const SDK_SOURCES: CredentialSources = {
  fromIni,
  fromEnvironment: () => fromExportedEnvironment(process.env),
  fromNodeProviderChain: (init) => fromNodeProviderChain(init),
  now: () => Date.now(),
};

const SHARED_FILE_READS: SharedFileReads = { ignoreCache: true };

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

/** The SDK provider a selection resolves through, before memoization. */
function selectedProvider(
  selection: CredentialSelection,
  sources: CredentialSources,
): SdkCredentialProvider {
  switch (selection.kind) {
    case 'profile':
      return sources.fromIni({ profile: selection.name, ...SHARED_FILE_READS });
    case 'environment':
      return sources.fromEnvironment();
    case 'default-profile':
      return sources.fromNodeProviderChain({
        profile: DEFAULT_CHAIN_PROFILE,
        ...SHARED_FILE_READS,
      });
    case 'chain':
      return sources.fromNodeProviderChain(SHARED_FILE_READS);
  }
}

/**
 * Resolve AWS credentials. A `profile` selection resolves that named profile
 * with the SDK's `fromIni`, exactly as the AWS CLI does (SSO,
 * `login_session`, `credential_process`, `source_profile` role chains), and
 * never consults environment keys. An `environment` selection uses only the
 * exported credentials. The default `chain` is the standard Node provider
 * chain (environment, shared files, SSO, container/instance metadata), and
 * `default-profile` is that chain held to the `default` profile, so a
 * stray `AWS_PROFILE` cannot redirect it. Each
 * provider reads the shared files afresh and is memoized until its
 * credentials near expiry.
 *
 * When an endpoint override is in play (floci/localstack) and resolution
 * fails, fall back to the environment's keys or the emulator's dummy
 * `test/test` pair so signing still succeeds - floci does not validate
 * signatures. Any other failure is raised as {@link AwsCredentialsError}.
 */
export function createCredentialProvider(
  opts: {
    override?: boolean | undefined;
    selection?: CredentialSelection | undefined;
  },
  sources: CredentialSources = SDK_SOURCES,
): CredentialProvider {
  const resolve = memoizeUntilExpiry(
    selectedProvider(opts.selection ?? { kind: 'chain' }, sources),
    sources.now,
  );
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
