import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

import type { CredentialProvider } from './credentials.js';
import {
  resolveEndpoint,
  resolveService,
  type ServiceDescriptor,
  type ServiceKey,
} from './endpoint.js';
import { AwsError, isRetryable, isThrottling } from './errors.js';
import { withRetry, type RetryOptions } from '../util.js';
import { textTag } from './xml.js';

export interface RawResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
  text(): string;
}

/** Low-level transport. Injectable so tests can intercept without real network I/O. */
export type Transport = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | undefined;
}) => Promise<RawResponse>;

export interface SendOptions {
  service: ServiceKey | ServiceDescriptor;
  method: string;
  /** Path starting with '/'. For S3 pass an already-percent-encoded path. */
  path: string;
  query?: Record<string, string | number | undefined> | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | Uint8Array | undefined;
}

export interface SigningClientOptions {
  region: string;
  endpointOverride?: string | undefined;
  credentials: CredentialProvider;
  transport?: Transport | undefined;
}

/**
 * Backoff for a request AWS refused for its rate. Eight attempts, doubling from
 * 1 second to a 20-second ceiling with jitter, wait roughly 36-71 seconds in all -
 * long enough to outlast a burst of throttling from parallel bootstraps against
 * one account. Other transient failures (5xx, network errors) keep the default
 * {@link withRetry} budget.
 */
export const THROTTLE_RETRY: Required<Omit<RetryOptions, 'retryable'>> = {
  attempts: 8,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  jitter: true,
};

/** Default transport backed by the global fetch. */
export const fetchTransport: Transport = async (req) => {
  const init: RequestInit = { method: req.method, headers: req.headers };
  if (req.body !== undefined) init.body = req.body as NonNullable<RequestInit['body']>;
  const res = await fetch(req.url, init);
  const buf = new Uint8Array(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    statusCode: res.status,
    headers,
    body: buf,
    text: () => new TextDecoder().decode(buf),
  };
};

/** Strict RFC-3986 percent encoder (matches SigV4 canonicalisation). */
function escape(component: string): string {
  return encodeURIComponent(component).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function sha256Hex(body: string | Uint8Array | undefined): Promise<string> {
  const hash = new Sha256();
  hash.update(body ?? '');
  const digest = await hash.digest();
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Signs and sends raw HTTP requests to AWS services using SigV4. This is the single
 * seam through which every service client talks to AWS (or the floci emulator).
 */
export class SigningClient {
  readonly region: string;
  readonly endpointOverride: string | undefined;
  private readonly credentials: CredentialProvider;
  private readonly transport: Transport;

  constructor(opts: SigningClientOptions) {
    this.region = opts.region;
    this.endpointOverride = opts.endpointOverride;
    this.credentials = opts.credentials;
    this.transport = opts.transport ?? fetchTransport;
  }

  async send(opts: SendOptions): Promise<RawResponse> {
    const resolved = resolveService(opts.service);
    const ep = resolveEndpoint(opts.service, this.region, this.endpointOverride);
    const [hostname, portStr] = ep.host.split(':');
    const port = portStr ? Number(portStr) : undefined;

    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) query[key] = String(value);
    }

    const contentHash = await sha256Hex(opts.body);
    const headers: Record<string, string> = {
      host: ep.host,
      'x-amz-content-sha256': contentHash,
      ...opts.headers,
    };

    const request = new HttpRequest({
      protocol: ep.protocol,
      hostname: hostname ?? ep.host,
      ...(port !== undefined ? { port } : {}),
      method: opts.method,
      path: opts.path,
      query,
      headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    });

    const signer = new SignatureV4({
      service: resolved.signingName,
      region: ep.signingRegion,
      credentials: async () => {
        const c = await this.credentials();
        return {
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
        };
      },
      sha256: Sha256,
      uriEscapePath: resolved.name !== 's3',
    });

    const signed = await signer.sign(request);

    const qs = Object.keys(query)
      .map((k) => `${escape(k)}=${escape(query[k] as string)}`)
      .join('&');
    const url = `${ep.protocol}//${ep.host}${opts.path}${qs ? `?${qs}` : ''}`;

    // Retry transient failures with backoff. For idempotent methods, retry on network
    // errors, throttling and 5xx. For non-idempotent POSTs, retry on network errors
    // (the request never reached the server) and on throttling (AWS refused it before
    // acting on it) - never on a 5xx, which may mean the mutation was applied and a
    // retry would double-execute (e.g. launch a second MicroVM).
    //
    // Throttling has its own, longer budget (THROTTLE_RETRY) in the inner loop; the
    // outer loop retries the other transient failures and never a throttle the
    // inner loop already gave up on.
    const idempotent = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(opts.method);
    const transient = idempotent ? isRetryable : (err: unknown) => err instanceof TypeError;
    const attempt = async (): Promise<RawResponse> => {
      const response = await this.transport({
        url,
        method: opts.method,
        headers: signed.headers as Record<string, string>,
        body: opts.body,
      });
      // Anything outside 2xx is a failure. 3xx matters: S3's region-mismatch
      // PermanentRedirect is a 301 with no Location header, which fetch
      // returns as final - treating it as success would report writes as
      // stored and listings as empty against the wrong endpoint.
      if (response.statusCode >= 300) throw parseError(resolved.name, response);
      return response;
    };
    return withRetry(() => withRetry(attempt, { ...THROTTLE_RETRY, retryable: isThrottling }), {
      retryable: (err) => !isThrottling(err) && transient(err),
    });
  }

  /**
   * Sign and send a request to an explicit URL - an application endpoint, not
   * an AWS service endpoint - with `x-amz-content-sha256` always present (a
   * Lambda Web Function endpoint rejects a signed request without it).
   *
   * Unlike {@link send}, an HTTP error status is RETURNED rather than thrown:
   * the Web Function probe needs the status and headers of a 403 or 5xx to
   * tell an application answer from an authorization refusal, and neither is
   * a transport failure. Network errors still throw.
   */
  async sendToUrl(opts: {
    url: string;
    method: string;
    /** SigV4 signing name, e.g. `lambda` for a Web Function endpoint. */
    service: string;
    headers?: Record<string, string> | undefined;
    body?: string | Uint8Array | undefined;
  }): Promise<RawResponse> {
    const url = new URL(opts.url);
    const contentHash = await sha256Hex(opts.body);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': contentHash,
      ...opts.headers,
    };
    const request = new HttpRequest({
      protocol: url.protocol === 'http:' ? 'http:' : 'https:',
      hostname: url.hostname,
      ...(url.port ? { port: Number(url.port) } : {}),
      method: opts.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    });
    const signer = new SignatureV4({
      service: opts.service,
      region: this.region,
      credentials: async () => {
        const c = await this.credentials();
        return {
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
        };
      },
      sha256: Sha256,
    });
    const signed = await signer.sign(request);
    return this.transport({
      url: url.toString(),
      method: opts.method,
      headers: signed.headers as Record<string, string>,
      body: opts.body,
    });
  }
}

function parseError(service: string, response: RawResponse): AwsError {
  const text = response.text();
  let code = `Http${response.statusCode}`;
  let message = text.slice(0, 500) || 'request failed';
  let requestId: string | undefined;

  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const rawCode = (json.__type ?? json.code ?? json.Code) as string | undefined;
      code = rawCode ? (rawCode.split('#').pop() ?? code) : code;
      message = (json.message ?? json.Message ?? message) as string;
    } catch {
      /* fall through */
    }
  } else if (trimmed.startsWith('<')) {
    code = textTag(text, 'Code') ?? code;
    message = textTag(text, 'Message') ?? message;
    requestId = textTag(text, 'RequestId') ?? textTag(text, 'RequestID');
  }

  return new AwsError({ service, code, message, statusCode: response.statusCode, requestId });
}
