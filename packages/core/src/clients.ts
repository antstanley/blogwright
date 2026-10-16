import { AcmClient } from './aws/acm.js';
import { CloudFrontClient } from './aws/cloudfront.js';
import { createCredentialProvider, type CredentialProvider } from './aws/credentials.js';
import { IamClient } from './aws/iam.js';
import { LambdaWebClient } from './aws/lambda-web.js';
import { LogsClient } from './aws/logs.js';
import { MicrovmsClient } from './aws/microvms.js';
import { Route53Client } from './aws/route53.js';
import { S3Client } from './aws/s3.js';
import { SecretsManagerClient } from './aws/secretsmanager.js';
import { SigningClient, type Transport } from './aws/signer.js';
import { StsClient } from './aws/sts.js';

export interface ClientBundleOptions {
  region: string;
  /**
   * Endpoint override; routes all services to one origin. When the key is
   * omitted, `AWS_ENDPOINT_URL` applies; passing it (even as undefined) means
   * the caller already decided, so the environment is not consulted.
   */
  endpointOverride?: string | undefined;
  /**
   * Named profile from the shared AWS files, resolved with `fromIni`; absent
   * or null uses the default Node provider chain. Ignored when `credentials`
   * is supplied.
   */
  profile?: string | null | undefined;
  credentials?: CredentialProvider | undefined;
  transport?: Transport | undefined;
}

export interface AwsClients {
  region: string;
  signing: SigningClient;
  /**
   * The us-east-1 signer, exposed so a plugin can build clients for services
   * core does not enumerate over the credentials, endpoint override and
   * transport the host already resolved - a `SigningClient`'s region is fixed
   * at construction and both of those are private, so a hand-built one would
   * re-resolve credentials and ignore a transport a test injected. Core builds
   * no additional client from it: `logsUsEast1`, `acm`, `cloudfront` and
   * `route53` below are the only ones it signs for.
   */
  signingUsEast1: SigningClient;
  /**
   * The credential provider both signers hold, already bound to the selected
   * profile. Anything that needs raw credentials (analytics's DuckDB secret)
   * reads this rather than building its own provider, so `--profile` reaches
   * every local AWS call.
   */
  credentials: CredentialProvider;
  s3: S3Client;
  sts: StsClient;
  iam: IamClient;
  logs: LogsClient;
  /**
   * Logs client pinned to us-east-1 for CloudFront vended log delivery -
   * PutDeliverySource with the CloudFront LogType exists only there, the same
   * global-service quirk as CloudFront's ACM certificates.
   */
  logsUsEast1: LogsClient;
  acm: AcmClient;
  cloudfront: CloudFrontClient;
  route53: Route53Client;
  microvms: MicrovmsClient;
  /** Lambda Web Function control plane (SSR mode). */
  lambdaWeb: LambdaWebClient;
  secrets: SecretsManagerClient;
}

/** Build the full set of service clients that share one signing transport. */
export function createClients(opts: ClientBundleOptions): AwsClients {
  const endpointOverride =
    'endpointOverride' in opts ? opts.endpointOverride : process.env.AWS_ENDPOINT_URL;
  const credentials =
    opts.credentials ??
    createCredentialProvider({ override: Boolean(endpointOverride), profile: opts.profile });

  const base = {
    endpointOverride,
    credentials,
    ...(opts.transport ? { transport: opts.transport } : {}),
  };
  const signing = new SigningClient({ region: opts.region, ...base });
  // ACM for CloudFront must be us-east-1 regardless of the primary region; the
  // same signer is handed out as `signingUsEast1` for plugin-supplied services.
  const usEast1 = new SigningClient({ region: 'us-east-1', ...base });

  return {
    region: opts.region,
    signing,
    signingUsEast1: usEast1,
    credentials,
    s3: new S3Client(signing),
    sts: new StsClient(signing),
    iam: new IamClient(signing),
    logs: new LogsClient(signing),
    logsUsEast1: new LogsClient(usEast1),
    acm: new AcmClient(usEast1),
    cloudfront: new CloudFrontClient(usEast1),
    route53: new Route53Client(usEast1),
    microvms: new MicrovmsClient(signing),
    lambdaWeb: new LambdaWebClient(signing),
    secrets: new SecretsManagerClient(signing),
  };
}
