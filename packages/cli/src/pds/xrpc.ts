/** Minimal AT Protocol XRPC client — just the calls the standard.site sync needs. */

export interface PdsRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

/**
 * Sends one XRPC request. `pathname` is relative to the account's PDS; auth
 * (OAuth DPoP headers, nonce retries) is the transport's job — in production
 * this is the bound `fetchHandler` of an OAuthSession (see oauth.ts).
 */
export type XrpcTransport = (pathname: string, init?: RequestInit) => Promise<Response>;

/** A structured error raised when the PDS returns a non-2xx response. */
export class XrpcError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(opts: { code: string; message: string; statusCode: number }) {
    super(`pds: ${opts.code} — ${opts.message} (HTTP ${opts.statusCode})`);
    this.name = 'XrpcError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
  }

  get isNotFound(): boolean {
    return this.statusCode === 404 || /RecordNotFound/i.test(this.code);
  }
}

/** rkey of a record, from the trailing segment of its AT-URI. */
export function rkeyFromUri(uri: string): string {
  const rkey = uri.split('/').pop();
  if (!rkey) throw new Error(`cannot extract rkey from AT-URI "${uri}"`);
  return rkey;
}

const LIST_PAGE_SIZE = 100;

export class PdsClient {
  constructor(
    private readonly did: string,
    private readonly transport: XrpcTransport,
  ) {}

  private async call<T>(
    nsid: string,
    opts: { method: 'GET' | 'POST'; params?: Record<string, string>; body?: object },
  ): Promise<T> {
    const query = new URLSearchParams(opts.params ?? {}).toString();
    const res = await this.transport(`/xrpc/${nsid}${query ? `?${query}` : ''}`, {
      method: opts.method,
      ...(opts.body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }
        : {}),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON error body — fall through with the raw text as message */
    }
    if (!res.ok) {
      throw new XrpcError({
        code: typeof parsed.error === 'string' ? parsed.error : 'UnknownError',
        message: typeof parsed.message === 'string' ? parsed.message : text.slice(0, 200),
        statusCode: res.status,
      });
    }
    return parsed as T;
  }

  /** All records in a collection for the account repo (cursor-paginated). */
  async listRecords(collection: string): Promise<PdsRecord[]> {
    const records: PdsRecord[] = [];
    let cursor: string | undefined;
    do {
      const out = await this.call<{ records?: PdsRecord[]; cursor?: string }>(
        'com.atproto.repo.listRecords',
        {
          method: 'GET',
          params: {
            repo: this.did,
            collection,
            limit: String(LIST_PAGE_SIZE),
            ...(cursor ? { cursor } : {}),
          },
        },
      );
      records.push(...(out.records ?? []));
      cursor = out.records?.length ? out.cursor : undefined;
    } while (cursor);
    return records;
  }

  /** Fetch one record; undefined when it does not exist. */
  async getRecord(collection: string, rkey: string): Promise<PdsRecord | undefined> {
    try {
      return await this.call<PdsRecord>('com.atproto.repo.getRecord', {
        method: 'GET',
        params: { repo: this.did, collection, rkey },
      });
    } catch (err) {
      if (err instanceof XrpcError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Create a record; the PDS assigns the rkey unless one is given. */
  async createRecord(
    collection: string,
    record: Record<string, unknown>,
    rkey?: string,
  ): Promise<{ uri: string }> {
    return this.call<{ uri: string }>('com.atproto.repo.createRecord', {
      method: 'POST',
      body: { repo: this.did, collection, ...(rkey ? { rkey } : {}), record },
    });
  }

  /** Create or overwrite the record at a known rkey. */
  async putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
  ): Promise<{ uri: string }> {
    return this.call<{ uri: string }>('com.atproto.repo.putRecord', {
      method: 'POST',
      body: { repo: this.did, collection, rkey, record },
    });
  }
}
