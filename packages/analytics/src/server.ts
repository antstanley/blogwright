/**
 * The package's **edge**: the one module that imports `node:http`, and the one
 * place an HTTP request becomes a call on the {@link AnalyticsQuery} port.
 * Everything below the port - `queries.ts`, `schema.ts`, the transform, the
 * nodes - is reached only through {@link createDashboardServer}, so a reviewer
 * who wants to know what a browser can make this package do reads this file
 * and stops. See [the change spec's §Analytics dashboard → Local
 * server](../../../.specs/changes/2026-07-26-analytics_plugin.md).
 *
 * **Loopback, always.** The listener binds {@link LOOPBACK_ADDRESS} - a named
 * constant, never `0.0.0.0` and never a wildcard - because the dashboard reads
 * the Iceberg table over the *operator's own* AWS credentials
 * (`adapters/duckdb-query.ts`). A wildcard bind would put an unauthenticated
 * read of the site's traffic, signed as the operator, on every interface the
 * machine has. The port is whatever the caller resolved from
 * `config.analytics.dashboard.port` (task 44); this module reads no
 * environment variable and states no port of its own, so
 * `DEFAULT_DASHBOARD_PORT` keeps the single home task 44 gave it. Contrast
 * the build agent (`packages/build-agent/src/server.ts`), which binds
 * `0.0.0.0` from `process.env.PORT` - correct for a MicroVM behind a security
 * group, wrong for a program holding an operator's session.
 *
 * **There is no route that accepts SQL, and that is structural rather than
 * filtered.** The request surface is exactly two families:
 *
 *   - `GET {@link QUERY_ROUTE_PREFIX}<name>` - one of the seven names
 *     `queries.ts` declares, resolved through that module's own
 *     {@link queryDefinition} lookup, which is `Object.hasOwn`-guarded so
 *     `constructor`, `toString` and `__proto__` are unknown names and not
 *     inherited functions. An unknown name answers 404 listing the ones that
 *     resolve.
 *   - everything else - a static file from `appDir`, served only if it is on
 *     the allow-list `FileSystem.listFiles(appDir)` returned.
 *
 * A caller therefore has nowhere to put a statement. The query string is
 * checked against {@link QUERY_STRING_PARAMS} and an unrecognised key is
 * *rejected*, not ignored, so `?sql=...` is a 400 and never a silently
 * dropped parameter; the only methods answered are `GET` and `HEAD` - the two
 * RFC 9110 §9.1 makes mandatory - and everything else is 405 naming them; and
 * no handler in this module attaches a `data` listener to a request, so a
 * request body is never a value this program holds. The type system says the
 * same thing one layer down - `AnalyticsQuery.run` takes a `QueryName`, and
 * `queries.ts` mints SQL only through a module-private tagged template - and
 * this module is where that guarantee would have been thrown away, because
 * here the compiler's knowledge of the name has already been erased to
 * `string`.
 *
 * **Nothing this module holds is ever concatenated into a statement.** The
 * date range and the bot-inclusion flag are parsed here, validated here
 * through task 45's own {@link prepareQuery}, and handed to
 * `AnalyticsQuery.run(name, params)` **unmodified**. The `PreparedQuery` that
 * validation returns is used for exactly one field, its `name` - the
 * `QueryName` the lookup just proved - and its `sql` is deliberately untouched:
 * a statement is the adapter's business, and an edge module that held one
 * would be one refactor away from letting a request shape it.
 *
 * **Loopback is not an origin, so the `Host` header is checked too.** Binding
 * {@link LOOPBACK_ADDRESS} keeps other *machines* out; it does nothing about
 * other *origins* in the operator's own browser. A page the operator visits
 * can point a hostname it controls at 127.0.0.1 and fetch this server through
 * that name - the DNS-rebinding shape - and because a browser judges
 * same-origin by hostname, that page reads the responses. This module sends no
 * CORS headers, and their absence is what refuses an ordinary cross-origin
 * read; the rebinding case defeats that precisely by making the origin match,
 * so no response header can answer it. What answers it is
 * {@link ALLOWED_HOST_NAMES}: a request whose `Host` is not this listener's own
 * address is refused with a 403 before anything else about it is read. The
 * exposure that closes is bounded - the site's own traffic figures, nothing
 * writable, no route that takes SQL - which is why it is three lines here
 * rather than a design.
 *
 * {@link COMMON_HEADERS} carries `X-Content-Type-Options: nosniff` on every
 * response for a neighbouring reason: `dist/app` is a build output whose file
 * names this module does not choose, and an extension {@link CONTENT_TYPES}
 * does not know is served as {@link DEFAULT_CONTENT_TYPE}, which a sniffing
 * browser is otherwise free to re-read as something it will execute.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, sep } from 'node:path';

import { FileNotFoundError, type FileSystem } from 'blogwright-core';

import type { AnalyticsConfig } from './config.js';
import type { AnalyticsQuery, QueryRow } from './ports.js';
import { prepareQuery, type QueryParams, queryDefinition } from './queries.js';

/**
 * The address the listener binds. A named constant because the assertion that
 * matters is on this exact value: a dashboard reachable from another host is
 * an unauthenticated read of the site's traffic under the operator's
 * credentials. `localhost` would not do - it resolves through the host's name
 * service, so it can be `::1`, both, or whatever a `/etc/hosts` entry says.
 */
const LOOPBACK_ADDRESS = '127.0.0.1';

/**
 * The host names a request may be addressed to, each paired with the bound
 * port to make the `Host` values this server answers. Two spellings because
 * both reach a loopback listener from a browser's address bar and the
 * dashboard prints one of them; anything else - a name that merely *resolves*
 * to 127.0.0.1 - is a different origin wearing this server's address, and is
 * refused. See this module's doc comment for why the bind alone does not cover
 * it.
 *
 * No entry is portless. Task 44 floors `dashboard.port` at 1024, so this
 * listener never holds a default port and a browser therefore always sends the
 * port in `Host`.
 */
const ALLOWED_HOST_NAMES = ['127.0.0.1', 'localhost'] as const;

/**
 * Headers on every response this module writes, whatever it is answering.
 * `nosniff` is here rather than beside one route because the reason for it -
 * a served file whose extension nothing in this module recognised - reaches
 * both the asset route and the refusals written about it.
 */
const COMMON_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
};

/** Path prefix under which the named queries - and nothing else - are answered. */
const QUERY_ROUTE_PREFIX = '/api/queries/';

/**
 * Every query-string key a named-query route accepts. An unrecognised key is
 * refused rather than ignored: ignoring it would mean `?sql=DROP TABLE …`
 * returned 200 with the fake having run a real query, which is a weaker
 * property than the one this server claims. `from` and `to` are the range
 * `queries.ts` binds; `includeBots` is the bot-inclusion flag, and is optional
 * because its default is `config.analytics.bots`, applied inside the port -
 * this module must not restate it.
 */
const QUERY_STRING_PARAMS = ['from', 'to', 'includeBots'] as const;

/** The two spellings the bot-inclusion flag takes, mapped to what it means. */
const INCLUDE_BOTS_VALUES: Readonly<Record<string, boolean>> = { true: true, false: false };

/**
 * The methods every route answers. `HEAD` is here because RFC 9110 §9.1 makes
 * it mandatory beside `GET`: no browser needs it, but `curl -I` and an uptime
 * probe both use it, and a 405 there reads as a broken server rather than a
 * deliberate one.
 *
 * It is answered *as* `GET` with the body suppressed - same status, same
 * headers, `content-length` included - which is why no handler below branches
 * on the method and why the asset route still reads the bytes it would have
 * sent. Node drops the payload itself once the request method is `HEAD`, so
 * the headers a probe reads are computed by the same code that serves a `GET`
 * rather than by a second path that could drift from it.
 */
const ALLOWED_METHODS = ['GET', 'HEAD'] as const;

/**
 * What a 405 reports as allowed. RFC 9110 §10.2.1 asks for the whole supported
 * set, so this is derived from {@link ALLOWED_METHODS} rather than restated.
 */
const ALLOW_HEADER = ALLOWED_METHODS.join(', ');

/** The file a directory-shaped request path resolves to, the way a static host resolves one. */
const DIRECTORY_INDEX = 'index.html';

/**
 * Content types for the extensions a built SvelteKit application emits. A
 * narrower copy of the build agent's map (`packages/build-agent/src/build.ts`)
 * rather than an import of it: that package is a deployed artifact, not a
 * dependency of this one, and this server hands out one prebuilt directory
 * rather than a user's arbitrary site.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
};

/** Served for any extension {@link CONTENT_TYPES} does not cover. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** What {@link createDashboardServer} is built from. */
export interface DashboardServerOptions {
  /**
   * The port every route reaches the table through. The *only* surface this
   * module touches below itself: `run(name, params)` and nothing wider, so
   * there is no statement to supply and no write path to reach. The dashboard
   * command constructs the DuckDB adapter and passes it here; a test passes
   * the fixture-backed fake from `fixture-query.ts`.
   */
  readonly query: AnalyticsQuery;
  /**
   * The validated `analytics` block, taken for its `bots` mode alone - what
   * {@link prepareQuery} needs to know whether an *absent* `includeBots`
   * counts bot rows. Passing it, rather than picking a mode here, is what
   * keeps the default in the one place task 44 put it.
   */
  readonly config: Pick<AnalyticsConfig, 'bots'>;
  /**
   * The port to bind, resolved from `config.analytics.dashboard.port`. Never
   * a literal at the call site and never `process.env`: task 44 owns the
   * default and its bounds.
   */
  readonly port: number;
  /**
   * The directory of prebuilt static files to serve - task 57's `dist/app`.
   * Absent until that task lands, which is a 503 naming this directory rather
   * than a stack trace.
   */
  readonly appDir: string;
  /**
   * How `appDir` is read. The `FileSystem` port, not `node:fs`: this package
   * imports no filesystem builtin anywhere, so the listing and the reads go
   * through the port the CLI already hands every plugin (`ctx.ports.fs`), and
   * a test serves an application that never touched a disk.
   */
  readonly fs: FileSystem;
}

/**
 * Where the listener actually ended up, read back off the socket rather than
 * assumed. Not exported, following `ports.ts`' `QueryValue`: no consumer needs
 * the type by name - one reaches it as `DashboardServer['address']` - and an
 * export nothing names is what `pnpm knip` reports. Export it when a real
 * consumer needs it by name.
 */
interface DashboardAddress {
  /** The bound host. Always {@link LOOPBACK_ADDRESS}; asserted, not trusted. */
  readonly host: string;
  /** The bound port - the one that was asked for, since this server never binds port 0 itself. */
  readonly port: number;
}

/** A running dashboard server. */
export interface DashboardServer {
  /** The address the listener is actually bound to. */
  readonly address: DashboardAddress;
  /** The URL to open, built from {@link address} rather than from the requested port. */
  readonly url: string;
  /**
   * Stop listening and release the port. Resolves once the listener is closed
   * and every open connection has been destroyed, so a caller that awaits it
   * can bind the same port again immediately. Idempotent.
   */
  close(): Promise<void>;
}

/** What an error says for itself, whether or not it is an `Error`. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A request this server refuses, carrying the status it refuses with. Private
 * to this module: it is how a rejection travels from the place that can name
 * the offending value to the place that writes a response, never a type a
 * caller observes.
 */
class RequestRejected extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Whether the response can still be written to. A client that dropped its
 * socket - or a shutdown that destroyed it out from under an in-flight
 * handler - leaves a response nothing can be sent on, and writing to it raises
 * from inside a handler that has nowhere to report.
 */
function writable(res: ServerResponse): boolean {
  return !res.writableEnded && !res.destroyed;
}

/** Write a JSON response. Every route in this module answers through here or {@link sendAsset}. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (!writable(res)) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // Traffic figures change under the reader; a cached chart is a wrong chart.
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * Write a static file's bytes. Unconditional: on a `HEAD` request Node keeps
 * the headers and discards the payload, so the `content-length` a probe reads
 * is the one a `GET` of the same path would have carried.
 */
function sendAsset(res: ServerResponse, contentType: string, bytes: Uint8Array): void {
  if (!writable(res)) return;
  res.writeHead(200, {
    ...COMMON_HEADERS,
    'content-type': contentType,
    'content-length': bytes.byteLength,
  });
  res.end(Buffer.from(bytes));
}

/**
 * The lowercase extension of a path, or `undefined` when it has none - a
 * leading dot is a dotfile, not an extension. Mirrors `extensionOf`
 * (`packages/build-agent/src/build.ts`).
 */
function extensionOf(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Content type for a served file. Guarded with `Object.hasOwn` for the reason
 * `contentType` (`packages/build-agent/src/build.ts`) is: an unguarded index
 * answers every `Object.prototype` key, so a file named `x.constructor` would
 * resolve to a truthy function and be written into a header.
 */
function contentTypeOf(path: string): string {
  const extension = extensionOf(path);
  if (extension === undefined) return DEFAULT_CONTENT_TYPE;
  const type = Object.hasOwn(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : undefined;
  return type ?? DEFAULT_CONTENT_TYPE;
}

/**
 * The name a query route asks for. Deliberately **not** percent-decoded: every
 * name `queries.ts` declares is an ASCII identifier, so decoding would only
 * mint second spellings of the same name (`%63ountries`), and anything that
 * needs decoding to look like a name is not one. What resolves is exactly what
 * {@link queryDefinition} holds as an own key.
 */
function requestedQueryName(pathname: string): string {
  return pathname.slice(QUERY_ROUTE_PREFIX.length);
}

/**
 * Read one required query-string value, refusing an absent one rather than
 * standing in a window the server picked - a chart over a range the reader did
 * not choose is indexed by nothing. `searchParams.get` answers `null` for an
 * absent key, which never becomes a value here: absence raises.
 */
function requiredParam(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (value === null) {
    throw new RequestRejected(
      400,
      `missing required query parameter "${key}" - this route takes ${QUERY_STRING_PARAMS.join(', ')}`,
    );
  }
  return value;
}

/**
 * Parse the request's parameters into the {@link QueryParams} the port takes.
 * An unrecognised key is refused here, which is what makes "no route accepts
 * SQL" a property of the routing layer rather than of what the port happens to
 * ignore.
 */
function parseQueryParams(search: URLSearchParams): QueryParams {
  for (const key of search.keys()) {
    if (!QUERY_STRING_PARAMS.some((known) => known === key)) {
      throw new RequestRejected(
        400,
        `unknown query parameter "${key}" - this route takes ${QUERY_STRING_PARAMS.join(', ')} and nothing else`,
      );
    }
  }

  const range = { from: requiredParam(search, 'from'), to: requiredParam(search, 'to') };
  const flag = search.get('includeBots');
  if (flag === null) {
    // Absent on purpose: `config.analytics.bots` decides, inside the port.
    return { range };
  }
  if (!Object.hasOwn(INCLUDE_BOTS_VALUES, flag)) {
    throw new RequestRejected(
      400,
      `query parameter "includeBots" must be ${Object.keys(INCLUDE_BOTS_VALUES).join(' or ')}, got "${flag}"`,
    );
  }
  return { range, includeBots: INCLUDE_BOTS_VALUES[flag] };
}

/**
 * Start the dashboard's HTTP listener on {@link LOOPBACK_ADDRESS}. Resolves
 * once the socket is bound, with the address read back off it, so a caller
 * prints where the server *is* rather than where it was asked to be.
 */
export async function createDashboardServer(
  opts: DashboardServerOptions,
): Promise<DashboardServer> {
  /**
   * The files `appDir` holds, keyed by the URL path that serves each one. An
   * **allow-list**, and that is the whole traversal defence: a request path is
   * looked up in this map and a miss is a 404, so `..`, `%2e%2e`, an absolute
   * path and a symlink alike name nothing that can be served. No path
   * arithmetic decides what escapes the directory, because none is done -
   * contrast `resolveWithin` (`packages/build-agent/src/build.ts`), which has
   * to get a containment check right because it resolves a caller's string.
   *
   * Read once, lazily, and cached on success only, following the DuckDB
   * adapter's session: the listener therefore binds before any filesystem is
   * consulted, and a run started before task 57's `dist/app` existed picks the
   * directory up once it does rather than repeating the first failure forever.
   */
  let listing: Promise<ReadonlyMap<string, string>> | undefined;

  /**
   * The `Host` values this listener answers - {@link ALLOWED_HOST_NAMES}, each
   * with the port the socket actually bound. Built from the *bound* port and
   * not from `opts.port`, so a caller that asks for port 0 gets an allow-list
   * naming the port it really got; assigned inside the `listen` callback,
   * before the promise below resolves, so it is already set by the time the
   * listener can be connected to at all. `undefined` therefore refuses rather
   * than admitting: a request this server cannot name its own address for is
   * not one it should answer.
   */
  let allowedHostHeaders: ReadonlySet<string> | undefined;

  /**
   * Refuse a request addressed to a name that is not this listener's own. The
   * body is drained rather than left unread, for the reason the 405 path
   * drains it: nothing here reads a body, and an undrained socket stalls.
   */
  function rejectForeignHost(req: IncomingMessage): void {
    const host = req.headers.host?.toLowerCase();
    if (host !== undefined && allowedHostHeaders?.has(host) === true) return;
    req.resume();
    throw new RequestRejected(
      403,
      `this dashboard answers only ${[...(allowedHostHeaders ?? [])].join(' and ')} - a request for host ${host === undefined ? '<absent>' : `"${host}"`} is addressed to some other origin that resolved to this address`,
    );
  }

  async function readAppFiles(): Promise<ReadonlyMap<string, string>> {
    const entries = await opts.fs.listFiles(opts.appDir);
    // `listFiles` answers platform-separated relative paths; a URL path is
    // always `/`-separated, so the key is normalised and the value keeps the
    // form the port will be asked to read back.
    return new Map(entries.map((entry) => [entry.split(sep).join('/'), entry]));
  }

  function appFiles(): Promise<ReadonlyMap<string, string>> {
    const pending = (listing ??= readAppFiles());
    return pending.catch((err: unknown) => {
      if (listing === pending) listing = undefined;
      throw err;
    });
  }

  async function handleQuery(pathname: string, search: URLSearchParams): Promise<unknown> {
    const name = requestedQueryName(pathname);

    // The unknown-name guard. `queryDefinition` raises listing every name that
    // resolves, and its `Object.hasOwn` lookup is why an inherited key
    // (`constructor`, `toString`, `__proto__`) is an unknown name here rather
    // than a truthy definition that fails deeper in.
    let definition;
    try {
      definition = queryDefinition(name);
    } catch (err) {
      throw new RequestRejected(404, describeError(err));
    }

    const params = parseQueryParams(search);

    // Task 45's own parameter validation, run at the boundary so a malformed
    // or inverted range is a 400 naming the offending value rather than a 500
    // raised from inside the port. Exactly one field of the result is used -
    // `name`, the `QueryName` the lookup above proved - and `sql` is left
    // untouched: see this module's doc comment.
    let resolved;
    try {
      resolved = prepareQuery(name, params, opts.config);
    } catch (err) {
      throw new RequestRejected(400, describeError(err));
    }

    // `params` goes through unmodified. Nothing between the request and this
    // call reshapes a caller's value, and nothing concatenates one.
    const rows: readonly QueryRow[] = await opts.query.run(resolved.name, params);
    return {
      name: resolved.name,
      rowMeaning: definition.rowMeaning,
      resultColumns: definition.resultColumns,
      rows,
    };
  }

  async function handleAsset(pathname: string, res: ServerResponse): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new RequestRejected(400, `path "${pathname}" is not valid percent-encoding`);
    }
    const trimmed = decoded.replace(/^\/+/, '');
    const key = trimmed === '' || trimmed.endsWith('/') ? `${trimmed}${DIRECTORY_INDEX}` : trimmed;

    let files: ReadonlyMap<string, string>;
    try {
      files = await appFiles();
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        throw new RequestRejected(
          503,
          `the dashboard application has not been built: no directory at ${opts.appDir}`,
        );
      }
      throw err;
    }

    const relative = files.get(key);
    if (relative === undefined) throw new RequestRejected(404, `no such file "${key}"`);
    sendAsset(res, contentTypeOf(key), await opts.fs.readBytes(join(opts.appDir, relative)));
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // First, and before the method: "is this addressed to me" precedes "may
    // you do that here", and a page on some other origin should learn nothing
    // about this server - not even which methods it answers.
    rejectForeignHost(req);

    if (!ALLOWED_METHODS.some((allowed) => allowed === req.method)) {
      // Refused on the method alone, before anything about the request is
      // read. No handler in this module attaches a `data` listener, so a body
      // - SQL or otherwise - is never a value this program holds; `resume`
      // drains and discards it so the socket does not stall.
      req.resume();
      res.setHeader('allow', ALLOW_HEADER);
      throw new RequestRejected(
        405,
        `${String(req.method)} is not allowed - this server answers ${ALLOW_HEADER}`,
      );
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${LOOPBACK_ADDRESS}`);
    } catch {
      throw new RequestRejected(400, 'the request target is not a URL');
    }

    if (url.pathname.startsWith(QUERY_ROUTE_PREFIX)) {
      sendJson(res, 200, await handleQuery(url.pathname, url.searchParams));
      return;
    }
    await handleAsset(url.pathname, res);
  }

  const server: Server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      if (!writable(res)) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = err instanceof RequestRejected ? err.status : 500;
      sendJson(res, status, { error: describeError(err) });
    });
  });
  // The build agent's precedent: a malformed request line kills its own socket
  // rather than the process.
  server.on('clientError', (_err, socket) => socket.destroy());

  const address = await new Promise<DashboardAddress>((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(
        new Error(
          `analytics dashboard cannot bind ${LOOPBACK_ADDRESS}:${opts.port}: ${err.message}`,
        ),
      );
    };
    server.once('error', onError);
    server.listen(opts.port, LOOPBACK_ADDRESS, () => {
      server.off('error', onError);
      const bound = server.address();
      if (bound === null || typeof bound === 'string') {
        reject(new Error(`analytics dashboard bound no TCP address on port ${opts.port}`));
        return;
      }
      allowedHostHeaders = new Set(ALLOWED_HOST_NAMES.map((name) => `${name}:${bound.port}`));
      resolve({ host: bound.address, port: bound.port });
    });
  });

  let closed: Promise<void> | undefined;

  return {
    address,
    url: `http://${address.host}:${address.port}/`,

    close(): Promise<void> {
      // Idempotent: a caller that stops on a signal and a caller that stops
      // explicitly may both arrive, and `Server.close` calls back with
      // ERR_SERVER_NOT_RUNNING the second time.
      closed ??= new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Without this a keep-alive connection holds the port after `close`
        // resolves nothing, and the caller's next bind fails with EADDRINUSE.
        server.closeAllConnections();
      });
      return closed;
    },
  };
}
