import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

import type { CredentialProvider } from './credentials.js';
import { resolveEndpoint, SIGNING_NAMES, type ServiceKey } from './endpoint.js';
import { AwsError, isRetryable } from './errors.js';
import { withRetry } from '../util.js';
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
  service: ServiceKey;
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
      service: SIGNING_NAMES[opts.service],
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
      uriEscapePath: opts.service !== 's3',
    });

    const signed = await signer.sign(request);

    const qs = Object.keys(query)
      .map((k) => `${escape(k)}=${escape(query[k] as string)}`)
      .join('&');
    const url = `${ep.protocol}//${ep.host}${opts.path}${qs ? `?${qs}` : ''}`;

    // Retry transient failures with backoff. For idempotent methods, retry on network
    // errors and 5xx/429. For non-idempotent POSTs, retry ONLY on network errors (the
    // request never reached the server) — never on a 5xx, which may mean the mutation
    // was applied and a retry would double-execute (e.g. launch a second MicroVM).
    const idempotent = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(opts.method);
    const retryable = idempotent ? isRetryable : (err: unknown) => err instanceof TypeError;
    return withRetry(
      async () => {
        const response = await this.transport({
          url,
          method: opts.method,
          headers: signed.headers as Record<string, string>,
          body: opts.body,
        });
        if (response.statusCode >= 400) throw parseError(opts.service, response);
        return response;
      },
      { retryable },
    );
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
