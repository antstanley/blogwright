/**
 * `blogwright analytics backfill`: the optional, one-shot, hand-run pull of
 * history that predates the Firehose delivery, from the CloudWatch log group
 * the site's own delivery already writes into the `page_views` table. This is
 * the change spec's
 * [§Analytics pipeline → Backfill of historical logs](../../../.specs/changes/merged/2026-07-26-analytics_plugin.md),
 * and it is explicitly **not** part of the steady-state pipeline, which stays
 * the push path §Shape draws: CloudFront → Firehose → Iceberg, with no
 * operator in the loop.
 *
 * ## The identical-row property
 *
 * A record backfilled from CloudWatch and the same record delivered through
 * Firehose produce the same `page_views` row, and that is a property of code
 * reuse rather than of two implementations agreeing. This module owns no
 * mapping at all: it hands each event to `mapRecord` - the same function the
 * transform Lambda's envelope calls - which derives `event_time`, the `day`
 * partition, `visitor_key` and `is_bot`, and applies the same drop rules. The
 * historical day's salt is derivable for the same reason the spec gives: the
 * per-day salt is `HMAC-SHA256(secret, day)` over one long-lived stored secret
 * that is never rewritten, and `mapRecord` derives it from the record's own
 * day, so a record from three months ago hashes under the salt it would have
 * hashed under then.
 *
 * ## Idempotency, by construction rather than by de-duplication
 *
 * Three bounds, and none of them inspects a row to decide:
 *
 * 1. **Only whole UTC days strictly before the recorded bound.** The
 *    `analytics-log-delivery` node records {@link CREATED_DAY_KEY} the first
 *    time it creates its delivery, and never advances it. Firehose received
 *    nothing before its delivery existed, so every day this command touches is
 *    a day the Firehose path has no rows in, and the two row sets are
 *    disjoint. The boundary day itself is never backfilled - up to one day of
 *    history at the seam is the spec's stated precision limit, accepted rather
 *    than patched with a row-level de-duplication pass.
 * 2. **A day that already holds rows is skipped**, counted through the
 *    existing `AnalyticsQuery` port. That is what makes a re-run a no-op and a
 *    crashed run resumable, and it is only sound because each day is inserted
 *    in one transaction: a partially written day would be counted as occupied
 *    and its remainder lost.
 * 3. **A mapped row whose own `day` is not the day being written is not
 *    inserted.** The CloudWatch window is a request for a day's events and
 *    AWS's `endTime` is not documented as exclusive; the row's own `day` is,
 *    so that - not the window - is what decides which day a row belongs to.
 *    Without it a record on the far side of midnight could reach the day the
 *    Firehose delivery already covers.
 *
 * ## What it refuses, and why the refusal is not optional
 *
 * With no bound in the plugin's scoped state there is nothing to compute a
 * range from, and there is no safe default: "everything" would insert days
 * Firehose already delivered and silently double every row in them. So this
 * command refuses, before any AWS call, in both of the two states that leave
 * it without one - no delivery record at all, and a delivery record with no
 * {@link CREATED_DAY_KEY}. The second is reachable and is not a corruption:
 * the delivery node's `read` hydrates a delivery it finds already attached
 * without writing the day, because `DescribeDeliveries` reports no creation
 * date and a fabricated later bound is the one error direction that corrupts
 * data rather than merely losing some.
 *
 * ## Ports
 *
 * The read is core's existing `LogsClient.filterEvents` over
 * `ctx.clients.logsUsEast1` - no new client and no new core operation. The
 * count is one named query through `AnalyticsQuery`. The write crosses
 * `AnalyticsIngest`. This module names no vendor library and issues no
 * statement of its own.
 */

import { colors, type PluginContext } from 'blogwright-core';

import { createAnalyticsClients } from './aws/clients.js';
import { type AnalyticsConfig, resolveAnalyticsConfig } from './config.js';
import { CREATED_DAY_KEY, LOG_DELIVERY_NODE } from './nodes.js';
import type { AnalyticsIngest, AnalyticsQuery } from './ports.js';
import { ROW_COUNT_COLUMN, ROW_COUNT_QUERY } from './queries.js';
import type { PageView } from './schema.js';
import { type CloudFrontRecord, mapRecord } from './transform/map-record.js';

/**
 * The slice of a plugin context this command reads, taken as a `Pick` of
 * core's own `PluginContext` rather than a restatement of it, the way
 * `DashboardCommandContext` and `DuckDbSessionContext` already are: the
 * members cannot drift from the SPI, any `PluginContext<AnalyticsConfig>`
 * satisfies it, and a test builds what it needs instead of the SPI's sixteen.
 *
 * `store`, `save`, `record` and `siteState` are deliberately absent, and their
 * absence is a statement: **a backfill writes no state.** It reads the bound
 * the delivery node recorded and nothing else, so a run that crashes halfway
 * leaves the plugin's state object exactly as it found it, and the only thing
 * that makes a second run different from the first is what is in the table.
 */
export type BackfillContext = Pick<
  PluginContext<AnalyticsConfig>,
  'env' | 'config' | 'pluginConfig' | 'names' | 'clients' | 'state' | 'logger'
>;

/** The two ports {@link runBackfill} is driven over. */
export interface BackfillPorts {
  /** Reads the table - one named `row-count` per candidate day. */
  readonly query: AnalyticsQuery;
  /** Writes the table - one call per day that turned out to have rows. */
  readonly ingest: AnalyticsIngest;
}

/** Milliseconds in a UTC day. Every day boundary in this module is computed from it. */
const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` - the shape both the state bound and the `day` column carry. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The leading characters of an ISO-8601 instant that are its UTC day. */
const ISO_DAY_LENGTH = 10;

/** What one candidate day turned into. */
interface DayOutcome {
  readonly day: string;
  /** Rows handed to `insertDay`, or 0 for a day that was skipped. */
  readonly inserted: number;
  /** Why nothing was inserted, for a day that was skipped. */
  readonly skipped?: 'occupied' | 'empty';
}

/** The UTC day an epoch-millisecond instant falls on. */
function dayOf(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, ISO_DAY_LENGTH);
}

/** Midnight UTC opening `day`, in epoch milliseconds. */
function startOf(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/**
 * True for a `YYYY-MM-DD` that names a day that exists. The round trip is what
 * rejects `2026-02-30`: `Date.parse` accepts it and rolls it forward to March,
 * so a shape check alone would compute a range from a day the calendar does
 * not have.
 */
function isCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const start = startOf(day);
  return !Number.isNaN(start) && dayOf(start) === day;
}

/**
 * The idempotency bound: the UTC day the plugin's delivery was first created,
 * off the `analytics-log-delivery` node's recorded outputs.
 *
 * Three refusals rather than one, because the operator's remedy differs. No
 * record at all means the pipeline was never provisioned. A record with no
 * day means the state file lost the key or was written by a `read` that
 * adopted an existing delivery - and there the remedy is to supply the bound,
 * not to re-bootstrap, because bootstrapping again will not write a key the
 * node only writes when it creates the delivery. A malformed day is neither,
 * and says what it found.
 */
function requireCreatedDay(ctx: BackfillContext): string {
  const bootstrap = `blogwright analytics bootstrap ${ctx.env}`;
  const recorded = ctx.state.resources[LOG_DELIVERY_NODE];
  if (recorded === undefined) {
    throw new Error(
      `blogwright analytics backfill needs the day the Firehose delivery was created, and the analytics state for "${ctx.env}" records no ${LOG_DELIVERY_NODE} at all - run \`${bootstrap}\` to provision the pipeline first`,
    );
  }
  const day = recorded[CREATED_DAY_KEY];
  if (typeof day !== 'string' || day === '') {
    throw new Error(
      `blogwright analytics backfill needs the day the Firehose delivery was created, and the ${LOG_DELIVERY_NODE} entry in the analytics state for "${ctx.env}" carries no "${CREATED_DAY_KEY}" - it is written only when the delivery is first created, so \`${bootstrap}\` will not add it to a delivery that already exists; set "${CREATED_DAY_KEY}" on that entry to the UTC day the delivery was created (a day too early loses nothing, a day too late double-inserts)`,
    );
  }
  if (!isCalendarDay(day)) {
    throw new Error(
      `the ${LOG_DELIVERY_NODE} entry in the analytics state for "${ctx.env}" carries "${CREATED_DAY_KEY}": ${JSON.stringify(day)}, which is not a YYYY-MM-DD calendar day - \`${bootstrap}\` writes it in that form`,
    );
  }
  return day;
}

/**
 * The candidate days, oldest first: the `retention.cloudfrontDays` whole UTC
 * days immediately before `createdDay`.
 *
 * Anchored on the bound rather than on the clock, and that is deliberate -
 * this command reads no clock at all. The lower bound exists because the log
 * group is the only thing that holds these events and its retention is what
 * decides how far back they go; anchoring it on "today" would need a clock
 * and would make the same command answer differently on two consecutive days
 * for no gain, since a day CloudWatch has already expired simply reads back
 * with no events and is reported as such.
 */
function candidateDays(createdDay: string, retentionDays: number): string[] {
  const boundary = startOf(createdDay);
  const days: string[] = [];
  for (let back = retentionDays; back >= 1; back -= 1) {
    days.push(dayOf(boundary - back * MS_PER_DAY));
  }
  return days;
}

/**
 * The rows already in the table for `day`, through the named `row-count`
 * query. `includeBots` is bound explicitly rather than left to
 * `config.analytics.bots`: this is the table's occupancy and not a dashboard
 * figure, so a day holding nothing but bot traffic is an occupied day.
 */
async function rowsAlreadyIn(query: AnalyticsQuery, day: string): Promise<number> {
  const rows = await query.run(ROW_COUNT_QUERY, {
    range: { from: day, to: day },
    includeBots: true,
  });
  const count = rows[0]?.[ROW_COUNT_COLUMN];
  if (typeof count !== 'number') {
    throw new Error(
      `the ${ROW_COUNT_QUERY} query answered no ${ROW_COUNT_COLUMN} for ${day}, so the backfill cannot tell whether that day is already in the table`,
    );
  }
  return count;
}

/**
 * One CloudWatch log event's message as a CloudFront record, or `undefined`
 * when it is not one.
 *
 * The twin of `transform/handler.ts`'s `decodePayload`, and separate from it
 * on purpose: the two envelopes differ (Firehose hands over base64, CloudWatch
 * hands over the message text), and `map-record.ts` documents that parsing and
 * its failures belong to each boundary rather than to the mapping. What the
 * two share - what a record IS once parsed - is the type, not the parser.
 */
function recordFrom(message: string): CloudFrontRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as CloudFrontRecord;
}

/** What mapping one day's events produced. */
interface MappedDay {
  /** Rows that belong to this day, in the order the log group returned them. */
  readonly rows: PageView[];
  /** Events the schema could not accept, and the first reason one gave. */
  readonly unmappable: number;
  readonly firstReason?: string | undefined;
  /** Rows that mapped cleanly but carried another day. */
  readonly foreign: number;
}

/**
 * Map one day's log events. Every event goes through `mapRecord` and nothing
 * else; what this adds is the two ways a mapped event still does not belong in
 * this day's insert - it could not be mapped at all, or its own `day` says it
 * belongs to another one.
 */
function mapDay(messages: readonly string[], day: string, saltSecret: string): MappedDay {
  const rows: PageView[] = [];
  let unmappable = 0;
  let foreign = 0;
  let firstReason: string | undefined;

  for (const message of messages) {
    const record = recordFrom(message);
    if (record === undefined) {
      unmappable += 1;
      firstReason ??= 'the log event is not a JSON object';
      continue;
    }
    const mapped = mapRecord(record, saltSecret);
    if (!mapped.mapped) {
      unmappable += 1;
      firstReason ??= mapped.reason;
      continue;
    }
    if (mapped.row.day !== day) {
      foreign += 1;
      continue;
    }
    rows.push(mapped.row);
  }

  return { rows, unmappable, foreign, ...(firstReason === undefined ? {} : { firstReason }) };
}

/**
 * The long-lived salt secret behind `visitor_key`, read once for the whole
 * run through the plugin's own us-east-1 Secrets Manager client - the region
 * pin, so the value read here is the value the transform Lambda reads.
 *
 * Read before the first day rather than on the first day that needs it: a run
 * that discovered a missing secret after eighty-nine occupancy queries would
 * have spent them for nothing, and an operator who has to fix the secret wants
 * to know at the start.
 */
async function readSaltSecret(ctx: BackfillContext, secretName: string): Promise<string> {
  const secret = await createAnalyticsClients(ctx).secrets.getSecretValue(secretName);
  if (secret === undefined || secret.trim() === '') {
    throw new Error(
      `the analytics salt secret "${secretName}" holds no value: an unsalted visitor_key would identify the visitor it exists to hide, so the backfill stops instead - run \`blogwright analytics bootstrap ${ctx.env}\` to create the secret`,
    );
  }
  return secret;
}

/** One day: count, read, map, insert - or say why it was skipped. */
async function backfillDay(
  ctx: BackfillContext,
  ports: BackfillPorts,
  day: string,
  saltSecret: string,
): Promise<DayOutcome> {
  const occupied = await rowsAlreadyIn(ports.query, day);
  if (occupied > 0) {
    ctx.logger.info(`  skipped ${day}: the table already holds ${occupied} rows for that day`);
    return { day, inserted: 0, skipped: 'occupied' };
  }

  const start = startOf(day);
  const events = await ctx.clients.logsUsEast1.filterEvents(ctx.names.cloudfrontLogGroup, {
    startTime: start,
    endTime: start + MS_PER_DAY,
  });
  const mapped = mapDay(
    events.map((event) => event.message),
    day,
    saltSecret,
  );

  // Reported per day rather than aggregated, and reported at all because the
  // silent version of this is the failure mode the whole pipeline is written
  // against: an operator whose log group carries a different field set sees an
  // empty table and no error anywhere.
  if (mapped.unmappable > 0) {
    ctx.logger.warn(
      `${day}: ${mapped.unmappable} of ${events.length} log events could not be mapped and were not inserted - ${mapped.firstReason}`,
    );
  }
  if (mapped.foreign > 0) {
    ctx.logger.warn(
      `${day}: ${mapped.foreign} log events carried another day and were left to that day's own pass`,
    );
  }

  if (mapped.rows.length === 0) {
    ctx.logger.info(`  skipped ${day}: the log group holds no events for that day`);
    return { day, inserted: 0, skipped: 'empty' };
  }

  await ports.ingest.insertDay(day, mapped.rows);
  ctx.logger.info(`  inserted ${day}: ${mapped.rows.length} rows`);
  return { day, inserted: mapped.rows.length };
}

/** Count the outcomes carrying `skipped`. */
function countSkipped(outcomes: readonly DayOutcome[], reason: DayOutcome['skipped']): number {
  return outcomes.filter((outcome) => outcome.skipped === reason).length;
}

/**
 * Run the backfill. Fails rather than continuing when a day's insert fails: a
 * report saying five days landed while one in the middle did not would leave
 * an operator unable to tell which history they have, and the occupancy check
 * makes re-running after a fix cost nothing for the days that did land.
 */
export async function runBackfill(ctx: BackfillContext, ports: BackfillPorts): Promise<void> {
  const createdDay = requireCreatedDay(ctx);
  const config = resolveAnalyticsConfig(ctx);
  const relation = `${config.namespace}.${config.table}`;
  const days = candidateDays(createdDay, ctx.config.retention.cloudfrontDays);

  ctx.logger.info(
    colors.bold(
      `Analytics backfill for "${ctx.env}" from ${ctx.names.cloudfrontLogGroup} into ${relation}`,
    ),
  );
  ctx.logger.info(
    `  ${days.length} whole UTC days from ${days[0]} to ${days.at(-1)}, bounded below by retention.cloudfrontDays`,
  );

  const saltSecret = await readSaltSecret(ctx, config.saltSecretName);

  const outcomes: DayOutcome[] = [];
  for (const day of days) {
    outcomes.push(await backfillDay(ctx, ports, day, saltSecret));
  }

  const insertedDays = outcomes.filter((outcome) => outcome.inserted > 0);
  const insertedRows = insertedDays.reduce((total, outcome) => total + outcome.inserted, 0);
  ctx.logger.ok(
    `backfill complete: inserted ${insertedRows} rows across ${insertedDays.length} days; skipped ${countSkipped(outcomes, 'occupied')} days already in the table and ${countSkipped(outcomes, 'empty')} with no events`,
  );
  ctx.logger.info(
    `  ${createdDay} is the day the Firehose delivery was created and is never backfilled - up to one day of history at the seam is the accepted precision limit`,
  );
}
