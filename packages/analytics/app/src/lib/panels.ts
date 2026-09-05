/**
 * What the dashboard renders, as data: one entry per named query, saying which
 * result column is the category, which is the value, and how the value reads.
 *
 * **Nothing here is a string the dashboard invented.** A panel's `name` is a
 * {@link QueryName}, and its columns are that query's *own* `resultColumns` -
 * {@link ResultColumn} reads them off the definition table, so `views` on a
 * query that selects `requests` does not compile. Both imports are type-only
 * (`typeof ANALYTICS_QUERIES` needs the binding in type position and nothing
 * more), so the definition table and its SQL stay on the server side of the
 * wire.
 *
 * Rows arrive in the order the definition's `ORDER BY` returned them, so a
 * ranking panel takes the first {@link RANKING_LIMIT} and never re-sorts.
 */

import type { ANALYTICS_QUERIES, QueryName } from '../../../src/queries.js';

/** One of the result columns query `Name` declares - not any string. */
type ResultColumn<Name extends QueryName> =
  (typeof ANALYTICS_QUERIES)[Name]['resultColumns'][number];

/**
 * How a panel's value column reads: a count of things, or a ratio in `0..1`.
 * Not exported - no consumer outside this module names it, and `pnpm knip`
 * reports an export that nothing imports. Export it when one does.
 */
type ValueKind = 'count' | 'ratio';

/**
 * How many rows a ranking panel shows. Paths, referrers and countries all have
 * long tails a chart cannot render legibly; the panel says what it is showing
 * rather than implying the list ends here.
 */
export const RANKING_LIMIT = 12;

/** One panel, pinned to the query it renders. */
interface PanelFor<Name extends QueryName> {
  /** The query to run. */
  readonly name: Name;
  /** The heading. Says what the chart shows, never more than the query computes. */
  readonly title: string;
  /** The result column along the category axis. */
  readonly category: ResultColumn<Name>;
  /** The result column along the value axis. */
  readonly value: ResultColumn<Name>;
  /** How the value reads. */
  readonly valueKind: ValueKind;
  /**
   * `true` for a ranking - a long tail cut at {@link RANKING_LIMIT}, drawn
   * with the categories down the side because a path does not fit under a bar.
   */
  readonly ranked: boolean;
  /**
   * A column carrying one figure for the whole range, shown under the chart
   * and labelled with the column's own name. Only `unique-visitors` has one,
   * and that label is why: it is the summed-daily-uniques figure, which must
   * never be presented as a distinct count across days.
   */
  readonly totalColumn?: ResultColumn<Name> | undefined;
}

/** A panel for one of the names, discriminated by `name`. */
export type Panel = { [Name in QueryName]: PanelFor<Name> }[QueryName];

/** Every panel the dashboard draws, in the order it draws them. */
export const PANELS: readonly Panel[] = [
  {
    name: 'views-over-time',
    title: 'Views over time',
    category: 'day',
    value: 'views',
    valueKind: 'count',
    ranked: false,
  },
  {
    name: 'unique-visitors',
    title: 'Daily unique visitors',
    category: 'day',
    value: 'daily_unique_visitors',
    valueKind: 'count',
    ranked: false,
    totalColumn: 'summed_daily_unique_visitors',
  },
  {
    name: 'referrers',
    title: 'Referrers',
    category: 'referrer',
    value: 'views',
    valueKind: 'count',
    ranked: true,
  },
  {
    name: 'top-paths',
    title: 'Top paths',
    category: 'uri',
    value: 'views',
    valueKind: 'count',
    ranked: true,
  },
  {
    name: 'countries',
    title: 'Countries',
    category: 'country',
    value: 'views',
    valueKind: 'count',
    ranked: true,
  },
  {
    name: 'status-codes',
    title: 'Status codes',
    category: 'status',
    value: 'views',
    valueKind: 'count',
    ranked: false,
  },
  {
    name: 'cache-hit-ratio',
    title: 'Cache hit ratio',
    category: 'day',
    value: 'cache_hit_ratio',
    valueKind: 'ratio',
    ranked: false,
  },
];
