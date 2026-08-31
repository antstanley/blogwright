/**
 * The fixture-backed {@link AnalyticsQuery} every consumer's test substitutes
 * at the port, so no test in this package starts DuckDB. It is the analytics
 * counterpart of `packages/core/src/adapters/memory-fs.ts`: a real
 * implementation of the port, seeded with data, shipped beside the interface
 * it implements.
 *
 * It is not a stub that answers anything. It runs the *same*
 * {@link prepareQuery} the DuckDB adapter runs, so an unknown name and an
 * absent or inverted range are refused here with the same messages a real
 * dashboard would produce, and it refuses at construction to hold rows that do
 * not match the query's declared result columns. That second check is the
 * point: a fake seeded with rows shaped like nothing the query returns lets a
 * consumer's assertions pass for the wrong reason, which is the commonest way
 * a test stops being able to fail.
 *
 * `calls` records what each accepted call resolved to, so a consumer can
 * assert *what was bound* - that its date range reached the query, that its
 * bot flag defaulted from `config.analytics.bots` - without a spy or a mock.
 */

import { type AnalyticsConfig, validateAnalyticsConfig } from './config.js';
import type { AnalyticsQuery, QueryRow } from './ports.js';
import {
  type PreparedQuery,
  prepareQuery,
  type QueryName,
  type QueryParams,
  queryDefinition,
} from './queries.js';

/** Rows to answer with, per query name. A name with no entry raises when asked for. */
export type QueryFixtures = Partial<Record<QueryName, readonly QueryRow[]>>;

/** The fake, plus the record of what it was asked. */
export interface FixtureAnalyticsQuery extends AnalyticsQuery {
  /** Every accepted call, in order, as the shared lookup resolved it. */
  readonly calls: readonly PreparedQuery[];
}

/** Render a list for a message, saying so when it is empty rather than trailing off. */
function formatList(items: readonly string[]): string {
  return items.length === 0 ? 'none' : items.join(', ');
}

/**
 * Refuse fixture rows that are not shaped like the query's own result. Checked
 * once, at construction, so the failure names the test's own fixture rather
 * than surfacing later as an assertion that passed against the wrong keys.
 */
function checkFixtureShape(name: string, rows: readonly QueryRow[]): void {
  const expected = [...queryDefinition(name).resultColumns].sort();
  rows.forEach((row, index) => {
    const actual = Object.keys(row).sort();
    if (actual.join(',') !== expected.join(',')) {
      throw new Error(
        `fixture row ${index} for analytics query "${name}" must carry exactly its result columns ${formatList(expected)}, got ${formatList(actual)}`,
      );
    }
  });
}

/**
 * Build an {@link AnalyticsQuery} that answers from `fixtures`.
 *
 * `config` defaults to a validated empty `analytics` block, so a consumer that
 * does not care about bot handling gets task 44's own default rather than a
 * second copy of it stated here; a consumer that does care passes a block
 * validated from the raw config it is exercising.
 */
export function createFixtureAnalyticsQuery(
  fixtures: QueryFixtures,
  config: Pick<AnalyticsConfig, 'bots'> = validateAnalyticsConfig({}),
): FixtureAnalyticsQuery {
  const recorded = new Map<string, readonly QueryRow[]>();
  for (const [name, rows] of Object.entries(fixtures)) {
    if (rows === undefined) continue;
    checkFixtureShape(name, rows);
    recorded.set(name, rows);
  }
  const calls: PreparedQuery[] = [];

  return {
    calls,

    async run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> {
      const prepared = prepareQuery(name, params, config);
      calls.push(prepared);
      const rows = recorded.get(prepared.name);
      if (rows === undefined) {
        throw new Error(
          `no fixture rows recorded for analytics query "${prepared.name}" - recorded queries are ${formatList([...recorded.keys()])}`,
        );
      }
      return rows;
    },
  };
}
