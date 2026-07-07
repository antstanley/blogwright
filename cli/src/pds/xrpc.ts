/** Minimal AT Protocol XRPC client — just the calls the standard.site sync needs. */

export interface PdsSession {
  did: string;
  accessJwt: string;
}

export interface PdsRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

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
  private session: PdsSession | undefined;

  constructor(
    private readonly service: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async call<T>(
    nsid: string,
    opts: { method: 'GET' | 'POST'; params?: Record<string, string>; body?: object },
  ): Promise<T> {
    const url = new URL(`/xrpc/${nsid}`, this.service);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
    const res = await this.transport(url, {
      method: opts.method,
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(this.session ? { authorization: `Bearer ${this.session.accessJwt}` } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
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

  /** Authenticate with a handle/DID + app password; retained for subsequent calls. */
  async createSession(identifier: string, password: string): Promise<PdsSession> {
    const out = await this.call<{ did: string; accessJwt: string }>(
      'com.atproto.server.createSession',
      { method: 'POST', body: { identifier, password } },
    );
    this.session = { did: out.did, accessJwt: out.accessJwt };
    return this.session;
  }

  private get did(): string {
    if (!this.session) throw new Error('createSession must be called first');
    return this.session.did;
  }

  /** All records in a collection for the session repo (cursor-paginated). */
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
