import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';

/**
 * Lambda MicroVMs control-plane client (`lambda-microvms` API, 2025-09-09).
 *
 * The API is served off the standard Lambda endpoint (`lambda.<region>.amazonaws.com`,
 * SigV4 signing name `lambda`) and is REST-JSON, with operations distinguished by the
 * `/2025-09-09/` path prefix. Shapes below follow the published API reference. The floci
 * emulator does not implement this service, so it is covered by transport mocks in tests.
 */

const API = '/2025-09-09';

const PATHS = {
  images: `${API}/microvm-images`,
  image: (id: string) => `${API}/microvm-images/${encodeURIComponent(id)}`,
  microvms: `${API}/microvms`,
  microvm: (id: string) => `${API}/microvms/${encodeURIComponent(id)}`,
  authToken: (id: string) => `${API}/microvms/${encodeURIComponent(id)}/auth-token`,
};

export interface CreateImageInput {
  name: string;
  codeArtifactUri: string;
  baseImageArn: string;
  buildRoleArn: string;
  /** Baseline memory in GB (converted to minimumMemoryInMiB). */
  memoryGb?: number | undefined;
  logGroupName?: string | undefined;
  description?: string | undefined;
  clientToken?: string | undefined;
  /** Image-level environment variables baked into the snapshot (max 50). */
  environmentVariables?: Record<string, string> | undefined;
  /**
   * Enable lifecycle hooks (listener on the given port). The /run hook is what makes
   * the execution role's credentials available at runtime; the service also requires
   * the /ready hook whenever any hook is enabled.
   */
  hooks?: { port: number } | undefined;
}

export interface MicrovmImage {
  imageArn: string;
  imageName: string;
  state: string;
  imageVersion: string | undefined;
}

export interface RunMicrovmInput {
  imageIdentifier: string;
  executionRoleArn: string;
  /** Idempotency token so a retried launch does not start a second MicroVM. */
  clientToken?: string | undefined;
  /** Only valid when the image has the run hook enabled; omit for hookless images. */
  runHookPayload?: string | undefined;
  maximumDurationInSeconds: number;
  idlePolicy: {
    autoResumeEnabled: boolean;
    maxIdleDurationSeconds: number;
    suspendedDurationSeconds: number;
  };
  ingressNetworkConnectors: string[];
  egressNetworkConnectors: string[];
  logGroupName?: string | undefined;
}

export interface Microvm {
  microvmId: string;
  state: string;
  endpoint: string;
  /** ARN of the image this MicroVM was launched from (scopes cleanup to one stack). */
  imageArn?: string | undefined;
  imageVersion?: string | undefined;
}

interface MicrovmResponse {
  microvmId?: string;
  id?: string;
  state?: string;
  endpoint?: string;
  imageArn?: string;
  imageVersion?: string;
}

function normalizeMicrovm(res: MicrovmResponse): Microvm {
  return {
    microvmId: res.microvmId ?? res.id ?? '',
    state: res.state ?? '',
    endpoint: res.endpoint ?? '',
    ...(res.imageArn ? { imageArn: res.imageArn } : {}),
    ...(res.imageVersion ? { imageVersion: res.imageVersion } : {}),
  };
}

/** Lambda-managed network connector ARNs (region-templated). */
export function networkConnectors(region: string): { allIngress: string; internetEgress: string } {
  return {
    allIngress: `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:ALL_INGRESS`,
    internetEgress: `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`,
  };
}

interface ImageResponse {
  imageArn?: string;
  name?: string;
  state?: string;
  imageVersion?: string;
  latestActiveImageVersion?: string;
}

function normalizeImage(res: ImageResponse): MicrovmImage {
  return {
    imageArn: res.imageArn ?? '',
    imageName: res.name ?? '',
    state: res.state ?? '',
    imageVersion: res.imageVersion ?? res.latestActiveImageVersion,
  };
}

export class MicrovmsClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(
    method: string,
    path: string,
    payload?: object,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const res = await this.client.send({
      service: 'microvms',
      method,
      path,
      ...(query ? { query } : {}),
      headers: { 'content-type': 'application/json' },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private imageBody(input: CreateImageInput): object {
    return {
      codeArtifact: { uri: input.codeArtifactUri },
      baseImageArn: input.baseImageArn,
      buildRoleArn: input.buildRoleArn,
      ...(input.memoryGb !== undefined
        ? { resources: [{ minimumMemoryInMiB: Math.round(input.memoryGb * 1024) }] }
        : {}),
      ...(input.logGroupName ? { logging: { cloudWatch: { logGroup: input.logGroupName } } } : {}),
      ...(input.environmentVariables ? { environmentVariables: input.environmentVariables } : {}),
      ...(input.hooks
        ? {
            hooks: {
              port: input.hooks.port,
              microvmHooks: { run: 'ENABLED', runTimeoutInSeconds: 60 },
              microvmImageHooks: { ready: 'ENABLED', readyTimeoutInSeconds: 120 },
            },
          }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.clientToken !== undefined ? { clientToken: input.clientToken } : {}),
    };
  }

  async createImage(input: CreateImageInput): Promise<MicrovmImage> {
    const body = { name: input.name, ...this.imageBody(input) };
    return normalizeImage(await this.call<ImageResponse>('POST', PATHS.images, body));
  }

  async updateImage(id: string, input: CreateImageInput): Promise<MicrovmImage> {
    // A PUT is idempotent on the image itself, so no clientToken is needed — and reusing one
    // across separate update attempts triggers "clientToken used with different parameters".
    const { clientToken, ...body } = this.imageBody(input) as Record<string, unknown>;
    void clientToken;
    return normalizeImage(await this.call<ImageResponse>('PUT', PATHS.image(id), body));
  }

  async getImage(id: string): Promise<MicrovmImage | undefined> {
    try {
      return normalizeImage(await this.call<ImageResponse>('GET', PATHS.image(id)));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  async deleteImage(id: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.image(id));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async runMicrovm(input: RunMicrovmInput): Promise<Microvm> {
    const body = {
      imageIdentifier: input.imageIdentifier,
      executionRoleArn: input.executionRoleArn,
      idlePolicy: input.idlePolicy,
      ingressNetworkConnectors: input.ingressNetworkConnectors,
      egressNetworkConnectors: input.egressNetworkConnectors,
      maximumDurationInSeconds: input.maximumDurationInSeconds,
      ...(input.clientToken ? { clientToken: input.clientToken } : {}),
      ...(input.runHookPayload ? { runHookPayload: input.runHookPayload } : {}),
      ...(input.logGroupName ? { logging: { cloudWatch: { logGroup: input.logGroupName } } } : {}),
    };
    return this.call<Microvm>('POST', PATHS.microvms, body);
  }

  async getMicrovm(id: string): Promise<Microvm | undefined> {
    try {
      return await this.call<Microvm>('GET', PATHS.microvm(id));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /**
   * MicroVMs in the account (paginated), for quota accounting and cleanup. Pass
   * `imageIdentifier` to scope the list to one builder image server-side.
   *
   * `maxResults` is always sent: the ListMicrovms operation defines it as a defaulted
   * query parameter, and the service normalizes a missing default into the request before
   * validating the SigV4 signature — so omitting it produces an intermittent
   * SignatureDoesNotMatch that GetMicrovm/DeleteMicrovm (no query params) never hit.
   */
  async listMicrovms(
    opts: { imageIdentifier?: string | undefined; maxResults?: number | undefined } = {},
  ): Promise<Microvm[]> {
    const all: Microvm[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string | number | undefined> = {
        maxResults: opts.maxResults ?? 50, // service cap; larger values are rejected (400)
        ...(opts.imageIdentifier ? { imageIdentifier: opts.imageIdentifier } : {}),
        ...(token ? { nextToken: token } : {}),
      };
      // The ListMicrovms response nests the collection under `items` (with `microvms` kept
      // as a defensive fallback), each item carrying microvmId/state/imageArn.
      const page = await this.call<{
        items?: MicrovmResponse[];
        microvms?: MicrovmResponse[];
        nextToken?: string;
      }>('GET', PATHS.microvms, undefined, query);
      for (const item of page.items ?? page.microvms ?? []) all.push(normalizeMicrovm(item));
      token = page.nextToken;
    } while (token);
    return all;
  }

  async terminateMicrovm(id: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.microvm(id));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async createAuthToken(id: string, expirationInMinutes: number): Promise<string> {
    const out = await this.call<{ authToken?: Record<string, string> }>(
      'POST',
      PATHS.authToken(id),
      {
        allowedPorts: [{ allPorts: {} }],
        expirationInMinutes,
      },
    );
    return out.authToken?.['X-aws-proxy-auth'] ?? '';
  }
}
