import { AcmClient } from './aws/acm.js';
import { CloudFrontClient } from './aws/cloudfront.js';
import { createCredentialProvider, type CredentialProvider } from './aws/credentials.js';
import { IamClient } from './aws/iam.js';
import { LogsClient } from './aws/logs.js';
import { MicrovmsClient } from './aws/microvms.js';
import { Route53Client } from './aws/route53.js';
import { S3Client } from './aws/s3.js';
import { SecretsManagerClient } from './aws/secretsmanager.js';
import { SigningClient, type Transport } from './aws/signer.js';
import { StsClient } from './aws/sts.js';

export interface ClientBundleOptions {
  region: string;
  /** Endpoint override (config or AWS_ENDPOINT_URL); routes all services to one origin. */
  endpointOverride?: string | undefined;
  credentials?: CredentialProvider | undefined;
  transport?: Transport | undefined;
}

export interface AwsClients {
  region: string;
  signing: SigningClient;
  s3: S3Client;
  sts: StsClient;
  iam: IamClient;
  logs: LogsClient;
  /**
   * Logs client pinned to us-east-1 for CloudFront vended log delivery —
   * PutDeliverySource with the CloudFront LogType exists only there, the same
   * global-service quirk as CloudFront's ACM certificates.
   */
  logsUsEast1: LogsClient;
  acm: AcmClient;
  cloudfront: CloudFrontClient;
  route53: Route53Client;
  microvms: MicrovmsClient;
  secrets: SecretsManagerClient;
}

/** Build the full set of service clients that share one signing transport. */
export function createClients(opts: ClientBundleOptions): AwsClients {
  const endpointOverride = opts.endpointOverride ?? process.env.AWS_ENDPOINT_URL;
  const credentials =
    opts.credentials ?? createCredentialProvider({ override: Boolean(endpointOverride) });

  const base = {
    endpointOverride,
    credentials,
    ...(opts.transport ? { transport: opts.transport } : {}),
  };
  const signing = new SigningClient({ region: opts.region, ...base });
  // ACM for CloudFront must be us-east-1 regardless of the primary region.
  const usEast1 = new SigningClient({ region: 'us-east-1', ...base });

  return {
    region: opts.region,
    signing,
    s3: new S3Client(signing),
    sts: new StsClient(signing),
    iam: new IamClient(signing),
    logs: new LogsClient(signing),
    logsUsEast1: new LogsClient(usEast1),
    acm: new AcmClient(usEast1),
    cloudfront: new CloudFrontClient(usEast1),
    route53: new Route53Client(usEast1),
    microvms: new MicrovmsClient(signing),
    secrets: new SecretsManagerClient(signing),
  };
}
