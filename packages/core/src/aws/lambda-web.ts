import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import type { ResourceTags } from '../tags.js';

/**
 * Lambda Web Functions control-plane client (`lambda-web` API, 2025-03-07).
 *
 * Like MicroVMs, the API is served off the standard Lambda endpoint
 * (`lambda.<region>.amazonaws.com`, SigV4 signing name `lambda`) and is
 * REST-JSON, with operations distinguished by the `/2025-03-07/` path prefix.
 * Every path, verb and member below is taken from the published service model
 * (`botocore/data/lambda-web/2025-03-07/service-2.json`), not inferred: create
 * and list share `/web-functions` with PUT and POST, revision and endpoint
 * lists are POST `list-revisions`/`list-endpoints`, and a revision's code,
 * runtime and settings travel nested under `buildConfig`/`serviceConfig`.
 *
 * The client is deliberately thin: it creates, reads, lists and deletes web
 * functions, their revisions and their endpoints, and passes the revision
 * `description` (the CLI's fingerprint) through untouched. Revision-state
 * polling belongs to the CLI (`pollUntil`), not here.
 */

const API = '/2025-03-07';

const PATHS = {
  functions: `${API}/web-functions`,
  function: (name: string) => `${API}/web-functions/${encodeURIComponent(name)}`,
  revisions: (name: string) => `${API}/web-functions/${encodeURIComponent(name)}/revisions`,
  revision: (name: string, revisionId: string) =>
    `${API}/web-functions/${encodeURIComponent(name)}/revisions/${encodeURIComponent(revisionId)}`,
  listRevisions: (name: string) =>
    `${API}/web-functions/${encodeURIComponent(name)}/list-revisions`,
  endpoints: (name: string) => `${API}/web-functions/${encodeURIComponent(name)}/endpoints`,
  endpoint: (name: string, endpointName: string) =>
    `${API}/web-functions/${encodeURIComponent(name)}/endpoints/${encodeURIComponent(endpointName)}`,
  listEndpoints: (name: string) =>
    `${API}/web-functions/${encodeURIComponent(name)}/list-endpoints`,
  resourcePolicy: (resourceArn: string) =>
    `${API}/resource-policy/${encodeURIComponent(resourceArn)}`,
};

/** The deployment artifact a revision pins, as `codeConfig.s3Object`. */
export interface WebFunctionS3Object {
  bucket: string;
  key: string;
  /** Immutable object version; the pin that makes a revision reproducible. */
  versionId?: string | undefined;
}

/** A revision's build configuration: where the code is and what runs it. */
export interface WebFunctionBuildConfig {
  codeConfig: { s3Object: WebFunctionS3Object };
  runtimeConfig: { runtime: string };
}

/** A revision's service configuration: the role, limits, env and logging. */
export interface WebFunctionServiceConfig {
  executionRoleArn: string;
  timeoutSeconds?: number | undefined;
  maxConcurrencyPerEnvironment?: number | undefined;
  /**
   * Literal values only. The entry point travels here as
   * `AWS_LAMBDA_NODEJS_ENTRYPOINT` when it is not the runtime's `index.js`
   * default - the API has no separate entry-point field.
   */
  environmentVariables?: Record<string, string> | undefined;
  telemetryConfig?: { loggingConfig: { logGroup: string } } | undefined;
}

export interface CreateWebFunctionInput {
  functionName: string;
  /** The initial revision: the CLI's placeholder package and settings. */
  revisionConfig: {
    description?: string | undefined;
    buildConfig: WebFunctionBuildConfig;
    serviceConfig: WebFunctionServiceConfig;
  };
  /** The initial endpoint, created in the same call. */
  endpointConfig: {
    endpointName: string;
    endpointType: string;
    authType: string;
    autoDeploymentMode?: string | undefined;
  };
  tags?: ResourceTags | undefined;
}

/** One row of `ListWebFunctionRevisions` - state and identity, no configuration. */
export interface WebFunctionRevisionSummary {
  revisionArn: string;
  revisionId: string;
  description?: string | undefined;
  /** `Pending`, `Active` or `Failed`. */
  state: string;
  stateReason?: string | undefined;
  createdAt?: string | undefined;
}

/** One error a `Failed` revision reports, naming the attribute it concerns. */
export interface WebFunctionRevisionError {
  attribute?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface WebFunctionRevision {
  functionArn: string;
  revisionArn: string;
  revisionId: string;
  description?: string | undefined;
  buildConfig?: WebFunctionBuildConfig | undefined;
  serviceConfig?: WebFunctionServiceConfig | undefined;
  state: string;
  stateReason?: string | undefined;
  errors: WebFunctionRevisionError[];
  createdAt?: string | undefined;
}

export interface CreateWebFunctionRevisionInput {
  functionName: string;
  description?: string | undefined;
  buildConfig: WebFunctionBuildConfig;
  serviceConfig: WebFunctionServiceConfig;
}

export interface WebFunctionEndpoint {
  endpointArn: string;
  endpointName: string;
  endpointType?: string | undefined;
  /** The HTTPS domain the endpoint answers on. */
  domainName: string;
  authType?: string | undefined;
  autoDeploymentMode?: string | undefined;
  state: string;
  stateReason?: string | undefined;
}

export interface CreateWebFunctionEndpointInput {
  functionName: string;
  endpointName: string;
  /** `HomeRegion` - multi-region endpoints are out of scope. */
  endpointType: string;
  /** `IamAuth` so only the distribution's signed requests reach the app. */
  authType: string;
  /** `LatestRevision` - the endpoint always routes to the newest Active revision. */
  autoDeploymentMode?: string | undefined;
}

export interface WebFunction {
  functionName: string;
  functionArn: string;
  /** `Pending`, `Active`, `Failed` or `Deleting`. */
  state: string;
  stateReason?: string | undefined;
  /** The revision the create call produced, when answered. */
  revision?: WebFunctionRevisionSummary | undefined;
  /** The endpoint the create call produced, when answered. */
  endpoint?: WebFunctionEndpoint | undefined;
}

/** A web function's resource policy plus the policy revision the service answered with. */
export interface WebFunctionResourcePolicy {
  policy: string | undefined;
  revisionId: string | undefined;
}

interface S3ObjectResponse {
  bucket?: string;
  key?: string;
  versionId?: string;
}

function normalizeS3Object(res: S3ObjectResponse | undefined): WebFunctionS3Object | undefined {
  if (!res?.bucket || !res.key) return undefined;
  return {
    bucket: res.bucket,
    key: res.key,
    ...(res.versionId ? { versionId: res.versionId } : {}),
  };
}

interface BuildConfigResponse {
  codeConfig?: { s3Object?: S3ObjectResponse };
  runtimeConfig?: { runtime?: string };
}

function normalizeBuildConfig(
  res: BuildConfigResponse | undefined,
): WebFunctionBuildConfig | undefined {
  const s3Object = normalizeS3Object(res?.codeConfig?.s3Object);
  const runtime = res?.runtimeConfig?.runtime;
  if (!s3Object || !runtime) return undefined;
  return { codeConfig: { s3Object }, runtimeConfig: { runtime } };
}

interface ServiceConfigResponse {
  executionRoleArn?: string;
  timeoutSeconds?: number;
  maxConcurrencyPerEnvironment?: number;
  environmentVariables?: Record<string, string>;
  telemetryConfig?: { loggingConfig?: { logGroup?: string } };
}

function normalizeServiceConfig(
  res: ServiceConfigResponse | undefined,
): WebFunctionServiceConfig | undefined {
  if (!res?.executionRoleArn) return undefined;
  const logGroup = res.telemetryConfig?.loggingConfig?.logGroup;
  return {
    executionRoleArn: res.executionRoleArn,
    ...(res.timeoutSeconds !== undefined ? { timeoutSeconds: res.timeoutSeconds } : {}),
    ...(res.maxConcurrencyPerEnvironment !== undefined
      ? { maxConcurrencyPerEnvironment: res.maxConcurrencyPerEnvironment }
      : {}),
    ...(res.environmentVariables ? { environmentVariables: res.environmentVariables } : {}),
    ...(logGroup ? { telemetryConfig: { loggingConfig: { logGroup } } } : {}),
  };
}

interface RevisionResponse {
  functionArn?: string;
  revisionArn?: string;
  revisionId?: string;
  description?: string;
  buildConfig?: BuildConfigResponse;
  serviceConfig?: ServiceConfigResponse;
  state?: string;
  stateReason?: string;
  errors?: WebFunctionRevisionError[];
  createdAt?: string;
}

function normalizeRevision(res: RevisionResponse): WebFunctionRevision {
  const buildConfig = normalizeBuildConfig(res.buildConfig);
  const serviceConfig = normalizeServiceConfig(res.serviceConfig);
  return {
    functionArn: res.functionArn ?? '',
    revisionArn: res.revisionArn ?? '',
    revisionId: res.revisionId ?? '',
    ...(res.description !== undefined ? { description: res.description } : {}),
    ...(buildConfig ? { buildConfig } : {}),
    ...(serviceConfig ? { serviceConfig } : {}),
    state: res.state ?? '',
    ...(res.stateReason !== undefined ? { stateReason: res.stateReason } : {}),
    errors: res.errors ?? [],
    ...(res.createdAt !== undefined ? { createdAt: res.createdAt } : {}),
  };
}

interface RevisionSummaryResponse {
  revisionArn?: string;
  revisionId?: string;
  description?: string;
  state?: string;
  stateReason?: string;
  createdAt?: string;
}

function normalizeRevisionSummary(res: RevisionSummaryResponse): WebFunctionRevisionSummary {
  return {
    revisionArn: res.revisionArn ?? '',
    revisionId: res.revisionId ?? '',
    ...(res.description !== undefined ? { description: res.description } : {}),
    state: res.state ?? '',
    ...(res.stateReason !== undefined ? { stateReason: res.stateReason } : {}),
    ...(res.createdAt !== undefined ? { createdAt: res.createdAt } : {}),
  };
}

interface EndpointResponse {
  endpointArn?: string;
  endpointName?: string;
  endpointType?: string;
  domainName?: string;
  authType?: string;
  autoDeploymentMode?: string;
  state?: string;
  stateReason?: string;
}

function normalizeEndpoint(res: EndpointResponse): WebFunctionEndpoint {
  return {
    endpointArn: res.endpointArn ?? '',
    endpointName: res.endpointName ?? '',
    ...(res.endpointType ? { endpointType: res.endpointType } : {}),
    domainName: res.domainName ?? '',
    ...(res.authType ? { authType: res.authType } : {}),
    ...(res.autoDeploymentMode ? { autoDeploymentMode: res.autoDeploymentMode } : {}),
    state: res.state ?? '',
    ...(res.stateReason !== undefined ? { stateReason: res.stateReason } : {}),
  };
}

interface FunctionResponse {
  functionName?: string;
  functionArn?: string;
  state?: string;
  stateReason?: string;
  revision?: RevisionSummaryResponse;
  endpoint?: EndpointResponse;
}

function normalizeFunction(res: FunctionResponse): WebFunction {
  const revision = res.revision ? normalizeRevisionSummary(res.revision) : undefined;
  const endpoint = res.endpoint ? normalizeEndpoint(res.endpoint) : undefined;
  return {
    functionName: res.functionName ?? '',
    functionArn: res.functionArn ?? '',
    state: res.state ?? '',
    ...(res.stateReason !== undefined ? { stateReason: res.stateReason } : {}),
    ...(revision ? { revision } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

export class LambdaWebClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(
    method: string,
    path: string,
    payload?: object,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const res = await this.client.send({
      service: 'lambdaweb',
      method,
      path,
      ...(query ? { query } : {}),
      headers: { 'content-type': 'application/json' },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createWebFunction(input: CreateWebFunctionInput): Promise<WebFunction> {
    const body = {
      functionName: input.functionName,
      revisionConfig: input.revisionConfig,
      endpointConfig: input.endpointConfig,
      ...(input.tags ? { tags: input.tags } : {}),
    };
    return normalizeFunction(await this.call<FunctionResponse>('PUT', PATHS.functions, body));
  }

  async getWebFunction(name: string): Promise<WebFunction | undefined> {
    try {
      return normalizeFunction(await this.call<FunctionResponse>('GET', PATHS.function(name)));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** `ListWebFunctions` is a POST on the collection path, paginated by body token. */
  async listWebFunctions(): Promise<WebFunction[]> {
    const out: WebFunction[] = [];
    let token: string | undefined;
    do {
      const page = await this.call<{
        functions?: FunctionResponse[];
        nextToken?: string;
      }>('POST', PATHS.functions, token ? { nextToken: token } : {});
      for (const item of page.functions ?? []) out.push(normalizeFunction(item));
      token = page.nextToken;
    } while (token);
    return out;
  }

  async deleteWebFunction(name: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.function(name));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async createWebFunctionRevision(
    input: CreateWebFunctionRevisionInput,
  ): Promise<WebFunctionRevision> {
    const body = {
      ...(input.description !== undefined ? { description: input.description } : {}),
      buildConfig: input.buildConfig,
      serviceConfig: input.serviceConfig,
    };
    return normalizeRevision(
      await this.call<RevisionResponse>('POST', PATHS.revisions(input.functionName), body),
    );
  }

  async getWebFunctionRevision(
    functionName: string,
    revisionId: string,
  ): Promise<WebFunctionRevision | undefined> {
    try {
      return normalizeRevision(
        await this.call<RevisionResponse>('GET', PATHS.revision(functionName, revisionId)),
      );
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /**
   * Revision summaries in the order the service returns them - newest first,
   * which is what a `LatestRevision` endpoint routes to. A summary carries no
   * configuration; read one with {@link getWebFunctionRevision}.
   */
  async listWebFunctionRevisions(functionName: string): Promise<WebFunctionRevisionSummary[]> {
    const out: WebFunctionRevisionSummary[] = [];
    let token: string | undefined;
    do {
      const page = await this.call<{
        revisions?: RevisionSummaryResponse[];
        nextToken?: string;
      }>('POST', PATHS.listRevisions(functionName), token ? { nextToken: token } : {});
      for (const item of page.revisions ?? []) out.push(normalizeRevisionSummary(item));
      token = page.nextToken;
    } while (token);
    return out;
  }

  async deleteWebFunctionRevision(functionName: string, revisionId: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.revision(functionName, revisionId));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async createWebFunctionEndpoint(
    input: CreateWebFunctionEndpointInput,
  ): Promise<WebFunctionEndpoint> {
    const body = {
      endpointName: input.endpointName,
      endpointType: input.endpointType,
      authType: input.authType,
      ...(input.autoDeploymentMode ? { autoDeploymentMode: input.autoDeploymentMode } : {}),
    };
    return normalizeEndpoint(
      await this.call<EndpointResponse>('PUT', PATHS.endpoints(input.functionName), body),
    );
  }

  async getWebFunctionEndpoint(
    functionName: string,
    endpointName: string,
  ): Promise<WebFunctionEndpoint | undefined> {
    try {
      return normalizeEndpoint(
        await this.call<EndpointResponse>('GET', PATHS.endpoint(functionName, endpointName)),
      );
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  async listWebFunctionEndpoints(functionName: string): Promise<WebFunctionEndpoint[]> {
    const out: WebFunctionEndpoint[] = [];
    let token: string | undefined;
    do {
      const page = await this.call<{
        endpoints?: EndpointResponse[];
        nextToken?: string;
      }>('POST', PATHS.listEndpoints(functionName), token ? { nextToken: token } : {});
      for (const item of page.endpoints ?? []) out.push(normalizeEndpoint(item));
      token = page.nextToken;
    } while (token);
    return out;
  }

  async deleteWebFunctionEndpoint(functionName: string, endpointName: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.endpoint(functionName, endpointName));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  /**
   * Replace the resource policy attached to a web function. `resourceArn` is
   * the FUNCTION's ARN (the API's own description of the path parameter, and
   * the pattern its validator enforces), and the statement inside the policy
   * names the endpoint it authorizes.
   *
   * This operation is the one place the wire format is not the member name:
   * the model gives `policy`/`revisionId` the location names `Policy` and
   * `RevisionId` in both directions, and the service rejects a lowercase body
   * with "Value null at 'policy' failed to satisfy constraint".
   */
  async putResourcePolicy(resourceArn: string, policy: string): Promise<WebFunctionResourcePolicy> {
    const res = await this.call<{ Policy?: string; RevisionId?: string }>(
      'PUT',
      PATHS.resourcePolicy(resourceArn),
      { Policy: policy },
    );
    return { policy: res.Policy, revisionId: res.RevisionId };
  }

  async getResourcePolicy(resourceArn: string): Promise<WebFunctionResourcePolicy | undefined> {
    try {
      const res = await this.call<{ Policy?: string; RevisionId?: string }>(
        'GET',
        PATHS.resourcePolicy(resourceArn),
      );
      return { policy: res.Policy, revisionId: res.RevisionId };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }
}
