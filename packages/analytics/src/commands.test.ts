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
  type PluginContext,
  type PluginLogger,
  type RawResponse,
  type ResourceNode,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { dashboard, type DashboardCommandContext } from './commands.js';
import { DEFAULT_DASHBOARD_PORT, validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import { createFixtureAnalyticsQuery } from './fixture-query.js';
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
 * `packages/cli/src/plugin-commands.test.ts` against a twelve-node stand-in.
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
  'analytics-transform-role',
  'analytics-transform-function',
  'analytics-error-bucket',
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
 */
const ANALYTICS_EDGES: Record<string, string[]> = {
  'analytics-table-bucket': [],
  'analytics-namespace': ['analytics-table-bucket'],
  'analytics-table': ['analytics-namespace'],
  'analytics-catalog-integration': ['analytics-table'],
  'analytics-salt-secret': [],
  'analytics-transform-role': ['analytics-salt-secret'],
  'analytics-transform-function': ['analytics-transform-role'],
  'analytics-error-bucket': [],
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
  it("returns the spec table's twelve nodes, by id, in its order", () => {
    expect(ANALYTICS_NODE_IDS).toHaveLength(12);
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

function reply(status: number, text: string): RawResponse {
  return {
    statusCode: status,
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
 * A permissive stand-in for the nine AWS services the twelve nodes talk to,
 * answering "this already exists" to every lookup and success to every
 * mutation.
 *
 * **It is deliberately an oracle rather than a script, and that is safe here
 * because of what these tests assert.** They do not assert what the nodes sent
 * - `nodes.test.ts` owns that, request by request, against scripted replies
 * that run out if a node makes a call the test did not account for. What these
 * assert is which STATE OBJECTS were written while all twelve ran, and for that
 * the fixture's job is only to let all twelve run to completion. The
 * non-vacuity check is separate and explicit: every one of the twelve has to
 * appear in the plugin's own `state.resources` afterwards, so a world permissive
 * enough to let a node no-op silently would fail the test rather than pass it.
 *
 * An unrecognised host throws rather than answering: a node reaching a service
 * nobody accounted for must fail here, not be fed an empty object.
 */
function analyticsWorld(): { transport: Transport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: Transport = async (req) => {
    calls.push({ method: req.method, url: req.url });
    const url = new URL(req.url);
    const host = url.hostname;
    const target = req.headers['x-amz-target'] ?? '';

    if (host === 'iam.amazonaws.com') return iamReply(String(req.body ?? ''));

    if (host.startsWith('s3tables.')) {
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
      return jsonReply({
        ARN: `arn:aws:secretsmanager:${PINNED_REGION}:${RECONCILE_ACCOUNT}:secret:${RECONCILE_SITE}/${RECONCILE_ENV}/analytics-salt-AbCdEf`,
        Name: `${RECONCILE_SITE}/${RECONCILE_ENV}/analytics-salt`,
      });
    }

    if (host.startsWith('lambda.')) {
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
        return jsonReply({
          DeliveryStreamDescription: {
            DeliveryStreamName: `${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-firehose`,
            DeliveryStreamARN: `arn:aws:firehose:${PINNED_REGION}:${RECONCILE_ACCOUNT}:deliverystream/${RECONCILE_ENV}-${RECONCILE_SITE}-analytics-firehose`,
            DeliveryStreamStatus: 'ACTIVE',
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
      if (req.method === 'HEAD') return reply(200, '');
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
async function reconcileContext(): Promise<{
  ctx: PluginContext<AnalyticsConfig>;
  calls: RecordedCall[];
}> {
  const { transport, calls } = analyticsWorld();
  const config = mergeConfig({ siteName: RECONCILE_SITE, region: RECONCILE_REGION });
  const clients = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
    transport,
  });
  const names = deriveNames(RECONCILE_ENV, RECONCILE_ACCOUNT, config);
  const store = new StateStore(clients.s3, names.bucket, RECONCILE_ENV, 'analytics');
  const state = await store.load();
  // The transform function's recorded code hash, matching the manifest below -
  // see RECONCILE_BUNDLE_HASH for why the reconcile must not repack the bundle.
  state.resources['analytics-transform-function'] = { sourceHash: RECONCILE_BUNDLE_HASH };
  return {
    calls,
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
      logger: recordingLogger(),
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

    // Non-vacuity first: every one of the twelve genuinely ran and recorded
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
