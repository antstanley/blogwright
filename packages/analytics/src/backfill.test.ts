/**
 * `blogwright analytics backfill`, driven over the real `LogsClient` and the
 * real `SecretsManagerClient` against a scripted transport, with the two
 * analytics ports substituted: the write port by `fixture-ingest.ts`'s
 * recording fake, the read port by a counting fake below. **No test in this
 * file starts DuckDB** - the vendor library is behind
 * `adapters/duckdb-ingest.ts`, whose own suite substitutes at its connection
 * seam, and nothing here names it.
 *
 * The AWS side is deliberately NOT substituted. The definition of done claims
 * the read is core's existing `LogsClient.filterEvents` over
 * `ctx.clients.logsUsEast1` and that the salt secret is read through the
 * plugin's own us-east-1 Secrets Manager client; both are claims about which
 * request goes to which host, which a stubbed client would answer by
 * construction. The transport records every request, so an unaccounted-for
 * call fails the test rather than being fed an empty object - which is also
 * what makes "the refusal happens before any AWS call" an assertion with
 * teeth.
 */

import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  mergeConfig,
  StateStore,
  staticCredentials,
  stripColors,
  type OpsState,
  type PluginContext,
  type PluginLogger,
  type RawResponse,
  type ResourceOutputs,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { runBackfill, type BackfillPorts } from './backfill.js';
import { backfill } from './commands.js';
import { type AnalyticsConfig, validateAnalyticsConfig } from './config.js';
import { createRecordingAnalyticsIngest } from './fixture-ingest.js';
import { analyticsLogDeliveryNode, CREATED_DAY_KEY, LOG_DELIVERY_NODE } from './nodes.js';
import type { AnalyticsQuery, QueryRow } from './ports.js';
import { prepareQuery, ROW_COUNT_COLUMN, ROW_COUNT_QUERY, type QueryParams } from './queries.js';
import type { PageView } from './schema.js';
import { createTransformHandler, SALT_SECRET_NAME_ENV } from './transform/handler.js';

/* -------------------------------------------------------------------------
 * The world every test runs in.
 * ------------------------------------------------------------------------- */

const ENV = 'production';
const SITE = 'example';
const ACCOUNT = '123456789012';

/**
 * The site's own region, and deliberately **not** `us-east-1`. Everything this
 * command touches is pinned to us-east-1 - the log group CloudFront's delivery
 * writes and the salt secret the transform reads - so a context whose
 * `config.region` were the pinned region could not tell
 * `ctx.clients.logsUsEast1` from `ctx.clients.logs`: both would sign the same
 * host, and a read through the wrong one would pass.
 */
const REGION = 'eu-west-2';

/** The region every request this command makes is signed in, whatever `REGION` says. */
const PINNED_REGION = 'us-east-1';

/** `deriveNames` builds this from the site name and environment; restated so an assertion can name it. */
const LOG_GROUP = `/${SITE}/${ENV}/cloudfront`;

/** `defaultSaltSecretName`'s value for this site, restated for the same reason. */
const SALT_SECRET_NAME = `${SITE}/${ENV}/analytics-salt`;

/** The long-lived stored secret both paths derive their daily salt from. */
const SALT_SECRET = 'a-long-lived-random-analytics-salt-secret';

/** The day the plugin's delivery was created - the bound, and never itself backfilled. */
const CREATED_DAY = '2026-08-20';

/**
 * `retention.cloudfrontDays` for these tests. Four rather than the default
 * ninety so a pinned report is readable; the range's dependence on the
 * configured value is asserted separately rather than assumed.
 */
const RETENTION_DAYS = 4;

/** The four candidate days that follow from {@link CREATED_DAY} and {@link RETENTION_DAYS}. */
const CANDIDATE_DAYS = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];

/**
 * One CloudFront standard-logging record, carrying every field the analytics
 * delivery selects. Its `timestamp(ms)` is `2026-08-18T09:41:07.512Z`, which
 * is inside the candidate range above.
 */
const FIXTURE_RECORD = {
  'timestamp(ms)': 1_787_046_067_512,
  'x-host-header': 'example.com',
  'cs-uri-stem': '/posts/hello-world',
  'cs-uri-query': 'utm_source=rss',
  'cs-method': 'GET',
  'sc-status': 200,
  'cs(Referer)': 'https://news.example.org/',
  'cs(User-Agent)': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'c-country': 'GB',
  asn: 64512,
  'x-edge-location': 'LHR62-C2',
  'x-edge-result-type': 'Hit',
  'sc-bytes': 14832,
  'time-taken': 0.041,
  'sc-content-type': 'text/html',
  'cs-protocol': 'https',
  'x-edge-request-id': 'abcDEF123',
  'c-ip': '203.0.113.45',
};

/** The day {@link FIXTURE_RECORD} falls on. */
const FIXTURE_DAY = '2026-08-18';

/**
 * The `page_views` row {@link FIXTURE_RECORD} maps to - **written out here
 * rather than computed by either path under test.**
 *
 * That is the whole point of this constant. The identical-row property is a
 * claim about two code paths agreeing, and a fixture built by calling one of
 * them would move whenever that path moved, so the comparison would hold
 * however wrong both sides became. This literal was produced once, read off a
 * run of `mapRecord`, and frozen: `visitor_key` is the SHA-256 over the viewer
 * IP, the user agent and `HMAC-SHA256(SALT_SECRET, '2026-08-18')`, and if the
 * derivation ever changes, this row is what fails.
 */
const EXPECTED_ROW: PageView = {
  event_time: '2026-08-18T09:41:07.512Z',
  day: FIXTURE_DAY,
  host: 'example.com',
  uri: '/posts/hello-world',
  query: 'utm_source=rss',
  method: 'GET',
  status: 200,
  referrer: 'https://news.example.org/',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  country: 'GB',
  asn: '64512',
  edge_location: 'LHR62-C2',
  result_type: 'Hit',
  bytes_sent: 14832,
  time_taken: 0.041,
  content_type: 'text/html',
  protocol: 'https',
  request_id: 'abcDEF123',
  is_bot: false,
  visitor_key: '699408ed0df313a11118206c1ce49c3a59e96d641429ad001bfbccddbe60501d',
};

/** A terminal no command in this file touches - reporting goes through `ctx.logger`. */
const SILENT_TERMINAL: Terminal = {
  isInteractive: false,
  write: () => {},
  error: () => {},
  status: () => {},
  question: async () => '',
};

/** A recording {@link PluginLogger}, keeping each line beside the level it arrived at. */
interface RecordingLogger extends PluginLogger {
  readonly lines: string[];
}

function recordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const at =
    (level: string) =>
    (msg: string): void => {
      lines.push(`${level} ${stripColors(msg)}`);
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

/** One request the transport saw. */
interface RecordedCall {
  readonly host: string;
  readonly target: string;
  readonly body: string;
}

/** A JSON reply, in the shape the SigV4 transport hands back. */
function jsonReply(payload: unknown): RawResponse {
  const text = JSON.stringify(payload);
  return {
    statusCode: 200,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** What one test's AWS world answers with. */
interface WorldOptions {
  /** Log-event messages per UTC day. A day with no entry answers with no events. */
  readonly events?: Record<string, readonly string[]>;
  /** The stored salt secret; `undefined` models a secret holding no value. */
  readonly secret?: string | undefined;
}

/**
 * A transport answering exactly the two services a backfill reaches -
 * CloudWatch Logs and Secrets Manager, both in us-east-1 - and throwing for
 * anything else, so a call nobody accounted for fails the test.
 *
 * `FilterLogEvents` is answered from the requested window rather than from a
 * script, which is what lets a test assert that an occupied day is never read:
 * the world would happily have answered, so an absent call is the command's
 * doing.
 */
function analyticsWorld(options: WorldOptions = {}): {
  transport: Transport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const events = options.events ?? {};
  const secret = 'secret' in options ? options.secret : SALT_SECRET;

  const transport: Transport = async (req) => {
    const host = new URL(req.url).hostname;
    const target = req.headers['x-amz-target'] ?? '';
    const body = String(req.body ?? '');
    calls.push({ host, target, body });

    if (target === 'Logs_20140328.FilterLogEvents') {
      const request = JSON.parse(body) as { logGroupName: string; startTime: number };
      const day = new Date(request.startTime).toISOString().slice(0, 10);
      const messages = events[day] ?? [];
      return jsonReply({
        events: messages.map((message, index) => ({
          eventId: `${day}-${index}`,
          timestamp: request.startTime,
          message,
        })),
      });
    }
    if (target === 'Logs_20140328.CreateDelivery') return jsonReply({});
    if (target === 'secretsmanager.GetSecretValue') {
      return jsonReply(secret === undefined ? {} : { SecretString: secret });
    }
    throw new Error(`unexpected AWS request in test: ${host} ${target}`);
  };

  return { transport, calls };
}

/** What {@link contextFor} hands a test. */
interface TestWorld {
  readonly ctx: PluginContext<AnalyticsConfig>;
  readonly calls: RecordedCall[];
  readonly logger: RecordingLogger;
  /** Every `ctx.save()` the run made - a backfill must make none. */
  readonly saves: string[];
}

/**
 * A `PluginContext<AnalyticsConfig>` built the way the CLI's
 * `toPluginContext` builds one, over the world's transport. `state` is a
 * plain object rather than a loaded `StateStore` document: a backfill reads
 * the delivery node's recorded outputs and writes nothing, so seeding the
 * object directly is what the test is about, and `store` is present only
 * because the SPI declares it.
 */
function contextFor(
  world: { transport: Transport; calls: RecordedCall[] },
  resources: Record<string, ResourceOutputs> = {},
): TestWorld {
  const config = mergeConfig({
    siteName: SITE,
    region: REGION,
    retention: { microvmDays: 365, cloudfrontDays: RETENTION_DAYS },
  });
  const clients = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
    transport: world.transport,
  });
  const names = deriveNames(ENV, ACCOUNT, config);
  const state: OpsState = { version: 1, env: ENV, updatedAt: undefined, resources };
  const logger = recordingLogger();
  const saves: string[] = [];

  return {
    calls: world.calls,
    logger,
    saves,
    ctx: {
      env: ENV,
      domain: undefined,
      preview: false,
      config,
      pluginConfig: validateAnalyticsConfig({}),
      names,
      accountId: ACCOUNT,
      clients,
      ports: { fs: createMemoryFileSystem({}), terminal: SILENT_TERMINAL },
      logger,
      store: new StateStore(clients.s3, names.bucket, ENV, 'analytics'),
      state,
      siteState: {
        resources: {
          'cloudfront-distribution': {
            arn: `arn:aws:cloudfront::${ACCOUNT}:distribution/E1EXAMPLE`,
          },
        },
      },
      record: (nodeId, outputs) => {
        state.resources[nodeId] = outputs;
      },
      save: async () => {
        saves.push('save');
      },
    },
  };
}

/** The state a bootstrapped environment carries, with the bound the delivery node wrote. */
function deliveredState(createdDay: string = CREATED_DAY): Record<string, ResourceOutputs> {
  return {
    [LOG_DELIVERY_NODE]: {
      source: `${ENV}-${SITE}-cf-source`,
      destination: `arn:aws:logs:${REGION}:${ACCOUNT}:delivery-destination:${ENV}-${SITE}-analytics-dest`,
      delivery: 'configured',
      [CREATED_DAY_KEY]: createdDay,
    },
  };
}

/* -------------------------------------------------------------------------
 * The read port, as a counting fake.
 * ------------------------------------------------------------------------- */

/** An {@link AnalyticsQuery} answering `row-count` per day, plus what it was asked. */
interface CountingQuery extends AnalyticsQuery {
  /** The days it was asked to count, in call order. */
  readonly days: string[];
  /** The `includeBots` each occupancy read carried, in the same call order. */
  readonly botFlags: (boolean | undefined)[];
}

/**
 * A read port that answers the occupancy count for one day.
 *
 * It runs the real {@link prepareQuery}, so an unknown name or an inverted
 * range is refused here exactly as the DuckDB adapter would refuse it, and it
 * insists on a single-day range: a backfill that asked for a window would get
 * a failure rather than a count that happened to be right.
 *
 * `counts` is a function rather than a map so the re-run test can answer from
 * what has actually been written, which is what makes its second run a genuine
 * second run rather than a differently-configured first one.
 */
function countingQuery(counts: (day: string) => number): CountingQuery {
  const days: string[] = [];
  const botFlags: (boolean | undefined)[] = [];
  return {
    days,
    botFlags,
    async run(name, params: QueryParams): Promise<readonly QueryRow[]> {
      const prepared = prepareQuery(name, params, validateAnalyticsConfig({}));
      if (prepared.name !== ROW_COUNT_QUERY) {
        throw new Error(`the backfill asked for "${prepared.name}", not "${ROW_COUNT_QUERY}"`);
      }
      const { from, to } = params.range;
      if (from !== to) {
        throw new Error(`the backfill asked for the range ${from}..${to}, not a single day`);
      }
      days.push(from);
      botFlags.push(params.includeBots);
      return [{ [ROW_COUNT_COLUMN]: counts(from) }];
    },
  };
}

/** An empty table: every day answers zero. */
const EMPTY_TABLE = (): number => 0;

/** The ports a test drives the command over, with the recording write side exposed. */
function portsWith(counts: (day: string) => number = EMPTY_TABLE): BackfillPorts & {
  ingest: ReturnType<typeof createRecordingAnalyticsIngest>;
  query: CountingQuery;
} {
  return { query: countingQuery(counts), ingest: createRecordingAnalyticsIngest() };
}

/** One log event's message: a CloudFront record as the delivery writes it. */
function eventFor(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

/** {@link FIXTURE_RECORD} moved to another day, so a day's events differ from another's. */
function recordOn(day: string, minute: number): Record<string, unknown> {
  return {
    ...FIXTURE_RECORD,
    'timestamp(ms)': Date.parse(`${day}T12:${String(minute).padStart(2, '0')}:00.000Z`),
  };
}

/** The days the log group was actually read for, in call order. */
function daysRead(calls: readonly RecordedCall[]): string[] {
  return calls
    .filter((call) => call.target === 'Logs_20140328.FilterLogEvents')
    .map((call) => {
      const request = JSON.parse(call.body) as { startTime: number };
      return new Date(request.startTime).toISOString().slice(0, 10);
    });
}

/* -------------------------------------------------------------------------
 * The identical-row property.
 * ------------------------------------------------------------------------- */

/** {@link FIXTURE_RECORD} through the Firehose transform's envelope, decoded. */
async function throughFirehose(record: Record<string, unknown>): Promise<unknown> {
  const handler = createTransformHandler(
    { getSecretValue: async () => SALT_SECRET },
    { [SALT_SECRET_NAME_ENV]: SALT_SECRET_NAME },
  );
  const response = await handler({
    records: [
      { recordId: 'r1', data: Buffer.from(JSON.stringify(record), 'utf8').toString('base64') },
    ],
  });
  const entry = response.records[0];
  expect(entry?.result).toBe('Ok');
  return JSON.parse(Buffer.from(entry?.data ?? '', 'base64').toString('utf8'));
}

describe('the identical-row property', () => {
  it('produces, for one CloudFront record, the row the Firehose envelope produces', async () => {
    const world = analyticsWorld({ events: { [FIXTURE_DAY]: [eventFor(FIXTURE_RECORD)] } });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    // Each side against the frozen row first, so a failure says which path
    // moved rather than only that the two disagree - and so that two paths
    // that drifted together still fail.
    const firehoseRow = await throughFirehose(FIXTURE_RECORD);
    expect(firehoseRow).toStrictEqual(EXPECTED_ROW);
    expect(ports.ingest.calls).toHaveLength(1);
    expect(ports.ingest.calls[0]?.rows).toStrictEqual([EXPECTED_ROW]);

    // And to each other, whole rows, which is what the property says.
    expect(ports.ingest.calls[0]?.rows[0]).toStrictEqual(firehoseRow);
  });

  it("derives the historical day's salt from the stored secret, not from a constant", async () => {
    // The same record on two days must hash to two keys: the salt is
    // `HMAC-SHA256(secret, day)`, so a backfill that passed one salt for the
    // whole run - or the secret where the salt belongs - would produce two
    // equal keys here and nothing else in the suite would notice.
    const world = analyticsWorld({
      events: {
        '2026-08-17': [eventFor(recordOn('2026-08-17', 0))],
        '2026-08-18': [eventFor(recordOn('2026-08-18', 0))],
      },
    });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    const keys = ports.ingest.calls.map((call) => call.rows[0]?.visitor_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => typeof key === 'string' && key.length === 64)).toBe(true);
  });

  it("reads the log group and the salt secret in us-east-1, not in the site's region", async () => {
    // Both halves of the region pin, on a site whose own region is eu-west-2:
    // the log group is read through core's `logsUsEast1`, and the secret
    // through the plugin's own client built over `signingUsEast1`.
    const world = analyticsWorld({ events: { [FIXTURE_DAY]: [eventFor(FIXTURE_RECORD)] } });
    const { ctx, calls } = contextFor(world, deliveredState());

    await runBackfill(ctx, portsWith());

    const logReads = calls.filter((call) => call.target === 'Logs_20140328.FilterLogEvents');
    expect(logReads).toHaveLength(CANDIDATE_DAYS.length);
    expect([...new Set(logReads.map((call) => call.host))]).toEqual([
      `logs.${PINNED_REGION}.amazonaws.com`,
    ]);
    expect(JSON.parse(logReads[0]?.body ?? '{}').logGroupName).toBe(LOG_GROUP);

    const reads = calls.filter((call) => call.target === 'secretsmanager.GetSecretValue');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.host).toBe(`secretsmanager.${PINNED_REGION}.amazonaws.com`);
    expect(JSON.parse(reads[0]?.body ?? '{}')).toStrictEqual({ SecretId: SALT_SECRET_NAME });
  });

  it('stops rather than writing an unsalted key when the secret holds no value', async () => {
    const world = analyticsWorld({
      secret: undefined,
      events: { [FIXTURE_DAY]: [eventFor(FIXTURE_RECORD)] },
    });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await expect(runBackfill(ctx, ports)).rejects.toThrow(
      `the analytics salt secret "${SALT_SECRET_NAME}" holds no value`,
    );
    expect(ports.ingest.calls).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Idempotency, in both directions.
 * ------------------------------------------------------------------------- */

describe('the idempotency bound', () => {
  it(`hands no day at or after ${CREATED_DAY} to insertDay`, async () => {
    const world = analyticsWorld({
      events: {
        '2026-08-18': [eventFor(recordOn('2026-08-18', 0))],
        '2026-08-19': [eventFor(recordOn('2026-08-19', 0))],
        // The boundary day and the day after it: both have history, and
        // neither is the backfill's to write - Firehose already has them.
        '2026-08-20': [eventFor(recordOn('2026-08-20', 0))],
        '2026-08-21': [eventFor(recordOn('2026-08-21', 0))],
      },
    });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    // Non-vacuity: the run genuinely wrote days, so the negative below is
    // about a bound that held rather than about a run that did nothing.
    expect(ports.ingest.days).toEqual(['2026-08-18', '2026-08-19']);
    for (const day of ports.ingest.days) expect(day < CREATED_DAY).toBe(true);
    // The bound is upheld before the read as well as before the write: the
    // boundary day's events were there for the taking and were never fetched.
    expect(daysRead(world.calls)).toEqual(CANDIDATE_DAYS);
  });

  it('never inserts a row whose own day is not the day being written', async () => {
    // A record on the far side of midnight, returned inside the previous
    // day's window. CloudWatch's `endTime` is not documented as exclusive, so
    // this is reachable; the row's own `day` is what decides, not the window.
    const world = analyticsWorld({
      events: {
        '2026-08-19': [
          eventFor(recordOn('2026-08-19', 0)),
          eventFor(recordOn('2026-08-20', 0)),
          eventFor(recordOn('2026-08-21', 0)),
        ],
      },
    });
    const { ctx, logger } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    expect(ports.ingest.calls).toHaveLength(1);
    expect(ports.ingest.calls[0]?.day).toBe('2026-08-19');
    expect(ports.ingest.calls[0]?.rows.map((row) => row.day)).toEqual(['2026-08-19']);
    expect(logger.lines).toContain(
      "warn 2026-08-19: 2 log events carried another day and were left to that day's own pass",
    );
  });

  it('skips a day the table already holds rows for, and does not even read its logs', async () => {
    const world = analyticsWorld({
      events: {
        '2026-08-18': [eventFor(recordOn('2026-08-18', 0))],
        '2026-08-19': [eventFor(recordOn('2026-08-19', 0))],
      },
    });
    const { ctx, logger } = contextFor(world, deliveredState());
    const ports = portsWith((day) => (day === '2026-08-19' ? 7 : 0));

    await runBackfill(ctx, ports);

    expect(ports.ingest.days).toEqual(['2026-08-18']);
    expect(ports.query.days).toEqual(CANDIDATE_DAYS);
    expect(daysRead(world.calls)).toEqual(['2026-08-16', '2026-08-17', '2026-08-18']);
    expect(logger.lines).toContain(
      'info   skipped 2026-08-19: the table already holds 7 rows for that day',
    );
  });

  it("counts a day's occupancy with bots included, so a bot-only day is an occupied day", async () => {
    // `includeBots` is bound to `true` in `rowsAlreadyIn` rather than left to
    // `config.analytics.bots`, and this is the assertion that holds it there.
    // With `false`, a day holding nothing but bot traffic would count as empty
    // and be re-inserted on every run - the exact duplication the whole
    // idempotency design exists to prevent, and invisible to every other test
    // here because none of them varies the flag. Asserted on the received
    // params rather than on a count, because the fake cannot distinguish bot
    // rows from any others: what is under test is what the backfill *asks for*.
    const world = analyticsWorld({ events: {} });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    expect(ports.query.days.length).toBeGreaterThan(0);
    expect(ports.query.botFlags).toEqual(ports.query.days.map(() => true));
  });

  it('inserts nothing on a second run against what the first one wrote', async () => {
    const world = analyticsWorld({
      events: {
        '2026-08-17': [eventFor(recordOn('2026-08-17', 0))],
        '2026-08-18': [eventFor(recordOn('2026-08-18', 0)), eventFor(recordOn('2026-08-18', 1))],
      },
    });
    const ingest = createRecordingAnalyticsIngest();
    // The table's occupancy IS what the write port has been handed, so the
    // second run reads back exactly what the first run wrote.
    const query = countingQuery((day) =>
      ingest.calls
        .filter((call) => call.day === day)
        .reduce((rows, call) => rows + call.rows.length, 0),
    );

    const first = contextFor(world, deliveredState());
    await runBackfill(first.ctx, { query, ingest });
    const afterFirst = ingest.calls.length;

    const second = contextFor(world, deliveredState());
    await runBackfill(second.ctx, { query, ingest });

    expect(afterFirst).toBe(2);
    expect(ingest.calls).toHaveLength(afterFirst);
    expect(second.logger.lines).toContain(
      'ok backfill complete: inserted 0 rows across 0 days; skipped 2 days already in the table and 2 with no events',
    );
  });

  it('writes no state of its own - the bound is read, never advanced', async () => {
    const world = analyticsWorld({ events: { [FIXTURE_DAY]: [eventFor(FIXTURE_RECORD)] } });
    const resources = deliveredState();
    const { ctx, saves } = contextFor(world, resources);
    const before = JSON.stringify(resources);

    await runBackfill(ctx, portsWith());

    expect(saves).toEqual([]);
    expect(JSON.stringify(ctx.state.resources)).toBe(before);
  });

  it('takes the range from retention.cloudfrontDays', async () => {
    const world = analyticsWorld();
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await runBackfill(ctx, ports);

    expect(ports.query.days).toHaveLength(RETENTION_DAYS);
    expect(ports.query.days).toEqual(CANDIDATE_DAYS);
  });
});

/* -------------------------------------------------------------------------
 * The refusals, and what they cost.
 * ------------------------------------------------------------------------- */

describe('a missing bound', () => {
  it('refuses when the plugin state carries no delivery record at all', async () => {
    const world = analyticsWorld();
    const { ctx, calls } = contextFor(world, {});
    const ports = portsWith();

    await expect(runBackfill(ctx, ports)).rejects.toThrow(
      `records no ${LOG_DELIVERY_NODE} at all - run \`blogwright analytics bootstrap ${ENV}\``,
    );
    // Before any AWS call, and before the table is touched either way.
    expect(calls).toEqual([]);
    expect(ports.query.days).toEqual([]);
    expect(ports.ingest.calls).toEqual([]);
  });

  it('refuses when the record exists but carries no createdDay, and says how to supply one', async () => {
    // Reachable rather than hypothetical: the delivery node's `read` hydrates
    // a delivery it finds already attached without writing the day.
    const world = analyticsWorld();
    const { ctx, calls } = contextFor(world, {
      [LOG_DELIVERY_NODE]: { source: 'src', destination: 'dst', delivery: 'configured' },
    });
    const ports = portsWith();

    const failure = runBackfill(ctx, ports);
    await expect(failure).rejects.toThrow(`carries no "${CREATED_DAY_KEY}"`);
    await expect(failure).rejects.toThrow(`blogwright analytics bootstrap ${ENV}`);
    await expect(failure).rejects.toThrow('will not add it to a delivery that already exists');
    expect(calls).toEqual([]);
    expect(ports.ingest.calls).toEqual([]);
  });

  it('refuses a createdDay that is not a calendar day', async () => {
    const world = analyticsWorld();
    const { ctx, calls } = contextFor(world, deliveredState('2026-02-30'));

    await expect(runBackfill(ctx, portsWith())).rejects.toThrow(
      'carries "createdDay": "2026-02-30", which is not a YYYY-MM-DD calendar day',
    );
    expect(calls).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * The report.
 * ------------------------------------------------------------------------- */

describe('the report', () => {
  it('names the days inserted, the days skipped and the boundary day it leaves alone', async () => {
    const world = analyticsWorld({
      events: {
        '2026-08-17': [eventFor(recordOn('2026-08-17', 0))],
        '2026-08-18': [eventFor(recordOn('2026-08-18', 0)), eventFor(recordOn('2026-08-18', 1))],
        '2026-08-19': ['not json at all'],
      },
    });
    const { ctx, logger } = contextFor(world, deliveredState());

    await runBackfill(
      ctx,
      portsWith((day) => (day === '2026-08-17' ? 3 : 0)),
    );

    expect(logger.lines).toEqual([
      `info Analytics backfill for "${ENV}" from ${LOG_GROUP} into web.page_views`,
      'info   4 whole UTC days from 2026-08-16 to 2026-08-19, bounded below by retention.cloudfrontDays',
      'info   skipped 2026-08-16: the log group holds no events for that day',
      'info   skipped 2026-08-17: the table already holds 3 rows for that day',
      'info   inserted 2026-08-18: 2 rows',
      'warn 2026-08-19: 1 of 1 log events could not be mapped and were not inserted - the log event is not a JSON object',
      'info   skipped 2026-08-19: the log group holds no events for that day',
      'ok backfill complete: inserted 2 rows across 1 days; skipped 1 days already in the table and 2 with no events',
      `info   ${CREATED_DAY} is the day the Firehose delivery was created and is never backfilled - up to one day of history at the seam is the accepted precision limit`,
    ]);
  });

  it('names the column a dropped record could not fill', async () => {
    const { 'x-host-header': _host, ...withoutHost } = FIXTURE_RECORD;
    const world = analyticsWorld({ events: { [FIXTURE_DAY]: [eventFor(withoutHost)] } });
    const { ctx, logger } = contextFor(world, deliveredState());

    await runBackfill(ctx, portsWith());

    expect(logger.lines).toContain(
      'warn 2026-08-18: 1 of 1 log events could not be mapped and were not inserted - page_views column "host" cannot be filled: CloudFront field "x-host-header" is absent',
    );
  });
});

/* -------------------------------------------------------------------------
 * The bound the delivery node writes is the bound this command reads.
 * ------------------------------------------------------------------------- */

describe('the state key the delivery node writes', () => {
  it('is the one the backfill reads - no refusal after a real create()', async () => {
    // The routed finding this closes: task 53 keeps `createdDay` written in
    // one module and read in another, and until both name the same exported
    // constant nothing checks that the two spellings agree. This drives the
    // real node's `create` and then the real command over the state it left.
    const world = analyticsWorld();
    const { ctx, logger } = contextFor(world, {
      'analytics-log-destination': {
        arn: `arn:aws:logs:${REGION}:${ACCOUNT}:delivery-destination:${ENV}-${SITE}-analytics-dest`,
      },
    });

    await analyticsLogDeliveryNode().create(ctx);

    const written = ctx.state.resources[LOG_DELIVERY_NODE]?.[CREATED_DAY_KEY];
    expect(typeof written).toBe('string');

    await runBackfill(ctx, portsWith());

    expect(logger.lines.at(-1)).toBe(
      `info   ${String(written)} is the day the Firehose delivery was created and is never backfilled - up to one day of history at the seam is the accepted precision limit`,
    );
  });
});

/* -------------------------------------------------------------------------
 * The composition root.
 * ------------------------------------------------------------------------- */

describe('the `analytics backfill` command body', () => {
  it('runs the backfill over the ports it is handed, and awaits it', async () => {
    // `commands.ts` owns three lines - the two adapter constructions and this
    // delegation - and nothing else in the suite drives them. A `backfill`
    // that forgot to await would resolve before the insert and this would see
    // an empty recording; one that passed the wrong context would refuse.
    const world = analyticsWorld({ events: { [FIXTURE_DAY]: [eventFor(FIXTURE_RECORD)] } });
    const { ctx } = contextFor(world, deliveredState());
    const ports = portsWith();

    await backfill(ctx, [], ports);

    expect(ports.ingest.calls).toHaveLength(1);
    expect(ports.ingest.calls[0]?.rows).toStrictEqual([EXPECTED_ROW]);
  });
});
