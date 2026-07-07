/**
 * Endpoint resolution for AWS services.
 *
 * When an endpoint override is present (config or `AWS_ENDPOINT_URL`, e.g. the
 * floci emulator on http://localhost:4566) every service is routed to that single
 * origin. Otherwise the canonical per-service AWS hostname is used.
 */

export interface ResolvedEndpoint {
  protocol: 'http:' | 'https:';
  host: string;
  /** Signing region — some services (iam, cloudfront) are global and sign as us-east-1. */
  signingRegion: string;
  /** True when talking to an override origin (floci/localstack); forces S3 path-style. */
  override: boolean;
}

/** Service keys understood by the resolver. The value is the SigV4 signing name. */
export const SIGNING_NAMES = {
  s3: 's3',
  sts: 'sts',
  iam: 'iam',
  logs: 'logs',
  acm: 'acm',
  cloudfront: 'cloudfront',
  route53: 'route53',
  // Lambda MicroVMs is served off the standard Lambda endpoint (host + signing name
  // "lambda"); operations are distinguished by the /2025-09-09/ path prefix.
  microvms: 'lambda',
  secretsmanager: 'secretsmanager',
} as const;

export type ServiceKey = keyof typeof SIGNING_NAMES;

/** Services that are global; they always sign in us-east-1. */
const GLOBAL_SERVICES = new Set<ServiceKey>(['iam', 'cloudfront', 'route53']);

export function resolveEndpoint(
  service: ServiceKey,
  region: string,
  override: string | undefined,
): ResolvedEndpoint {
  const signingRegion = GLOBAL_SERVICES.has(service) ? 'us-east-1' : region;

  if (override) {
    const url = new URL(override);
    return {
      protocol: url.protocol === 'http:' ? 'http:' : 'https:',
      host: url.host,
      signingRegion,
      override: true,
    };
  }

  return {
    protocol: 'https:',
    host: canonicalHost(service, region),
    signingRegion,
    override: false,
  };
}

function canonicalHost(service: ServiceKey, region: string): string {
  switch (service) {
    case 'iam':
      return 'iam.amazonaws.com';
    case 'cloudfront':
      return 'cloudfront.amazonaws.com';
    case 'route53':
      return 'route53.amazonaws.com';
    case 's3':
      return `s3.${region}.amazonaws.com`;
    case 'microvms':
      return `lambda.${region}.amazonaws.com`;
    default:
      return `${service}.${region}.amazonaws.com`;
  }
}
