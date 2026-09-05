/**
 * The dashboard's **only** path to data.
 *
 * Every figure on the page comes through {@link runNamedQuery}, which asks the
 * local server for one of the names `../../../src/queries.ts` declares. There
 * is deliberately nothing else here:
 *
 * - **No origin is named.** The request path is site-root-relative, so it is
 *   resolved against the page's own origin - whatever the operator typed to
 *   open the dashboard. A second host cannot be reached from this module
 *   because no module in this application spells one.
 * - **No statement is ever sent.** The server exposes no route that accepts
 *   SQL, and this module has no parameter that could carry one: a request
 *   carries a query *name* and, in the query string, the two ends of a date
 *   range and the bot-inclusion choice. The server rejects any other
 *   query-string key with a 400 rather than ignoring it, so a stray parameter
 *   added here would fail loudly instead of quietly.
 * - **The name is a {@link QueryName}, not a string.** Task 45 made the set
 *   closed and this module consumes it as a type, so a query the server does
 *   not answer is a compile error here rather than a 404 a reader discovers.
 *   The import is type-only, so nothing from the server package - and none of
 *   its SQL - reaches the browser bundle.
 */

import type { QueryRow } from '../../../src/ports.js';
import type { ViewGranularity } from '../../../src/view-granularity.js';
import type { QueryName } from '../../../src/queries.js';

/** The path prefix the local server answers named queries under. */
const QUERY_ROUTE_PREFIX = '/api/queries/';

/** UTC input values, formatted as YYYY-MM-DDTHH:mm. */
interface DateRange {
  /** Inclusive start UTC minute. */
  readonly from: string;
  /** Exclusive end UTC minute. */
  readonly to: string;
}

/** All shows bot/non-bot stacks; include shows combined totals; exclude removes bots. */
export type BotInclusion = 'all' | 'include' | 'exclude';

/** The `includeBots` value each explicit choice sends. All and Include bots explicitly include bots. */
const BOT_INCLUSION_VALUES: Readonly<Partial<Record<BotInclusion, string>>> = {
  all: 'true',
  include: 'true',
  exclude: 'false',
};

/** Everything one request carries beyond the query's own name. */
export interface QueryRequest {
  /** The UTC reporting window. */
  readonly range: DateRange;
  /** What to do about bot-flagged rows. */
  readonly bots: BotInclusion;
  /** Optional interval for the Views over time query. */
  readonly granularity?: ViewGranularity;
}

/** One named query's answer, exactly as the local server shapes it. */
export interface QueryResult {
  /** The name that resolved - the server echoes it rather than the caller trusting its own. */
  readonly name: string;
  /**
   * What one row means, in the definition's own words. Rendered beside the
   * chart: it is where `unique-visitors` says that a range total is a sum of
   * daily counts and not a distinct count, so a panel cannot relabel it.
   */
  readonly rowMeaning: string;
  /** The columns a row carries, in the order the statement selects them. */
  readonly resultColumns: readonly string[];
  /** The rows, in the order the definition's `ORDER BY` returned them. */
  readonly rows: readonly QueryRow[];
}

/** The query string one request carries. Built here so no caller assembles one by hand. */
function searchParamsFor(request: QueryRequest): URLSearchParams {
  const params = new URLSearchParams({
    from: `${request.range.from}Z`,
    to: `${request.range.to}Z`,
  });
  if (request.bots === 'all') params.set('splitBots', 'true');
  if (request.granularity !== undefined) params.set('granularity', request.granularity);
  const includeBots = BOT_INCLUSION_VALUES[request.bots];
  if (includeBots !== undefined) params.set('includeBots', includeBots);
  return params;
}

/** Whether `value` is a record we can read named fields off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The sentence a failed request reports. The server answers every refusal as
 * `{ "error": "..." }` - a missing range, an unknown name, an application that
 * has not been built - so the reader sees the server's own words rather than a
 * status code this module invented a message for.
 */
function failureMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['error'] === 'string') return body['error'];
  return `the dashboard server answered ${status}`;
}

/**
 * Narrow a decoded response body to a {@link QueryResult}, refusing anything
 * else. The server is the only thing that answers this path, so this is not a
 * trust boundary - it is the boundary where `unknown` becomes a typed value,
 * and a panel that rendered `undefined.rows` would fail further from the
 * cause.
 */
function asQueryResult(name: QueryName, body: unknown): QueryResult {
  if (
    !isRecord(body) ||
    typeof body['name'] !== 'string' ||
    typeof body['rowMeaning'] !== 'string' ||
    !Array.isArray(body['resultColumns']) ||
    !Array.isArray(body['rows'])
  ) {
    throw new Error(`the answer to "${name}" was not shaped like a query result`);
  }
  return {
    name: body['name'],
    rowMeaning: body['rowMeaning'],
    resultColumns: body['resultColumns'] as readonly string[],
    rows: body['rows'] as readonly QueryRow[],
  };
}

/**
 * The response body as a value, or `undefined` when it is not JSON at all.
 * Every answer this server writes is JSON, but a refusal raised *below* it -
 * Node's own parser rejecting a malformed request - is plain text, and
 * decoding that with `response.json()` would replace the status the reader
 * needs with a parse error that names none of it.
 */
async function decodeBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Ask the local server for one named query over one date range. Raises with
 * the server's own message when it refuses, so a panel reports why rather than
 * showing an empty chart.
 */
export async function runNamedQuery(name: QueryName, request: QueryRequest): Promise<QueryResult> {
  const response = await fetch(`${QUERY_ROUTE_PREFIX}${name}?${searchParamsFor(request)}`, {
    headers: { accept: 'application/json' },
  });
  const body = await decodeBody(response);
  if (!response.ok) throw new Error(failureMessage(response.status, body));
  return asQueryResult(name, body);
}
