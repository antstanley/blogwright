/**
 * The dashboard server, driven over real sockets through the fixture-backed
 * fake `AnalyticsQuery` - so no DuckDB starts here and no test can pass
 * against rows the queries do not return (`fixture-query.ts` refuses a fixture
 * whose keys are not the query's own `resultColumns`).
 *
 * Three properties get the closest reading, because all three are the kind
 * that fail silently:
 *
 *   - **Where it binds.** Asserted on the address the socket reports, not on
 *     the argument the code passed, and - where the machine has a non-loopback
 *     interface - by showing that a connection there is refused. A `0.0.0.0`
 *     bind puts the site's traffic, read under the operator's own AWS
 *     credentials, on every interface the machine has.
 *   - **That no route accepts SQL.** Every shape a statement could arrive in
 *     is tried: as the query name, as a query-string parameter beside a valid
 *     range, and as a request body. Each asserts the status *and* that the
 *     fake recorded zero `run` calls, so "rejected" means the port was never
 *     reached and not merely that the response looked like a failure.
 *   - **That parameters travel unmodified.** The fake is wrapped in a recorder
 *     that keeps the exact `params` object it was handed, so the assertion is
 *     a field-by-field comparison against what the request carried rather than
 *     against the bindings a later stage derived.
 */

import { request as sendRequest } from 'node:http';
import { connect as connectSocket, createServer as createSocketServer } from 'node:net';
import { networkInterfaces } from 'node:os';

import { createMemoryFileSystem, type FileSystem } from 'blogwright-core';
import { afterEach, describe, expect, it } from 'vitest';

import { type AnalyticsConfig, DEFAULT_DASHBOARD_PORT, validateAnalyticsConfig } from './config.js';
import { createFixtureAnalyticsQuery, type QueryFixtures } from './fixture-query.js';
import type { AnalyticsQuery, QueryRow } from './ports.js';
import {
  ANALYTICS_QUERY_NAMES,
  type PreparedQuery,
  type QueryName,
  type QueryParams,
} from './queries.js';
import {
  createDashboardServer,
  type DashboardServer,
  type DashboardServerOptions,
} from './server.js';

/** The address the server must bind, spelled here so the assertion is independent of the module. */
const LOOPBACK = '127.0.0.1';

/** Where the prebuilt application lives in these tests. */
const APP_DIR = '/pkg/dist/app';

/** A file that exists on the same (in-memory) filesystem but *outside* {@link APP_DIR}. */
const SECRET_PATH = '/pkg/secret.txt';

/** Its contents - what a traversal would leak, and what no response body may contain. */
const SECRET_CONTENT = 'aws_secret_access_key=hunter2';

/** The range every request in this file asks for. */
const RANGE = { from: '2026-08-01', to: '2026-08-03' };

/** Rows shaped like the queries' own `resultColumns` - the fixture refuses anything else. */
const FIXTURES: QueryFixtures = {
  'views-over-time': [
    { day: '2026-08-01', views: 12 },
    { day: '2026-08-02', views: 30 },
  ],
  'top-paths': [{ uri: '/posts/hello', views: 9 }],
};

/** One accepted call, as the server handed it to the port. */
interface RecordedRun {
  readonly name: QueryName;
  readonly params: QueryParams;
}

/** The fixture fake, plus the raw arguments each `run` received. */
interface RecordingQuery extends AnalyticsQuery {
  /** Every call, with the exact `params` object the server passed. */
  readonly runs: readonly RecordedRun[];
  /** What the shared lookup resolved each accepted call to - `bindings` above all. */
  readonly prepared: readonly PreparedQuery[];
}

/**
 * Wrap the fixture fake so a test can compare the `params` object itself
 * against the request. `fixture-query.ts` records the *prepared* call, which
 * is a transformation of the parameters; the passthrough claim is about the
 * parameters, so both are kept.
 */
function recordingQuery(
  fixtures: QueryFixtures = FIXTURES,
  config: Pick<AnalyticsConfig, 'bots'> = validateAnalyticsConfig({}),
): RecordingQuery {
  const fake = createFixtureAnalyticsQuery(fixtures, config);
  const runs: RecordedRun[] = [];
  return {
    runs,
    prepared: fake.calls,
    async run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> {
      runs.push({ name, params });
      return fake.run(name, params);
    },
  };
}

/** An in-memory application directory, plus a file outside it a traversal would want. */
function appFileSystem(files: Record<string, string> = {}): FileSystem {
  return createMemoryFileSystem({
    [`${APP_DIR}/index.html`]: '<!doctype html><title>analytics</title>',
    [`${APP_DIR}/assets/app.js`]: 'console.log("dashboard")',
    [`${APP_DIR}/nested/index.html`]: 'nested page',
    [SECRET_PATH]: SECRET_CONTENT,
    ...files,
  });
}

/** The first non-internal IPv4 address this machine has, if it has one. */
function externalAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return undefined;
}

const EXTERNAL_ADDRESS = externalAddress();

const running: DashboardServer[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
});

/**
 * Start a server on an ephemeral port, registered for teardown. Port 0 is the
 * default here so the suite never contends for a fixed one; the tests that are
 * *about* the port pass it explicitly.
 */
async function serve(overrides: Partial<DashboardServerOptions> = {}): Promise<DashboardServer> {
  const server = await createDashboardServer({
    query: recordingQuery(),
    config: validateAnalyticsConfig({}),
    port: 0,
    appDir: APP_DIR,
    fs: appFileSystem(),
    ...overrides,
  });
  running.push(server);
  return server;
}

/** One response, read far enough to assert on. */
interface Answer {
  readonly status: number;
  readonly text: string;
  readonly contentType: string | undefined;
  /** Every response header, so a `HEAD` can be compared to a `GET` field by field. */
  readonly headers: Headers;
}

async function request(
  server: DashboardServer,
  path: string,
  init: RequestInit = {},
): Promise<Answer> {
  const response = await fetch(new URL(path, server.url), init);
  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get('content-type') ?? undefined,
    headers: response.headers,
  };
}

/**
 * Make a request carrying a `Host` header of the test's own choosing - or
 * none at all.
 *
 * `fetch` cannot do this and a test written with it could not fail: the fetch
 * standard makes `host` a forbidden header name, so undici drops whatever a
 * test sets and sends the socket's own address instead, which is exactly the
 * value the server accepts. This connects to the loopback listener directly
 * and writes the header itself; `setHost: false` is what makes an *absent*
 * `Host` reachable, since Node otherwise adds one.
 */
function requestWithHost(
  server: DashboardServer,
  path: string,
  host: string | undefined,
  method = 'GET',
): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const outgoing = sendRequest(
      {
        host: LOOPBACK,
        port: server.address.port,
        path,
        method,
        setHost: false,
        headers: host === undefined ? {} : { host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') headers.set(name, value);
            else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          }
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            contentType: response.headers['content-type'],
            headers,
          });
        });
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

/**
 * Send a request line and headers over a bare socket, answering with the whole
 * raw response.
 *
 * This exists for one request Node's own client will not make: an HTTP/1.0
 * request with no `Host` header. Node's server refuses an HTTP/1.1 request
 * that omits `Host` with a 400 of its own, before any handler runs, so the
 * server's absent-host branch is only reachable over 1.0 - and a test that
 * used the higher-level client would be asserting on Node's parser instead of
 * on this module.
 */
function rawRequest(server: DashboardServer, lines: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    const socket = connectSocket(server.address.port, LOOPBACK, () => {
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      text += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => resolve(text));
  });
}

/** The `error` string a refusal answers with. */
function errorOf(answer: Answer): string {
  const body: unknown = JSON.parse(answer.text);
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    throw new Error(`response carried no error field: ${answer.text}`);
  }
  return String(body.error);
}

/**
 * A free port, obtained through a bare socket rather than through
 * {@link createDashboardServer}. Deliberately independent of the module under
 * test: a server that ignored `opts.port` and bound a literal would otherwise
 * hand this helper that same literal back, and every port assertion would
 * agree with the bug.
 */
async function freePort(): Promise<number> {
  const probe = createSocketServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, LOOPBACK, () => {
      const bound = probe.address();
      if (bound === null || typeof bound === 'string') {
        reject(new Error('the probe bound no TCP address'));
        return;
      }
      resolve(bound.port);
    });
  });
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}

/** Spin the event loop until `condition` holds, so no assertion races the server. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
  }
  throw new Error(`waited for ${what} and it never happened`);
}

describe('where the dashboard listens', () => {
  it('binds the loopback address rather than a wildcard', async () => {
    const server = await serve();
    expect(server.address.host).toBe(LOOPBACK);
    expect(server.url).toBe(`http://${LOOPBACK}:${server.address.port}/`);

    // Reachable there, and the address is the socket's own report - not the
    // argument the module passed to `listen`.
    expect((await request(server, '/')).status).toBe(200);
  });

  it.runIf(EXTERNAL_ADDRESS !== undefined)(
    'refuses a connection on this machine’s non-loopback interface',
    async () => {
      const server = await serve();
      const reached = fetch(`http://${String(EXTERNAL_ADDRESS)}:${server.address.port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      // A wildcard bind answers here; a loopback bind refuses the connection.
      await expect(reached).rejects.toThrow();
    },
  );

  it('binds the port it was given, whatever that port is', async () => {
    const port = await freePort();
    const server = await serve({ port });
    expect(server.address.port).toBe(port);
    expect(server.url).toContain(`:${port}/`);
  });

  it("takes the port from task 44's resolved config, not a literal of its own", async () => {
    // The exact value the dashboard command passes for an operator who wrote
    // no `dashboard` block: the resolver's output, whose default has one home.
    const resolved = validateAnalyticsConfig({}).dashboard.port;
    expect(resolved).toBe(DEFAULT_DASHBOARD_PORT);
    const server = await serve({ port: resolved });
    expect(server.address.port).toBe(DEFAULT_DASHBOARD_PORT);
  });

  it('releases the port, so a second listener binds it after close() resolves', async () => {
    const port = await freePort();
    const first = await createDashboardServer({
      query: recordingQuery(),
      config: validateAnalyticsConfig({}),
      port,
      appDir: APP_DIR,
      fs: appFileSystem(),
    });
    // An open keep-alive connection is what makes this fail if `close()` does
    // not destroy connections as well as stop listening.
    expect((await request(first, '/')).status).toBe(200);
    await first.close();

    const second = await serve({ port });
    expect(second.address.port).toBe(port);
    expect((await request(second, '/')).status).toBe(200);
  });

  it('closes while a query is still running, so a stop never hangs on the port', async () => {
    // Not the fixture fake: this one is a port that never answers, which is
    // what a slow Iceberg read looks like from here. `Server.close` alone
    // waits for an in-flight request forever, so an operator pressing Ctrl+C
    // mid-query would never get the port - or the shell - back.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const query: AnalyticsQuery = {
      async run(name: QueryName): Promise<readonly QueryRow[]> {
        started.push(name);
        await held;
        return [];
      },
    };

    const port = await freePort();
    const server = await createDashboardServer({
      query,
      config: validateAnalyticsConfig({}),
      port,
      appDir: APP_DIR,
      fs: appFileSystem(),
    });
    const inflight = fetch(
      `http://${LOOPBACK}:${port}/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
    ).catch(() => undefined);

    // Deterministic: the server is now inside the handler, awaiting the port.
    await waitFor(() => started.length === 1, 'the query to reach the port');
    await server.close();
    release();
    await inflight;

    const rebound = await serve({ port });
    expect(rebound.address.port).toBe(port);
    expect((await request(rebound, '/')).status).toBe(200);
  });

  it('closes idempotently', async () => {
    const server = await createDashboardServer({
      query: recordingQuery(),
      config: validateAnalyticsConfig({}),
      port: 0,
      appDir: APP_DIR,
      fs: appFileSystem(),
    });
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('fails with an actionable message when the port is already held', async () => {
    const held = await serve();
    await expect(
      createDashboardServer({
        query: recordingQuery(),
        config: validateAnalyticsConfig({}),
        port: held.address.port,
        appDir: APP_DIR,
        fs: appFileSystem(),
      }),
    ).rejects.toThrow(`cannot bind ${LOOPBACK}:${held.address.port}`);
  });
});

describe('the origin a request is addressed to', () => {
  /** A range good enough to reach the port, so a refusal is never about the range. */
  const QUERY_PATH = `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`;

  it('refuses a host that is not its own, without reaching the port', async () => {
    // The DNS-rebinding shape: the connection lands on the loopback socket
    // because a name the attacker controls resolves to 127.0.0.1, and the
    // browser treats the response as same-origin with that name.
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await requestWithHost(
      server,
      QUERY_PATH,
      `rebound.example:${server.address.port}`,
    );
    expect(answer.status).toBe(403);
    expect(errorOf(answer)).toContain('rebound.example');
    expect(query.runs).toEqual([]);
  });

  it('refuses the host before it refuses the method, so a rebound page learns no methods', async () => {
    // Pins the *ordering*: `rejectForeignHost` is the first statement of
    // `route()`, above the method gate. Both checks refuse this request, so
    // only their order decides which answer it gets - and a 405 would hand a
    // page on rebound.example the `allow` header, telling it exactly what this
    // server takes. Move the host check below the method gate and this reads
    // 405 with `allow: GET, HEAD`.
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await requestWithHost(
      server,
      QUERY_PATH,
      `rebound.example:${server.address.port}`,
      'DELETE',
    );
    expect(answer.status, answer.text).toBe(403);
    expect(answer.headers.get('allow')).toBeNull();
    expect(errorOf(answer)).toContain('rebound.example');
    expect(query.runs).toEqual([]);
  });

  it('refuses that host on the static route too, so the application is not readable either', async () => {
    const server = await serve();
    const answer = await requestWithHost(server, '/', `rebound.example:${server.address.port}`);
    expect(answer.status).toBe(403);
    expect(answer.text).not.toContain('<!doctype html>');
  });

  it('refuses a request carrying no host at all, without reaching the port', async () => {
    // Over HTTP/1.0, where an absent `Host` is legal and reaches this module.
    // Node's own parser refuses the same omission over 1.1 with a 400 before a
    // handler runs, which is why this one is written down at the socket.
    const query = recordingQuery();
    const server = await serve({ query });
    const raw = await rawRequest(server, [`GET ${QUERY_PATH} HTTP/1.0`]);
    expect(raw).toContain('403');
    expect(raw).toContain('<absent>');
    expect(query.runs).toEqual([]);
  });

  it('is refused by Node itself when HTTP/1.1 omits the host the protocol requires', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await requestWithHost(server, QUERY_PATH, undefined);
    expect(answer.status).toBe(400);
    expect(query.runs).toEqual([]);
  });

  it("refuses its own name on somebody else's port", async () => {
    // The port is half the address: a listener on 4317 must not answer for a
    // page served from 127.0.0.1 on some other port of this machine.
    const server = await serve();
    const answer = await requestWithHost(
      server,
      QUERY_PATH,
      `${LOOPBACK}:${server.address.port + 1}`,
    );
    expect(answer.status).toBe(403);
  });

  it('answers localhost, the other spelling an operator types', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await requestWithHost(server, QUERY_PATH, `localhost:${server.address.port}`);
    expect(answer.status).toBe(200);
    expect(query.runs).toHaveLength(1);
  });

  it('answers its bound address, whatever port it was given', async () => {
    const port = await freePort();
    const server = await serve({ port });
    expect((await requestWithHost(server, '/', `${LOOPBACK}:${port}`)).status).toBe(200);
  });

  it('sends nosniff on a query answer and on a served file alike', async () => {
    const server = await serve();
    const answered = await request(server, QUERY_PATH);
    const served = await request(server, '/');
    expect(answered.status).toBe(200);
    expect(served.status).toBe(200);
    expect(answered.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sends nosniff on a refusal as well, since a refusal is a body too', async () => {
    const server = await serve();
    const answer = await request(server, '/api/queries/no-such-query?from=x&to=y');
    expect(answer.status).toBe(404);
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('the named-query routes', () => {
  it('answers a named query with its rows and what a row means', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
    );

    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(answer.text)).toEqual({
      name: 'views-over-time',
      rowMeaning: 'one UTC day and the number of requests served that day',
      resultColumns: ['day', 'views'],
      rows: FIXTURES['views-over-time'],
    });
    expect(query.runs).toHaveLength(1);
  });

  it('answers every name the set declares', async () => {
    const fixtures: QueryFixtures = {
      referrers: [{ referrer: 'https://example.test/', views: 4 }],
    };
    const query = recordingQuery(fixtures);
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/referrers?from=${RANGE.from}&to=${RANGE.to}`,
    );
    expect(answer.status).toBe(200);
    expect(query.runs.map((call) => call.name)).toEqual(['referrers']);
  });

  it('answers 404 listing every available name when the name is not one of them', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(server, `/api/queries/nope?from=${RANGE.from}&to=${RANGE.to}`);

    // The body is passed as the failure message so that removing the
    // unknown-name guard makes this test fail *naming the requested query*,
    // which is what the task's Reviewable line asks a reviewer to observe.
    expect(answer.status, answer.text).toBe(404);
    const message = errorOf(answer);
    expect(message).toContain('"nope"');
    for (const name of ANALYTICS_QUERY_NAMES) expect(message).toContain(name);
    expect(query.runs).toEqual([]);
  });

  it('treats an inherited object key as an unknown name, not a definition', async () => {
    // `ANALYTICS_QUERIES['constructor']` is a truthy function on any unguarded
    // index, which is why `queryDefinition` looks the name up with
    // `Object.hasOwn`. This route is the seam that feeds it untrusted names,
    // so the guard is asserted from out here rather than only in unit form.
    const query = recordingQuery();
    const server = await serve({ query });

    for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      const answer = await request(
        server,
        `/api/queries/${inherited}?from=${RANGE.from}&to=${RANGE.to}`,
      );
      expect(answer.status, answer.text).toBe(404);
      const message = errorOf(answer);
      expect(message).toContain(`"${inherited}"`);
      for (const name of ANALYTICS_QUERY_NAMES) expect(message).toContain(name);
    }
    expect(query.runs).toEqual([]);
  });

  it('surfaces a query failure as a 500 without reaching for a second query', async () => {
    // The fixture fake refuses a name it holds no rows for; the route must
    // answer rather than crash the listener.
    const query = recordingQuery({ 'top-paths': [{ uri: '/x', views: 1 }] });
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
    );
    expect(answer.status).toBe(500);
    expect(errorOf(answer)).toContain('views-over-time');
    // The listener is still up.
    expect((await request(server, '/')).status).toBe(200);
  });
});

describe('no route accepts SQL', () => {
  const STATEMENT = "SELECT * FROM page_views; DROP TABLE page_views; --'";

  it('rejects a statement sent as the query name, without reaching the port', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/${encodeURIComponent(STATEMENT)}?from=${RANGE.from}&to=${RANGE.to}`,
    );

    expect(answer.status, answer.text).toBe(404);
    expect(query.runs).toEqual([]);
    expect(query.prepared).toEqual([]);
  });

  it('rejects a statement sent as a query-string parameter beside a valid range', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}&sql=${encodeURIComponent(STATEMENT)}`,
    );

    // Refused, not ignored: an ignored parameter would answer 200 with a real
    // query run, which is a strictly weaker property.
    expect(answer.status).toBe(400);
    expect(errorOf(answer)).toContain('"sql"');
    expect(query.runs).toEqual([]);
    expect(query.prepared).toEqual([]);
  });

  it('rejects a statement sent as a request body, without reaching the port', async () => {
    const query = recordingQuery();
    const server = await serve({ query });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await request(
        server,
        `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
        { method, body: STATEMENT, headers: { 'content-type': 'text/plain' } },
      );
      expect(answer.status).toBe(405);
      expect(errorOf(answer)).toContain(method);
    }
    expect(query.runs).toEqual([]);
    expect(query.prepared).toEqual([]);
  });

  it('rejects a statement posted to the static route as well', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(server, '/', { method: 'POST', body: STATEMENT });
    expect(answer.status).toBe(405);
    expect(query.runs).toEqual([]);
  });
});

describe('the date range and the bot-inclusion flag', () => {
  it('hands the request values to the port unmodified', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/top-paths?from=${RANGE.from}&to=${RANGE.to}&includeBots=false`,
    );

    expect(answer.status).toBe(200);
    expect(query.runs).toStrictEqual([
      {
        name: 'top-paths',
        params: { range: { from: RANGE.from, to: RANGE.to }, includeBots: false },
      },
    ]);
  });

  it('carries includeBots=true through as true', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    await request(
      server,
      `/api/queries/top-paths?from=${RANGE.from}&to=${RANGE.to}&includeBots=true`,
    );
    expect(query.runs[0]?.params).toStrictEqual({
      range: { from: RANGE.from, to: RANGE.to },
      includeBots: true,
    });
  });

  it.each([
    { bots: 'flag', included: true },
    { bots: 'filter', included: false },
  ] as const)(
    'omits includeBots when the request does, so config.analytics.bots=$bots decides',
    async ({ bots, included }) => {
      const config = validateAnalyticsConfig({ bots });
      const query = recordingQuery(FIXTURES, config);
      const server = await serve({ query, config });
      await request(server, `/api/queries/top-paths?from=${RANGE.from}&to=${RANGE.to}`);

      // No `includeBots` key at all - the server states no default of its own.
      expect(query.runs[0]?.params).toStrictEqual({ range: { from: RANGE.from, to: RANGE.to } });
      // And the mode the operator configured is what the port bound.
      expect(query.prepared[0]?.bindings['include_bots']).toBe(included);
    },
  );

  it('rejects a missing range rather than picking a window of its own', async () => {
    const query = recordingQuery();
    const server = await serve({ query });

    for (const [path, missing] of [
      [`/api/queries/top-paths?to=${RANGE.to}`, 'from'],
      [`/api/queries/top-paths?from=${RANGE.from}`, 'to'],
      ['/api/queries/top-paths', 'from'],
    ] as const) {
      const answer = await request(server, path);
      expect(answer.status).toBe(400);
      expect(errorOf(answer)).toContain(`"${missing}"`);
    }
    expect(query.runs).toEqual([]);
  });

  it('rejects a day that is not a calendar day, naming the value', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(server, `/api/queries/top-paths?from=2026-02-30&to=${RANGE.to}`);
    expect(answer.status).toBe(400);
    expect(errorOf(answer)).toContain('"2026-02-30"');
    expect(query.runs).toEqual([]);
  });

  it('rejects an inverted range, naming both ends', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/top-paths?from=${RANGE.to}&to=${RANGE.from}`,
    );
    expect(answer.status).toBe(400);
    const message = errorOf(answer);
    expect(message).toContain(`"${RANGE.to}"`);
    expect(message).toContain(`"${RANGE.from}"`);
    expect(query.runs).toEqual([]);
  });

  it('treats an inherited object key as an invalid bot flag, not a value', async () => {
    // The third `Object.hasOwn` guard in this package, and the one this route
    // is the untrusted feed for. On an `in` test - or an unguarded index -
    // every name below is *present* on `INCLUDE_BOTS_VALUES` through
    // `Object.prototype`, so the flag would pass the guard and reach the port
    // as `Object.prototype` or as a function where a boolean is declared.
    const query = recordingQuery();
    const server = await serve({ query });

    for (const inherited of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const answer = await request(
        server,
        `/api/queries/top-paths?from=${RANGE.from}&to=${RANGE.to}&includeBots=${encodeURIComponent(inherited)}`,
      );
      expect(answer.status, answer.text).toBe(400);
      const message = errorOf(answer);
      expect(message).toContain(`"${inherited}"`);
      expect(message).toContain('true or false');
    }

    // And none of them reached the port, so "rejected" is not "ran with a
    // nonsense flag and answered like a failure".
    expect(query.runs).toEqual([]);
    expect(query.prepared).toEqual([]);
  });

  it('rejects a bot flag that is neither true nor false', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/top-paths?from=${RANGE.from}&to=${RANGE.to}&includeBots=maybe`,
    );
    expect(answer.status).toBe(400);
    expect(errorOf(answer)).toContain('"maybe"');
    expect(query.runs).toEqual([]);
  });
});

describe('HEAD, the method RFC 9110 requires beside GET', () => {
  /** One path per route family, plus a refusal, so nothing is asserted on the happy path alone. */
  const PATHS = [
    `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
    `/api/queries/nope?from=${RANGE.from}&to=${RANGE.to}`,
    '/',
    '/assets/app.js',
    '/assets/missing.js',
  ];

  it.each(PATHS)('answers %s exactly as GET does, with no body', async (path) => {
    const server = await serve();
    const get = await request(server, path);
    const head = await request(server, path, { method: 'HEAD' });

    // Same status and the same headers - `content-length` above all, since a
    // HEAD computed down a shorter path is where that one silently drifts.
    expect(head.status, head.text).toBe(get.status);
    expect(head.contentType).toBe(get.contentType);
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(get.text)));
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));

    // And the body itself is gone, where GET's was not.
    expect(head.text).toBe('');
    expect(get.text).not.toBe('');
  });

  it('is not a 405, and reaches the port the way GET does', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const head = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
      { method: 'HEAD' },
    );
    expect(head.status).toBe(200);
    expect(query.runs.map((call) => call.name)).toEqual(['views-over-time']);
  });

  it('leaves every other method refused, named in an allow header listing both', async () => {
    const query = recordingQuery();
    const server = await serve({ query });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const answer = await request(server, '/', { method });
      expect(answer.status, answer.text).toBe(405);
      expect(answer.headers.get('allow')).toBe('GET, HEAD');
      expect(errorOf(answer)).toContain(method);
    }
    expect(query.runs).toEqual([]);
  });
});

describe('the static application', () => {
  it('serves the index at the root, with its content type', async () => {
    const server = await serve();
    const answer = await request(server, '/');
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe('text/html; charset=utf-8');
    expect(answer.text).toContain('<title>analytics</title>');
  });

  it('serves a nested asset and a nested index', async () => {
    const server = await serve();
    const script = await request(server, '/assets/app.js');
    expect(script.status).toBe(200);
    expect(script.contentType).toBe('text/javascript; charset=utf-8');
    expect(script.text).toBe('console.log("dashboard")');

    const nested = await request(server, '/nested/');
    expect(nested.status).toBe(200);
    expect(nested.text).toBe('nested page');
  });

  it('answers 404 for a file the built application does not hold', async () => {
    const server = await serve();
    expect((await request(server, '/assets/missing.js')).status).toBe(404);
  });

  it('types a file whose extension is an inherited object key as the default, not a function', async () => {
    // `CONTENT_TYPES['constructor']` is a truthy function on an unguarded
    // index, and it would be written straight into a response header.
    const fs = appFileSystem({ [`${APP_DIR}/styles.constructor`]: 'body{}' });
    const server = await serve({ fs });
    const answer = await request(server, '/styles.constructor');
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe('application/octet-stream');
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/%2e%2e/pkg/secret.txt',
  ])('never serves a file outside the application directory (%s)', async (path) => {
    const server = await serve();
    const answer = await request(server, path);
    expect(answer.status).toBe(404);
    expect(answer.text).not.toContain(SECRET_CONTENT);
  });

  it('rejects a path that is not valid percent-encoding', async () => {
    const server = await serve();
    expect((await request(server, '/%zz')).status).toBe(400);
  });

  it('answers 503 naming the directory when the application has not been built', async () => {
    const fs = createMemoryFileSystem({ [SECRET_PATH]: SECRET_CONTENT });
    const query = recordingQuery();
    const server = await serve({ fs, query });

    const answer = await request(server, '/');
    expect(answer.status).toBe(503);
    expect(errorOf(answer)).toContain(APP_DIR);

    // The data plane is unaffected: an absent app is not an absent table.
    const data = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}`,
    );
    expect(data.status).toBe(200);
    expect(query.runs).toHaveLength(1);
  });

  it('picks the application up once it is built, rather than caching the failure', async () => {
    const fs = createMemoryFileSystem({});
    const server = await serve({ fs });
    expect((await request(server, '/')).status).toBe(503);

    await fs.writeText(`${APP_DIR}/index.html`, '<!doctype html>built later');
    const answer = await request(server, '/');
    expect(answer.status).toBe(200);
    expect(answer.text).toBe('<!doctype html>built later');
  });
});

describe('views granularity transport', () => {
  it('forwards the interval and describes UTC bucket starts', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(
      server,
      `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}&granularity=15m`,
    );
    expect(answer.status).toBe(200);
    expect(query.runs[0]?.params.granularity).toBe('15m');
    expect(answer.text).toContain('15 minutes');
  });
  it.each(['granularity=30m', 'granularity=', 'granularity=1h&granularity=6h'])(
    'rejects malformed intervals: %s',
    async (suffix) => {
      const query = recordingQuery();
      const server = await serve({ query });
      const answer = await request(
        server,
        `/api/queries/views-over-time?from=${RANGE.from}&to=${RANGE.to}&${suffix}`,
      );
      expect(answer.status).toBe(400);
      expect(query.runs).toHaveLength(0);
    },
  );
  it('refuses an interval on another query', async () => {
    const server = await serve();
    expect(
      (
        await request(
          server,
          `/api/queries/countries?from=${RANGE.from}&to=${RANGE.to}&granularity=1h`,
        )
      ).status,
    ).toBe(400);
  });
});

describe('minute reporting windows', () => {
  it('forwards explicit UTC minute bounds to the query port', async () => {
    const query = recordingQuery();
    const server = await serve({ query });
    const range = { from: '2026-09-05T12:37Z', to: '2026-09-05T15:37Z' };
    const answer = await request(server, `/api/queries/top-paths?${new URLSearchParams(range)}`);
    expect(answer.status).toBe(200);
    expect(query.runs[0]?.params.range).toEqual(range);
  });
  it.each([
    { from: '2026-09-05T15:37Z', to: '2026-09-05T15:37Z' },
    { from: '2026-09-05T16:37Z', to: '2026-09-05T15:37Z' },
    { from: '2026-02-30T12:37Z', to: '2026-09-05T15:37Z' },
    { from: '2026-09-05', to: '2026-09-05T15:37Z' },
    { from: '2026-09-05T12:37', to: '2026-09-05T15:37Z' },
  ])('rejects invalid timestamp bounds before invoking the port: %j', async (range) => {
    const query = recordingQuery();
    const server = await serve({ query });
    const answer = await request(server, `/api/queries/top-paths?${new URLSearchParams(range)}`);
    expect(answer.status).toBe(400);
    expect(query.runs).toHaveLength(0);
  });
});
