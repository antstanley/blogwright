/**
 * The `analytics dashboard` command - the plugin's composition root - driven
 * end to end with **no seam injected**: the real `createDuckDbAnalyticsQuery`,
 * the real `createCredentialProvider` and the real listener. That is
 * affordable, and worth more than a stubbed version, because the adapter opens
 * its DuckDB connection lazily and resolves its credentials inside that
 * connection: constructing it touches neither the native library nor AWS. So
 * these tests exercise the actual wiring while starting no DuckDB - which is
 * itself part of what they assert, since a command that reached for either
 * before binding would fail here without an AWS session.
 *
 * The routes the tests drive are therefore the static ones. Nothing in this
 * file requests `/api/queries/...`: that is where the real adapter *would*
 * open a connection, and `server.test.ts` already covers the data plane
 * against the fixture-backed fake.
 */

import { createServer as createSocketServer } from 'node:net';
import { join } from 'node:path';

import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  mergeConfig,
  parseConfig,
  staticCredentials,
  StateStore,
  stripColors,
  type PluginContext,
  type PluginLogger,
  type RawResponse,
  type ResourceNode,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { dashboard, status, type DashboardCommandContext } from './commands.js';
import { DEFAULT_DASHBOARD_PORT, validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import { createFixtureAnalyticsQuery, type FixtureAnalyticsQuery } from './fixture-query.js';
import type { AnalyticsQuery } from './ports.js';
import { ROW_COUNT_COLUMN, ROW_COUNT_QUERY, WHOLE_TABLE_RANGE } from './queries.js';
import { buildAnalyticsNodes } from './nodes.js';
import { ANALYTICS_PACKAGE_DIR } from './paths.js';
import { createDashboardServer } from './server.js';
import { TRANSFORM_BUNDLE_DIR, TRANSFORM_MANIFEST_FILE } from './transform-hash.js';

/** The signals the command stops on, restated so the assertion is independent of the module. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** A terminal the command never touches - it reports through `ctx.logger`. */
const SILENT_TERMINAL: Terminal = {
  isInteractive: false,
  write: () => {},
  error: () => {},
  status: () => {},
  question: async () => '',
};

/** A recording {@link PluginLogger}, keeping each line beside the level it arrived at. */
interface RecordingLogger extends PluginLogger {
  readonly lines: readonly string[];
}

function recordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const at =
    (level: string) =>
    (msg: string): void => {
      lines.push(`${level} ${msg}`);
    };
  return {
    lines,
    info: at('info'),
    step: at('step'),
    ok: at('ok'),
    warn: at('warn'),
    error: at('error'),
  };
}

/** What one test drives the command with. */
interface TestContext extends DashboardCommandContext {
  readonly logger: RecordingLogger;
}

function contextFor(port?: number): TestContext {
  const logger = recordingLogger();
  return {
    env: 'production',
    config: parseConfig(JSON.stringify({ siteName: 'example', region: 'us-east-1' })),
    pluginConfig: validateAnalyticsConfig(port === undefined ? {} : { dashboard: { port } }),
    accountId: '123456789012',
    // An in-memory filesystem holding nothing: the prebuilt application (task
    // 57's `dist/app`) does not exist beside the sources, which is the state a
    // reader of this suite should expect the static route to report.
    ports: { fs: createMemoryFileSystem({}), terminal: SILENT_TERMINAL },
    logger,
  };
}

/**
 * A free port, obtained through a bare socket. Independent of the server the
 * command starts, so a command that bound a literal instead of the configured
 * port cannot hand this helper that same literal back and make the assertion
 * agree with the bug.
 */
async function freePort(): Promise<number> {
  const probe = createSocketServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
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

/** Spin the event loop until `condition` holds, so no test races the command's own start-up. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
  }
  throw new Error(`waited for ${what} and it never happened`);
}

/** The URL the command printed, taken out of the line it printed it on. */
function announcedUrl(logger: RecordingLogger): string {
  const line = logger.lines.find((entry) => entry.includes('http://'));
  if (line === undefined) throw new Error(`no URL announced; logged ${logger.lines.join(' | ')}`);
  return /http:\/\/\S+/.exec(line)?.[0] ?? '';
}

/**
 * Run the command, wait until it has announced its URL, hand control back, and
 * stop it with `signal`. The command's promise is awaited before returning, so
 * a test that reaches the end has seen the shutdown path run to completion.
 */
async function withDashboard(
  ctx: TestContext,
  signal: (typeof STOP_SIGNALS)[number],
  body: (url: string) => Promise<void>,
): Promise<void> {
  const done = dashboard(ctx);
  try {
    await waitFor(() => ctx.logger.lines.length > 0, 'the dashboard to announce its URL');
    await body(announcedUrl(ctx.logger));
  } finally {
    process.emit(signal, signal);
    await done;
  }
}

describe('analytics dashboard', () => {
  it('binds the loopback address on the configured port and says where', async () => {
    const port = await freePort();
    const ctx = contextFor(port);

    await withDashboard(ctx, 'SIGINT', async (url) => {
      expect(url).toBe(`http://127.0.0.1:${port}/`);
      // Announced *and* answering there - the URL is not merely a formatted string.
      const response = await fetch(url);
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('has not been built');
    });

    expect(ctx.logger.lines[0]).toBe(
      `info analytics dashboard on http://127.0.0.1:${port}/ - press Ctrl+C to stop`,
    );
  });

  it("takes the port from task 44's default when the operator configured none", async () => {
    const ctx = contextFor();
    await withDashboard(ctx, 'SIGINT', async (url) => {
      expect(url).toBe(`http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}/`);
    });
  });

  it.each(STOP_SIGNALS)('releases the listener on %s', async (signal) => {
    const port = await freePort();
    const ctx = contextFor(port);

    await withDashboard(ctx, signal, async (url) => {
      expect((await fetch(url)).status).toBe(503);
    });

    expect(ctx.logger.lines).toContain(
      `info ${signal} received - stopping the analytics dashboard`,
    );
    expect(ctx.logger.lines.at(-1)).toBe(`ok analytics dashboard stopped; port ${port} released`);

    // The port is genuinely free: a fresh listener takes it immediately.
    const rebound = await createDashboardServer({
      query: createFixtureAnalyticsQuery({}),
      config: validateAnalyticsConfig({}),
      port,
      appDir: '/nowhere',
      fs: createMemoryFileSystem({}),
    });
    expect(rebound.address.port).toBe(port);
    await rebound.close();
  });

  it('leaves no signal listener behind once it has stopped', async () => {
    const before = STOP_SIGNALS.map((signal) => process.listenerCount(signal));
    const ctx = contextFor(await freePort());

    await withDashboard(ctx, 'SIGTERM', async () => {
      // While running, the command owns one listener per stop signal.
      for (const [index, signal] of STOP_SIGNALS.entries()) {
        expect(process.listenerCount(signal)).toBe((before[index] ?? 0) + 1);
      }
    });

    expect(STOP_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  it('fails with an actionable message when the configured port is already held', async () => {
    const port = await freePort();
    const held = await createDashboardServer({
      query: createFixtureAnalyticsQuery({}),
      config: validateAnalyticsConfig({}),
      port,
      appDir: '/nowhere',
      fs: createMemoryFileSystem({}),
    });
    const ctx = contextFor(port);
    const before = STOP_SIGNALS.map((signal) => process.listenerCount(signal));
    try {
      await expect(dashboard(ctx)).rejects.toThrow(`cannot bind 127.0.0.1:${port}`);
      // Nothing was announced and nothing was left registered.
      expect(ctx.logger.lines).toEqual([]);
      expect(STOP_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(before);
    } finally {
      await held.close();
    }
  });
});

/* ------------------------------------------------------------------------- *
 * TASK 54 - the node graph this plugin contributes, and the state it writes.
 *
 * Two properties live here and they are different in kind. The first is about
 * the SHAPE of the array `buildAnalyticsNodes` returns - its ids, its edges and
 * its titles - and is pure data, so it is asserted directly. The second is
 * about the STATE a reconcile over that array writes, and needs the nodes
 * actually run.
 *
 * **Neither of them runs the CLI's engine, and that is not an accident.**
 * `topoSort`, `applyGraph` and `destroyGraph` live in `packages/cli/src/graph.ts`
 * and a plugin may not import the CLI (§CLI -> Plugin dispatch), so the
 * engine-level half of this task - `analytics bootstrap` and `analytics destroy
 * --yes` dispatched through `runPlugin`, the `create <title>` lines the verb
 * prints, and the refusal without `--yes` - is asserted in
 * `packages/cli/src/plugin-commands.test.ts` against a stand-in graph of its own.
 * What connects the two halves is the title assertion below: the CLI's engine is
 * proved to print `create <title>` for every node it walks, and these titles are
 * proved to carry `us-east-1`, so the region statement reaches an operator's
 * bootstrap output. Neither half is sufficient alone and neither restates the
 * other.
 *
 * {@link reconcile} and {@link tearDown} below are this file's own drivers, not
 * a second engine: they walk an array a test already holds in a known order,
 * they compute nothing, and nothing in `src/` calls them. What they restate is
 * `applyGraph`/`destroyGraph`'s CONTRACT - read, then create or update, then
 * `save()`; and in reverse, delete, forget, `save()`, then `store.delete()` -
 * which is exactly what has to run for the state assertions to mean anything.
 * ------------------------------------------------------------------------- */

/** The ids the change spec's §Analytics pipeline -> Resource nodes table lists, in its order. */
const ANALYTICS_NODE_IDS = [
  'analytics-table-bucket',
  'analytics-namespace',
  'analytics-table',
  'analytics-catalog-integration',
  'analytics-salt-secret',
  'analytics-transform-log-group',
  'analytics-transform-role',
  'analytics-transform-function',
  'analytics-error-bucket',
  'analytics-firehose-log-group',
  'analytics-firehose-role',
  'analytics-firehose-stream',
  'analytics-log-destination',
  'analytics-log-delivery',
];

/**
 * The edges the spec's ordering states, hand-typed rather than read off the
 * module under test - a table derived from `dependsOn` would agree with any
 * `dependsOn`, including a wrong one.
 *
 * Three of them are the ones a reader is most likely to think redundant, and
 * each is load-bearing. `analytics-firehose-role` names `analytics-table` and
 * `analytics-transform-function` because its inline policy interpolates their
 * recorded ARNs. `analytics-firehose-stream` names those two and
 * `analytics-catalog-integration` because its destination does. Drop any of
 * them and `topoSort`'s alphabetical drain of zero-indegree nodes runs the
 * dependent first, and the ARN it interpolates is not there yet.
 *
 * Two more are of a different kind: `analytics-transform-function` names
 * `analytics-transform-log-group` and `analytics-firehose-stream` names
 * `analytics-firehose-log-group`, and neither reads an ARN off the group it
 * names. They order a writer behind the group that holds its output, and on
 * teardown they order the group's removal behind the writer's. Alphabetically
 * both groups would drain early anyway, which is exactly why the edges are
 * declared rather than left to that.
 *
 * **Neither role names a group**, and this table asserts by equality rather
 * than containment so that adding one would fail here. A role's policy derives
 * its log group ARN from the function or stream name rather than reading a
 * recorded one, so there is no output to wait for and an edge would state a
 * dependency that does not exist.
 */
const ANALYTICS_EDGES: Record<string, string[]> = {
  'analytics-table-bucket': [],
  'analytics-namespace': ['analytics-table-bucket'],
  'analytics-table': ['analytics-namespace'],
  'analytics-catalog-integration': ['analytics-table'],
  'analytics-salt-secret': [],
  'analytics-transform-log-group': [],
  'analytics-transform-role': ['analytics-salt-secret'],
  'analytics-transform-function': ['analytics-transform-role', 'analytics-transform-log-group'],
  'analytics-error-bucket': [],
  'analytics-firehose-log-group': [],
  'analytics-firehose-role': [
    'analytics-error-bucket',
    'analytics-table',
    'analytics-transform-function',
  ],
  'analytics-firehose-stream': [
    'analytics-firehose-role',
    'analytics-table',
    'analytics-catalog-integration',
    'analytics-transform-function',
    'analytics-firehose-log-group',
  ],
  'analytics-log-destination': ['analytics-firehose-stream'],
  'analytics-log-delivery': ['analytics-log-destination'],
};

/**
 * The region every node's title has to state, spelled out here rather than
 * imported: `ANALYTICS_REGION` is module-private to `nodes.ts`, and a test that
 * read the constant would agree with any value it was set to.
 */
const PINNED_REGION = 'us-east-1';

describe('buildAnalyticsNodes - the graph the plugin contributes', () => {
  it("returns the spec table's fourteen nodes, by id, in its order", () => {
    expect(ANALYTICS_NODE_IDS).toHaveLength(14);
    expect(buildAnalyticsNodes().map((node) => node.id)).toEqual(ANALYTICS_NODE_IDS);
  });

  it("wires the four chains the spec's ordering states, edge for edge", () => {
    const edges = Object.fromEntries(
      buildAnalyticsNodes().map((node) => [node.id, [...node.dependsOn]]),
    );
    expect(edges).toEqual(ANALYTICS_EDGES);
  });

  it('names no dependency outside the set, and none later in it - the witness that makes a second topoSort unnecessary', () => {
    // `topoSort` (`packages/cli/src/graph.ts`) has exactly two failure modes: a
    // `dependsOn` entry naming a node outside the set, and a cycle. This one
    // walk rules out both, and does so without a second copy of Kahn's
    // algorithm living in this package. Every dependency appearing EARLIER in
    // the returned array is a topological ordering of the graph, and a graph
    // with a topological ordering has no cycle - so an array that passes this
    // is an array `topoSort` accepts.
    const seen = new Set<string>();
    const ids = new Set(buildAnalyticsNodes().map((node) => node.id));
    for (const node of buildAnalyticsNodes()) {
      for (const dep of node.dependsOn) {
        expect(ids).toContain(dep);
        expect(seen).toContain(dep);
      }
      seen.add(node.id);
    }
    expect(seen.size).toBe(ANALYTICS_NODE_IDS.length);
  });

  it(`states the ${PINNED_REGION} pin in every node title, so the create lines the generic verb prints carry it`, () => {
    const titles = buildAnalyticsNodes().map((node) => node.title);
    // Distinct, and each names something: `applyGraph` prints one line per node
    // keyed on the title alone, so two nodes sharing one would make the output
    // unreadable and would let a missing node pass unnoticed.
    expect(new Set(titles).size).toBe(ANALYTICS_NODE_IDS.length);
    for (const title of titles) {
      expect(title).toContain(PINNED_REGION);
    }
    // The two IAM roles state the pin as the pipeline they serve rather than as
    // where they were created, because IAM is global and "created in us-east-1"
    // is not a property a role has (§Region pinning). A title claiming
    // otherwise would be the pin stated falsely, which is worse than not
    // stating it.
    for (const id of ['analytics-transform-role', 'analytics-firehose-role']) {
      const node = buildAnalyticsNodes().find((candidate) => candidate.id === id);
      expect(node?.title).toContain('global');
    }
  });
});

/** The environment every case below reconciles. */
const RECONCILE_ENV = 'test';

/** The site name the derived names hang off. */
const RECONCILE_SITE = 'example';

const RECONCILE_ACCOUNT = '123456789012';

/**
 * The site's own region, and deliberately NOT us-east-1: every request the
 * plugin's own clients make is pinned, so a fixture in us-east-1 would let a
 * node that reached for `ctx.clients` instead of the plugin's bundle pass. It
 * is also what separates the two S3 hosts in {@link analyticsWorld} - the
 * state bucket is addressed in this region and the error bucket in the pinned
 * one.
 */
const RECONCILE_REGION = 'eu-west-1';

/** `deriveNames`' `<env>-<siteName>-<accountId>`: the bucket BOTH state objects live in. */
const STATE_BUCKET = `${RECONCILE_ENV}-${RECONCILE_SITE}-${RECONCILE_ACCOUNT}`;

/** `stateKey(env, 'analytics')` (`packages/core/src/state.ts`) - the only state object this plugin may touch. */
const SCOPED_STATE_KEY = `state/${RECONCILE_ENV}.analytics.json`;

/** `stateKey(env)` - the SITE's own state object, which nothing here may read, write or delete. */
const SITE_STATE_KEY = `state/${RECONCILE_ENV}.json`;

/** The site's CloudFront distribution, read through `ctx.siteState` by `analytics-log-delivery` and never written. */
const SITE_DISTRIBUTION_ARN = `arn:aws:cloudfront::${RECONCILE_ACCOUNT}:distribution/E2ABCDEF`;

/**
 * The source hash the fixture manifest carries, and the same value seeded into
 * the transform function's recorded outputs. Matching means
 * `transformUpdate` reports no code change, so the reconcile never reaches
 * `packTransformBundle` - which is deliberate twice over: this suite is about
 * state keys and not about zip bytes, and `zipSync`'s fixed 1980 `mtime`
 * throws under any timezone whose 1980 UTC offset was negative (recorded in
 * plan.md's Open questions), which would make these tests fail for a reason
 * that has nothing to do with what they assert.
 */
const RECONCILE_BUNDLE_HASH = 'a1b2c3d4e5f6';

/** One request the recording transport saw. */
interface RecordedCall {
  readonly method: string;
  readonly url: string;
}

function reply(statusCode: number, text: string): RawResponse {
  return {
    statusCode,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

function jsonReply(body: unknown): RawResponse {
  return reply(200, JSON.stringify(body));
}

function xmlReply(body: string): RawResponse {
  return reply(200, `<?xml version="1.0" encoding="UTF-8"?>${body}`);
}

/** The `Action` of an IAM (query-protocol, form-encoded) request body. */
function iamAction(body: string): string {
  return new URLSearchParams(body).get('Action') ?? '';
}

/** IAM's reply for whichever role the request named, so `getRoleArn` answers a real ARN for both roles. */
function iamReply(body: string): RawResponse {
  const params = new URLSearchParams(body);
  const action = iamAction(body);
  const name = params.get('RoleName') ?? '';
  if (action === 'GetRole') {
    return xmlReply(
      `<GetRoleResponse><GetRoleResult><Role><RoleName>${name}</RoleName>` +
        `<Arn>arn:aws:iam::${RECONCILE_ACCOUNT}:role/${name}</Arn></Role></GetRoleResult></GetRoleResponse>`,
    );
  }
  if (action === 'ListRolePolicies') {
    return xmlReply(
      '<ListRolePoliciesResponse><ListRolePoliciesResult><PolicyNames></PolicyNames>' +
        '<IsTruncated>false</IsTruncated></ListRolePoliciesResult></ListRolePoliciesResponse>',
    );
  }
  return xmlReply(
    `<${action}Response><ResponseMetadata><RequestId>req</RequestId></ResponseMetadata></${action}Response>`,
  );
}

/**
 * How one of the worlds below answers. Both flags default off, so
 * `analyticsWorld()` is exactly the permissive world task 54 wrote and every
 * one of its assertions is unchanged by their existence.
 */
interface WorldOptions {
  /**
   * Answer every lookup "this does not exist", in each service's own failure
   * shape - the account of an operator who has never run `analytics
   * bootstrap`. The state object 404s in both worlds, so the scoped state is
   * empty either way.
   */
  readonly unbootstrapped?: boolean;
  /**
   * Refuse `DescribeDeliveryStream` with an authorization failure rather than
   * describing the stream, leaving the other eleven nodes readable - the
   * shape a deploy role missing one permission actually takes.
   */
  readonly streamReadDenied?: boolean;
  /**
   * Describe a stream that exists but is in `CREATING_FAILED`, carrying the
   * service's `FailureDescription`. The stream node reports such a stream
   * present on purpose (see its `read`), which is what leaves the health line
   * as the only place an operator can learn that nothing is being delivered.
   */
  readonly streamCreateFailed?: boolean;
}

/** The `FailureDescription` the failed-stream world reports, flattened by the client to `Type: Details`. */
const STREAM_FAILURE = {
  Type: 'CREATE_KMS_GRANT_FAILED',
  Details: 'the delivery role cannot use the configured KMS key',
};

/** An error reply whose exception name travels in the header, as S3 Tables and Lambda send it. */
function headerErrorReply(statusCode: number, exception: string, message: string): RawResponse {
  const text = JSON.stringify({ message });
  return {
    statusCode,
    headers: { 'x-amzn-errortype': exception },
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** An error reply whose exception name travels in the body, as Glue, Secrets Manager and Firehose send it. */
function bodyErrorReply(statusCode: number, code: string, message: string): RawResponse {
  const text = JSON.stringify({ __type: code, message });
  return {
    statusCode,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/**
 * The log group a `DescribeLogGroups` asked about, out of its AWS-JSON body.
 * Throws rather than answering a sentinel: a request the fixture cannot read
 * must fail the test that made it, not be answered with a group named nothing.
 */
function describedLogGroup(body: unknown): string {
  const parsed: unknown = JSON.parse(String(body ?? ''));
  const prefix =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { logGroupNamePrefix?: unknown }).logGroupNamePrefix
      : undefined;
  if (typeof prefix !== 'string' || prefix === '') {
    throw new Error(`DescribeLogGroups with no logGroupNamePrefix: ${String(body)}`);
  }
  return prefix;
}

/** IAM's REST-XML failure - the one service whose not-found is read off a `<Code>` element. */
function iamErrorReply(statusCode: number, code: string, message: string): RawResponse {
  const text = `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>req</RequestId></ErrorResponse>`;
  return {
    statusCode,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/**
 * A permissive stand-in for the nine AWS services the fourteen nodes talk to,
 * answering "this already exists" to every lookup and success to every
 * mutation.
 *
 * **It is deliberately an oracle rather than a script, and that is safe here
 * because of what these tests assert.** They do not assert what the nodes sent
 * - `nodes.test.ts` owns that, request by request, against scripted replies
 * that run out if a node makes a call the test did not account for. What these
 * assert is which STATE OBJECTS were written while all fourteen ran, and for
 * that the fixture's job is only to let all fourteen run to completion. The
 * non-vacuity check is separate and explicit: every one of the fourteen has to
 * appear in the plugin's own `state.resources` afterwards, so a world permissive
 * enough to let a node no-op silently would fail the test rather than pass it.
 *
 * An unrecognised host throws rather than answering: a node reaching a service
 * nobody accounted for must fail here, not be fed an empty object.
 */
function analyticsWorld(options: WorldOptions = {}): {
  transport: Transport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const absent = options.unbootstrapped === true;
  const transport: Transport = async (req) => {
    calls.push({ method: req.method, url: req.url });
    const url = new URL(req.url);
    const host = url.hostname;
    const target = req.headers['x-amz-target'] ?? '';

    if (host === 'iam.amazonaws.com') {
      const body = String(req.body ?? '');
      if (absent && iamAction(body) === 'GetRole') {
        return iamErrorReply(404, 'NoSuchEntity', 'The role cannot be found.');
      }
      return iamReply(body);
    }

    if (host.startsWith('s3tables.')) {
      if (absent) {
        return headerErrorReply(404, 'NotFoundException', 'The specified resource does not exist.');
      }
      if (url.pathname.startsWith('/buckets/')) {
        return jsonReply({
          arn: `arn:aws:s3tables:${PINNED_REGION}:${RECONCILE_ACCOUNT}:bucket/${RECONCILE_ENV}-${RECONCILE_SITE}-analytics`,
          name: `${RECONCILE_ENV}-${RECONCILE_SITE}-analytics`,
        });
      }
      if (url.pathname.startsWith('/namespaces/')) return jsonReply({ namespace: ['web'] });
      if (url.pathname === '/get-table') {
        return jsonReply({
          tableARN: `arn:aws:s3tables:${PINNED_REGION}:${RECONCILE_ACCOUNT}:bucket/${RECONCILE_ENV}-${RECONCILE_SITE}-analytics/table/60d1f8a2`,
          name: 'page_views',
        });
      }
      return jsonReply({});
    }

    if (host.startsWith('glue.')) {
      if (absent) return bodyErrorReply(400, 'EntityNotFoundException', 'Entity Not Found');
      // Federated over the account-and-region wildcard `federationSource`
      // derives; anything else and `verifiedSource` throws rather than adopting it.
      return jsonReply({
        Catalog: {
          Name: 's3tablescatalog',
          CatalogId: 's3tablescatalog',
          ResourceArn: `arn:aws:glue:${PINNED_REGION}:${RECONCILE_ACCOUNT}:catalog/s3tablescatalog`,
          FederatedCatalog: {
            Identifier: `arn:aws:s3tables:${PINNED_REGION}:${RECONCILE_ACCOUNT}:bucket/*`,
            ConnectionName: 'aws:s3tables',
          },
        },
      });
    }

    if (host.startsWith('secretsmanager.')) {
      if (absent) {
        return bodyErrorReply(
          400,
          'ResourceNotFoundException',
          "Secrets Manager can't find the specified secret.",
        );
      }
      return jsonReply({
        ARN: `arn:aws:secretsmanager:${PINNED_REGION}:${RECONCILE_ACCOUNT}:secret:${RECONCILE_SITE}/${RECONCILE_ENV}/analytics-salt-AbCdEf`,
        Name: `${RECONCILE_SITE}/${RECONCILE_ENV}/analytics-salt`,
      });
    }

    if (host.startsWith('lambda.')) {
      if (absent) {
        return headerErrorReply(404, 'ResourceNotFoundException', 'Function not found');
      }
      if (req.method === 'GET') {
        return jsonReply({
          Configuration: {
            FunctionName: `${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-transform`,
            FunctionArn: `arn:aws:lambda:${PINNED_REGION}:${RECONCILE_ACCOUNT}:function:${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-transform`,
            State: 'Active',
          },
        });
      }
      return jsonReply({});
    }

    if (host.startsWith('firehose.')) {
      if (target.endsWith('.DescribeDeliveryStream')) {
        if (options.streamReadDenied === true) {
          return bodyErrorReply(
            403,
            'AccessDeniedException',
            'not authorized to perform firehose:DescribeDeliveryStream',
          );
        }
        if (absent) {
          return bodyErrorReply(400, 'ResourceNotFoundException', 'Firehose stream not found');
        }
        return jsonReply({
          DeliveryStreamDescription: {
            DeliveryStreamName: `${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-firehose`,
            DeliveryStreamARN: `arn:aws:firehose:${PINNED_REGION}:${RECONCILE_ACCOUNT}:deliverystream/${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-firehose`,
            ...(options.streamCreateFailed === true
              ? { DeliveryStreamStatus: 'CREATING_FAILED', FailureDescription: STREAM_FAILURE }
              : { DeliveryStreamStatus: 'ACTIVE' }),
            VersionId: '1',
            // AppendOnly already matching is what makes the stream's `update` a
            // no-op, so this reconcile never falls into the replacement branch.
            Destinations: [
              {
                DestinationId: 'destinationId-000000000001',
                IcebergDestinationDescription: { AppendOnly: true },
              },
            ],
          },
        });
      }
      return jsonReply({});
    }

    if (host.startsWith('logs.')) {
      if (target.endsWith('.DescribeLogGroups')) {
        // Keyed on `absent`, the way every other service in this oracle is. The
        // fall-through at the foot of this branch answers `{}`, which carries no
        // `logGroups` key at all - and `logGroupExists` reads that as absent, so
        // both log group nodes would report missing even in the bootstrapped
        // world and every assertion that they are present would pass for the
        // wrong reason. The group is echoed back under the name it was asked
        // for, which is what AWS answers for a group that exists.
        if (absent) return jsonReply({ logGroups: [] });
        return jsonReply({ logGroups: [{ logGroupName: describedLogGroup(req.body) }] });
      }
      if (target.endsWith('.DescribeDeliveries')) return jsonReply({ deliveries: [] });
      if (target.endsWith('.PutDeliveryDestination')) {
        return jsonReply({
          deliveryDestination: {
            arn: `arn:aws:logs:${PINNED_REGION}:${RECONCILE_ACCOUNT}:delivery-destination:${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-cf-dest`,
          },
        });
      }
      return jsonReply({});
    }

    if (host.startsWith('s3.')) {
      // Path-style addressing (`packages/core/src/aws/s3.ts`), so `/<bucket>` is
      // a bucket operation and `/<bucket>/<key>` an object one.
      const segments = url.pathname.split('/').filter((segment) => segment !== '');
      if (req.method === 'HEAD') {
        return absent
          ? reply(404, '<Error><Code>NoSuchBucket</Code><Message>no such bucket</Message></Error>')
          : reply(200, '');
      }
      if (req.method === 'GET' && segments.length === 1) {
        return xmlReply('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
      }
      if (req.method === 'GET') {
        // The state object: absent, so `StateStore.load()` starts from empty
        // state exactly as it does for an environment nothing has reconciled.
        return reply(404, '<Error><Code>NoSuchKey</Code><Message>no such key</Message></Error>');
      }
      return reply(200, '');
    }

    throw new Error(`unexpected AWS host in test: ${req.method} ${req.url}`);
  };
  return { transport, calls };
}

/** The object key an S3 request addressed, or `undefined` for a non-S3 one. */
function stateKeyOf(call: RecordedCall): string | undefined {
  const path = new URL(call.url).pathname;
  const prefix = `/${STATE_BUCKET}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

/** Every state object key a run touched, paired with the method that touched it, in order. */
function stateCalls(calls: readonly RecordedCall[]): { method: string; key: string }[] {
  return calls.flatMap((call) => {
    const key = stateKeyOf(call);
    return key === undefined ? [] : [{ method: call.method, key }];
  });
}

/**
 * A `PluginContext<AnalyticsConfig>` built the way the CLI's `toPluginContext`
 * (`packages/cli/src/plugin-commands.ts`) builds one: `store` is a real
 * `StateStore` from `blogwright-core` scoped to `analytics`, `state` is what
 * that store loaded, `record` writes into THAT state and `save()` persists it
 * through THAT store. `siteState` is the site's own recorded outputs, passed
 * through read-only.
 *
 * The one thing deliberately NOT restated from `toPluginContext` is a second
 * S3 client: the store writes through `clients.s3`, the same instance the host
 * hands a plugin, so a node that reached for the site's key would reach it
 * through the very client this fixture is recording.
 */
async function analyticsContext(options: WorldOptions = {}): Promise<{
  ctx: PluginContext<AnalyticsConfig>;
  calls: RecordedCall[];
  logger: RecordingLogger;
}> {
  const { transport, calls } = analyticsWorld(options);
  const config = mergeConfig({ siteName: RECONCILE_SITE, region: RECONCILE_REGION });
  const clients = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
    transport,
  });
  const names = deriveNames(RECONCILE_ENV, RECONCILE_ACCOUNT, config);
  const store = new StateStore(clients.s3, names.bucket, RECONCILE_ENV, 'analytics');
  const state = await store.load();
  const logger = recordingLogger();
  return {
    calls,
    logger,
    ctx: {
      env: RECONCILE_ENV,
      domain: undefined,
      preview: false,
      config,
      pluginConfig: validateAnalyticsConfig({}),
      names,
      accountId: RECONCILE_ACCOUNT,
      clients,
      ports: {
        fs: createMemoryFileSystem({
          [join(ANALYTICS_PACKAGE_DIR, TRANSFORM_BUNDLE_DIR, TRANSFORM_MANIFEST_FILE)]:
            JSON.stringify({ hash: RECONCILE_BUNDLE_HASH }),
        }),
        terminal: SILENT_TERMINAL,
      },
      logger,
      store,
      state,
      siteState: { resources: { 'cloudfront-distribution': { arn: SITE_DISTRIBUTION_ARN } } },
      record: (nodeId, outputs) => {
        state.resources[nodeId] = outputs;
      },
      save: async () => {
        await store.save(state);
      },
    },
  };
}

/**
 * {@link analyticsContext} with the transform function's recorded code hash
 * seeded, matching the fixture manifest - see RECONCILE_BUNDLE_HASH for why a
 * reconcile must not repack the bundle. Only the two reconcile cases want it:
 * a status seeds nothing, because "never bootstrapped" has to mean an empty
 * scoped state object and not one with an entry already in it.
 */
async function reconcileContext(): Promise<{
  ctx: PluginContext<AnalyticsConfig>;
  calls: RecordedCall[];
}> {
  const built = await analyticsContext();
  built.ctx.state.resources['analytics-transform-function'] = {
    sourceHash: RECONCILE_BUNDLE_HASH,
  };
  return built;
}

/** `applyGraph`'s contract, restated - see this section's own comment for why it is not a second engine. */
async function reconcile(
  nodes: ResourceNode<PluginContext<AnalyticsConfig>>[],
  ctx: PluginContext<AnalyticsConfig>,
): Promise<void> {
  for (const node of nodes) {
    if (await node.read(ctx)) {
      if (node.update) await node.update(ctx);
    } else {
      await node.create(ctx);
    }
    await ctx.save();
  }
}

/** `destroyGraph`'s contract, restated: reverse order, forget the entry, save, then drop the state object. */
async function tearDown(
  nodes: ResourceNode<PluginContext<AnalyticsConfig>>[],
  ctx: PluginContext<AnalyticsConfig>,
): Promise<void> {
  for (const node of [...nodes].reverse()) {
    await node.delete(ctx);
    delete ctx.state.resources[node.id];
    await ctx.save();
  }
  await ctx.store.delete();
}

describe("reconciling the analytics graph against the plugin's own scoped state store", () => {
  it(`writes ${SCOPED_STATE_KEY} and nothing else on a bootstrap - never the site's own state object`, async () => {
    const { ctx, calls } = await reconcileContext();

    await reconcile(buildAnalyticsNodes(), ctx);

    // Non-vacuity first: every one of the fourteen genuinely ran and recorded
    // itself. A world permissive enough to let a node no-op silently fails
    // here, so the key assertions below are about a run that happened.
    expect(Object.keys(ctx.state.resources).sort()).toEqual([...ANALYTICS_NODE_IDS].sort());

    const touched = stateCalls(calls);
    // One load building the context, then one save per node.
    expect(touched.filter((call) => call.method === 'PUT')).toHaveLength(ANALYTICS_NODE_IDS.length);
    expect([...new Set(touched.map((call) => call.key))]).toEqual([SCOPED_STATE_KEY]);
    // Said the other way round as well, against every request the run made and
    // not only the ones this helper classified as state: nothing anywhere
    // addressed the site's object.
    expect(calls.filter((call) => call.url.includes(SITE_STATE_KEY))).toEqual([]);
  });

  it(`writes and finally deletes ${SCOPED_STATE_KEY} alone on a teardown - the site's own state object is never touched`, async () => {
    const { ctx, calls } = await reconcileContext();
    // Arrange: a reconciled environment. The teardown's own assertions read
    // only what happened after this line.
    await reconcile(buildAnalyticsNodes(), ctx);
    calls.length = 0;

    await tearDown(buildAnalyticsNodes(), ctx);

    // Non-vacuity: the teardown really did walk every node and forget it.
    expect(ctx.state.resources).toEqual({});

    const touched = stateCalls(calls);
    expect(touched.filter((call) => call.method === 'PUT')).toHaveLength(ANALYTICS_NODE_IDS.length);
    // And exactly one delete, of the plugin's own object - `destroyGraph`'s
    // trailing `ctx.store.delete()`, which the generic verb runs.
    expect(touched.filter((call) => call.method === 'DELETE')).toEqual([
      { method: 'DELETE', key: SCOPED_STATE_KEY },
    ]);
    expect([...new Set(touched.map((call) => call.key))]).toEqual([SCOPED_STATE_KEY]);
    expect(calls.filter((call) => call.url.includes(SITE_STATE_KEY))).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * TASK 55 - `analytics status`: the fourteen nodes against the plugin's own
 * scoped state, then the stream's delivery health and the table's row count.
 *
 * Every case here drives the real command over the real fourteen nodes. The one
 * thing substituted is the `AnalyticsQuery` port, which is where the vendor
 * library would otherwise attach a catalog: the command takes it as a
 * defaulted parameter for the reason the site's own `status(ctx, nodes =
 * buildNodes(ctx))` takes its node set that way, so no test here starts DuckDB
 * and none patches a module to avoid it.
 * ------------------------------------------------------------------------- */

/**
 * The fourteen titles, in the order `buildAnalyticsNodes` returns them and
 * exactly as an operator reads them. Hand-written rather than mapped off the
 * module under test: a listing derived from `buildAnalyticsNodes()` would
 * agree with a listing that dropped a node, which is the assertion this suite
 * exists to make.
 */
const ANALYTICS_NODE_TITLES = [
  'S3 Tables bucket (us-east-1)',
  'S3 Tables namespace (us-east-1)',
  'Iceberg table (us-east-1)',
  'Glue s3tablescatalog federation (shared - account-and-region scoped, us-east-1)',
  'visitor_key salt secret (us-east-1 - created once, never replaced, kept on teardown)',
  'Transform Lambda log group (us-east-1)',
  'IAM transform execution role (global - IAM is not regional; it serves the us-east-1 pipeline)',
  'Record-transform Lambda (us-east-1)',
  'Firehose failed-record bucket (us-east-1)',
  'Firehose delivery-error log group (us-east-1)',
  'IAM Firehose delivery role (global - IAM is not regional; it serves the us-east-1 pipeline)',
  'Firehose delivery stream (us-east-1)',
  'CloudWatch delivery destination (us-east-1)',
  'CloudFront log delivery to the analytics stream (us-east-1)',
];

/**
 * The two nodes the permissive world reports missing, and the reason it is a
 * realistic drift rather than a hole in the fixture: `analytics-log-destination`
 * reads the plugin's own state (empty here, because the state object 404s) and
 * `analytics-log-delivery` lists the site's delivery source, which carries the
 * site's CloudWatch delivery and not this plugin's. That is exactly what an
 * operator sees after a site re-bootstrap detached the plugin's delivery - and
 * it is what makes the plain listing below a mixed one, so a command that
 * hard-coded either mark would fail it.
 */
const DRIFTED_TITLES = new Set([
  'CloudWatch delivery destination (us-east-1)',
  'CloudFront log delivery to the analytics stream (us-east-1)',
]);

/** The count the fixture-backed port answers with - not a round number, so a hard-coded one shows. */
const FIXTURE_ROW_COUNT = 4271;

/** The relation the row-count line names, from task 44's defaults for an empty `analytics` block. */
const FIXTURE_RELATION = 'web.page_views';

/** The port the command asks for the row count, seeded with one row shaped like the query's own result. */
function rowCountQuery(): FixtureAnalyticsQuery {
  return createFixtureAnalyticsQuery({
    [ROW_COUNT_QUERY]: [{ [ROW_COUNT_COLUMN]: FIXTURE_ROW_COUNT }],
  });
}

/** A port whose read fails the way the real adapter's does when it cannot reach the table. */
const FAILING_QUERY_MESSAGE = 'opening a DuckDB connection: AccessDenied';
const failingQuery: AnalyticsQuery = {
  run: () => Promise.reject(new Error(FAILING_QUERY_MESSAGE)),
};

/** What the command logged at one level, colour stripped, in order. */
function linesAt(logger: RecordingLogger, level: 'info' | 'warn'): string[] {
  const prefix = `${level} `;
  return logger.lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => stripColors(line.slice(prefix.length)));
}

/** Every line the command emitted at either level - what "the listing still completes" is read off. */
function allLines(logger: RecordingLogger): string[] {
  return [...linesAt(logger, 'info'), ...linesAt(logger, 'warn')];
}

/** The heading the command opens with. */
function heading(): string {
  return `Analytics status for "${RECONCILE_ENV}" (bucket ${STATE_BUCKET})`;
}

/** The plain listing the drift world produces, one line per node in the graph's own order. */
function driftedPlainLines(): string[] {
  return ANALYTICS_NODE_TITLES.map(
    (title) => `  ${DRIFTED_TITLES.has(title) ? 'missing' : 'present'}  ${title}`,
  );
}

/**
 * The outcome of one command, in the vocabulary the host reports to the shell.
 * A plugin may not import the CLI, so this restates the mapping `runPlugin`
 * (`packages/cli/src/plugin-commands.ts`) applies: it returns 0 once `run`
 * resolves, and a command that fails signals it by rejecting, which reaches
 * `bin.ts`'s error path and sets exit 1. `failure` is carried so a test that
 * fails says why rather than only reporting the wrong number.
 */
interface CommandOutcome {
  readonly exitCode: number;
  readonly failure?: string;
}

async function runToExitCode(run: () => Promise<void>): Promise<CommandOutcome> {
  try {
    await run();
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: 1, failure: (err as Error).message };
  }
}

describe('analytics status - the plain form, which is the contract for CI and agents', () => {
  it('prints the heading, one stable line per node, the delivery health and the row count', async () => {
    const { ctx, logger } = await analyticsContext();

    await status(ctx, [], rowCountQuery());

    // Line by line, spelled out: this is the output an agent or a CI job
    // parses, so it is asserted as text and not as a shape.
    expect(linesAt(logger, 'info')).toEqual([
      `Analytics status for "test" (bucket test-example-123456789012)`,
      '  present  S3 Tables bucket (us-east-1)',
      '  present  S3 Tables namespace (us-east-1)',
      '  present  Iceberg table (us-east-1)',
      '  present  Glue s3tablescatalog federation (shared - account-and-region scoped, us-east-1)',
      '  present  visitor_key salt secret (us-east-1 - created once, never replaced, kept on teardown)',
      '  present  Transform Lambda log group (us-east-1)',
      '  present  IAM transform execution role (global - IAM is not regional; it serves the us-east-1 pipeline)',
      '  present  Record-transform Lambda (us-east-1)',
      '  present  Firehose failed-record bucket (us-east-1)',
      '  present  Firehose delivery-error log group (us-east-1)',
      '  present  IAM Firehose delivery role (global - IAM is not regional; it serves the us-east-1 pipeline)',
      '  present  Firehose delivery stream (us-east-1)',
      '  missing  CloudWatch delivery destination (us-east-1)',
      '  missing  CloudFront log delivery to the analytics stream (us-east-1)',
      '  Firehose delivery: active',
      `  rows in web.page_views: ${FIXTURE_ROW_COUNT}`,
    ]);
  });

  it('warns about nothing when every node answered', async () => {
    const { ctx, logger } = await analyticsContext();

    await status(ctx, [], rowCountQuery());

    expect(linesAt(logger, 'warn')).toEqual([]);
  });

  it('reads the fourteen nodes and writes nothing back to the scoped state object', async () => {
    const { ctx, calls } = await analyticsContext();

    await status(ctx, [], rowCountQuery());

    // A status is a read. `read()` hydrates `ctx.state` in memory - which is
    // where the health line comes from - but the command never calls `save()`,
    // so no PUT and no DELETE may reach `state/test.analytics.json`.
    expect(stateCalls(calls).filter((call) => call.method !== 'GET')).toEqual([]);
    expect(calls.filter((call) => call.url.includes(SITE_STATE_KEY))).toEqual([]);
  });
});

describe('analytics status - the pretty form', () => {
  it('renders the drift tree on an interactive terminal instead of the plain lines', async () => {
    const built = await analyticsContext();
    const ctx: PluginContext<AnalyticsConfig> = {
      ...built.ctx,
      ports: { ...built.ctx.ports, terminal: { ...SILENT_TERMINAL, isInteractive: true } },
    };

    await status(ctx, [], rowCountQuery());

    expect(linesAt(built.logger, 'info')).toEqual([
      heading(),
      ...ANALYTICS_NODE_TITLES.map((title, index) => {
        const connector = index === ANALYTICS_NODE_TITLES.length - 1 ? '╰─' : '├─';
        return `${connector} ${DRIFTED_TITLES.has(title) ? '◌' : '✓'} ${title}`;
      }),
      '  Firehose delivery: active',
      `  rows in ${FIXTURE_RELATION}: ${FIXTURE_ROW_COUNT}`,
    ]);
  });
});

describe('analytics status - the stream health line', () => {
  it("takes it off the state the stream node's own read hydrated, issuing no second describe", async () => {
    const { ctx, calls, logger } = await analyticsContext();

    await status(ctx, [], rowCountQuery());

    // One Firehose request for the whole command - the node's own read. A
    // health line that described the stream for itself would make this two.
    expect(calls.filter((call) => new URL(call.url).hostname.startsWith('firehose.'))).toHaveLength(
      1,
    );
    expect(linesAt(logger, 'info')).toContain('  Firehose delivery: active');
  });

  it('warns with the service vocabulary and the failure detail when the stream is not delivering', async () => {
    const { ctx, logger } = await analyticsContext({ streamCreateFailed: true });

    await status(ctx, [], rowCountQuery());

    // The stream node reports such a stream PRESENT on purpose, so the listing
    // says present and this line is the only place the operator learns that
    // nothing is being delivered.
    expect(linesAt(logger, 'info')).toContain('  present  Firehose delivery stream (us-east-1)');
    expect(linesAt(logger, 'warn')).toEqual([
      `Firehose delivery: create-failed - ${STREAM_FAILURE.Type}: ${STREAM_FAILURE.Details}`,
    ]);
  });
});

describe('analytics status - a read that fails degrades to a warning', () => {
  it('warns for an unreadable stream and still lists all fourteen nodes', async () => {
    const { ctx, logger } = await analyticsContext({ streamReadDenied: true });

    await status(ctx, [], rowCountQuery());

    // The exact message the client raised, twice over: once as the node's own
    // `read failed` line and once as the health line's reason. An operator who
    // greps either gets the permission they are missing and the stream it was
    // asked for.
    const denied =
      'firehose: AccessDeniedException - describeDeliveryStream "test-example-analytics-firehose": not authorized to perform firehose:DescribeDeliveryStream (HTTP 403)';
    expect(linesAt(logger, 'warn')).toEqual([
      `Firehose delivery stream (us-east-1): read failed (${denied})`,
      `Firehose delivery: unavailable - reading the stream failed (${denied})`,
    ]);
    // The listing completed: every one of the fourteen was reported exactly once,
    // across both levels, and the row count still ran.
    for (const title of ANALYTICS_NODE_TITLES) {
      expect(allLines(logger).filter((line) => line.includes(title))).toHaveLength(1);
    }
    expect(linesAt(logger, 'info')).toContain(
      `  rows in ${FIXTURE_RELATION}: ${FIXTURE_ROW_COUNT}`,
    );
  });

  it('warns for an unreadable table and still lists all fourteen nodes', async () => {
    const { ctx, logger } = await analyticsContext();

    await status(ctx, [], failingQuery);

    expect(linesAt(logger, 'warn')).toEqual([
      `rows in ${FIXTURE_RELATION}: unavailable - ${FAILING_QUERY_MESSAGE}`,
    ]);
    expect(linesAt(logger, 'info')).toEqual([
      heading(),
      ...driftedPlainLines(),
      '  Firehose delivery: active',
    ]);
  });
});

describe('analytics status - an environment that was never bootstrapped', () => {
  it('exits 0 rather than throwing', async () => {
    const { ctx } = await analyticsContext({ unbootstrapped: true });

    // The exit code the host would report, not merely the absence of a throw:
    // `runToExitCode` restates `runPlugin`'s own mapping, and carries the
    // failure so a regression names itself.
    expect(await runToExitCode(() => status(ctx, [], failingQuery))).toEqual({ exitCode: 0 });
  });

  it('reports every one of the fourteen nodes missing, against an empty scoped state', async () => {
    const { ctx, logger } = await analyticsContext({ unbootstrapped: true });
    // Empty, and asserted before the command runs: the whole claim is about a
    // state object that does not exist, and a fixture that had seeded one
    // would let a "missing" line pass for the wrong reason.
    expect(ctx.state.resources).toEqual({});

    await status(ctx, [], failingQuery);

    expect(linesAt(logger, 'info')).toEqual([
      heading(),
      ...ANALYTICS_NODE_TITLES.map((title) => `  missing  ${title}`),
    ]);
  });

  it('warns that there is no stream and that the table cannot be read', async () => {
    const { ctx, logger } = await analyticsContext({ unbootstrapped: true });

    await status(ctx, [], failingQuery);

    expect(linesAt(logger, 'warn')).toEqual([
      'Firehose delivery: no delivery stream - `blogwright analytics bootstrap test` creates it',
      `rows in ${FIXTURE_RELATION}: unavailable - ${FAILING_QUERY_MESSAGE}`,
    ]);
  });
});

describe('analytics status - the row count crosses the AnalyticsQuery port', () => {
  it('asks for the named row-count query over the whole table, bots included', async () => {
    const { ctx } = await analyticsContext();
    const query = rowCountQuery();

    await status(ctx, [], query);

    // What the port was asked, as the shared `prepareQuery` resolved it: one
    // call, the name from the definition table, and the whole-table range
    // bound as values rather than spliced into a statement.
    expect(query.calls.map((call) => call.name)).toEqual([ROW_COUNT_QUERY]);
    expect(query.calls[0]?.bindings).toEqual({
      from: WHOLE_TABLE_RANGE.from,
      to: WHOLE_TABLE_RANGE.to,
      include_bots: true,
    });
  });

  it('warns rather than reporting a figure when the query answers no row', async () => {
    // Not a shape the real adapter can produce - `count(*)` always answers one
    // row - which is exactly why the guard needs a test: nothing else would
    // ever exercise it, and a status that printed `rows: undefined` would be
    // worse than one that said it could not tell.
    const { ctx, logger } = await analyticsContext();
    const empty = createFixtureAnalyticsQuery({ [ROW_COUNT_QUERY]: [] });

    await status(ctx, [], empty);

    expect(linesAt(logger, 'warn')).toEqual([
      `rows in ${FIXTURE_RELATION}: unavailable - the ${ROW_COUNT_QUERY} query answered no ${ROW_COUNT_COLUMN}`,
    ]);
  });
});
