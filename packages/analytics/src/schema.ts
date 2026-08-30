/**
 * The single home for the `page_views` Iceberg table: its column set, its
 * `day` partition, the CloudFront standard-logging (v2) fields the delivery
 * selects, and the mapping between the two. The transform Lambda, the table
 * node and the delivery node all read these constants instead of restating
 * them - see [§Table schema](../../../.specs/changes/2026-07-26-analytics_plugin.md).
 *
 * Why this file is worth being careful with: Firehose matches incoming JSON
 * keys to Iceberg column names **exactly** and silently discards any field
 * that does not match a column - no error, no dead-letter record, nothing
 * that shows up in a log. A typo here does not fail loudly; it fills a
 * column with nulls forever, and nothing points back at this file as the
 * cause. Column names are lowercase throughout - an S3 Tables catalog
 * requirement, not a style choice.
 *
 * `cs(Cookie)` and `x-forwarded-for` carry personal data and have no
 * analytic use, so they are never selected: they never reach Firehose, the
 * transform, or the table. This governs the analytics delivery only. The
 * site's existing CloudWatch delivery (`packages/cli/src/nodes.ts`'s
 * `logDeliveryNode`, wired through `packages/core/src/aws/logs.ts`'s
 * `createDelivery`) is created with no `recordFields`, so AWS's default
 * field list - which includes both excluded fields - still applies to that
 * copy. Narrowing that is a separate change to the site's node, not this
 * one; do not "fix" that inconsistency here.
 *
 * Field names are verified against AWS's CloudFront standard-logging (v2)
 * documentation (docs.aws.amazon.com/AmazonCloudFront, "Configure standard
 * logging (v2)" and "Standard logging reference", current as of 2026-08-30):
 * the `recordFields` the CreateDelivery API accepts, and the field
 * descriptions in the log-file-field reference.
 *
 * Pure data and pure functions only: no `node:` builtin, no vendor SDK, no
 * `fetch`.
 */

/**
 * Iceberg primitive types used by the `page_views` table. Not exported: no
 * consumer needs the bare union today - a future one can reach the same
 * type as `PageViewsColumn['icebergType']`. Export it once a real consumer
 * needs the union by name.
 */
type IcebergType = 'string' | 'timestamp' | 'date' | 'int' | 'long' | 'double' | 'boolean';

/** One `page_views` column: its Iceberg type and whether Firehose may write a null. */
export interface PageViewsColumn {
  readonly name: string;
  readonly icebergType: IcebergType;
  readonly required: boolean;
}

/**
 * The `page_views` table, in the order the spec's `PageView` `$defs` block
 * lists it. `required` is `true` exactly for the spec's `PageView.required`
 * set (`event_time`, `day`, `host`, `uri`, `status`); every other column may
 * be null - CloudFront itself writes `-` for several of these when a request
 * has nothing to say (no referrer, no query string, and so on).
 */
export const PAGE_VIEWS_COLUMNS = [
  { name: 'event_time', icebergType: 'timestamp', required: true },
  { name: 'day', icebergType: 'date', required: true },
  { name: 'host', icebergType: 'string', required: true },
  { name: 'uri', icebergType: 'string', required: true },
  { name: 'query', icebergType: 'string', required: false },
  { name: 'method', icebergType: 'string', required: false },
  { name: 'status', icebergType: 'int', required: true },
  { name: 'referrer', icebergType: 'string', required: false },
  { name: 'user_agent', icebergType: 'string', required: false },
  { name: 'country', icebergType: 'string', required: false },
  { name: 'asn', icebergType: 'string', required: false },
  { name: 'edge_location', icebergType: 'string', required: false },
  { name: 'result_type', icebergType: 'string', required: false },
  { name: 'bytes_sent', icebergType: 'long', required: false },
  { name: 'time_taken', icebergType: 'double', required: false },
  { name: 'content_type', icebergType: 'string', required: false },
  { name: 'protocol', icebergType: 'string', required: false },
  { name: 'request_id', icebergType: 'string', required: false },
  { name: 'visitor_key', icebergType: 'string', required: false },
  { name: 'is_bot', icebergType: 'boolean', required: false },
] as const satisfies readonly PageViewsColumn[];

/** Every valid `page_views` column name, derived from the table above. */
export type PageViewColumnName = (typeof PAGE_VIEWS_COLUMNS)[number]['name'];

/** `page_views` is partitioned by this column. */
export const PAGE_VIEWS_PARTITION_COLUMN: PageViewColumnName = 'day';

/** Maps an `IcebergType` to the TypeScript type `PageView` stores it as. */
type TsTypeOf<T extends IcebergType> = T extends 'string' | 'timestamp' | 'date'
  ? string
  : T extends 'int' | 'long' | 'double'
    ? number
    : T extends 'boolean'
      ? boolean
      : never;

type RequiredColumn = Extract<(typeof PAGE_VIEWS_COLUMNS)[number], { required: true }>;
type OptionalColumn = Extract<(typeof PAGE_VIEWS_COLUMNS)[number], { required: false }>;

/**
 * One `page_views` row, derived from `PAGE_VIEWS_COLUMNS` rather than
 * hand-typed, so the transform (which builds these) cannot invent a column
 * name the table does not carry - a typo in a property name here is a
 * compile error, not a silently-dropped Firehose field.
 */
export type PageView = { [C in RequiredColumn as C['name']]: TsTypeOf<C['icebergType']> } & {
  [C in OptionalColumn as C['name']]?: TsTypeOf<C['icebergType']>;
};

/**
 * The CloudFront viewer-IP field. Selected so the transform can derive
 * `visitor_key` from it (IP + user agent + a secret daily salt); the raw
 * value is discarded by the transform and never written to any column, so
 * it has no entry in `FIELD_TO_COLUMN`.
 */
export const VIEWER_IP_FIELD = 'c-ip';

/**
 * The CloudFront millisecond-epoch timestamp field. Selected so the
 * transform can derive both `event_time` and the `day` partition from it;
 * because it feeds two columns rather than renaming into one, it has no
 * entry in `FIELD_TO_COLUMN` either. Not exported: no current consumer
 * needs the bare constant - task 40's transform is the first that will, and
 * should add `export` back beside its own import when it does, rather than
 * this task exporting it speculatively.
 */
const TIMESTAMP_MS_FIELD = 'timestamp(ms)';

/**
 * Selected CloudFront fields that feed a `DERIVED_COLUMNS` entry instead of
 * being renamed 1:1 into a column of their own.
 */
export const DERIVATION_ONLY_FIELDS = [VIEWER_IP_FIELD, TIMESTAMP_MS_FIELD] as const;

/**
 * The CloudFront standard-logging (v2) field name each `page_views` column
 * is filled from, a straight rename with no other transformation. Field
 * names and meanings are as AWS documents them under "Standard logging
 * reference":
 *
 * - `x-host-header` (not `cs(Host)`) is the Host header the viewer actually
 *   sent - the alternate domain name (CNAME) when the site has one, and the
 *   distribution's own domain otherwise. `cs(Host)` always reports the raw
 *   CloudFront distribution domain regardless of what the viewer requested,
 *   which would make `host` a constant for every custom-domain site.
 * - `x-edge-result-type` (not `x-edge-response-result-type` or
 *   `x-edge-detailed-result-type`) is the standard hit/miss/error
 *   classification after the response finished sending - the field AWS's own
 *   sample cache-hit-ratio queries group by. The other two exist for
 *   diagnosing mid-response client disconnects and origin-error detail,
 *   which this table does not carry a column for.
 * - `sc-bytes` (not `cs-bytes` or `sc-content-len`) is the total bytes
 *   CloudFront sent to the viewer, matching `bytes_sent`; `cs-bytes` is the
 *   viewer's request size and `sc-content-len` is only the `Content-Length`
 *   header value.
 */
export const FIELD_TO_COLUMN = {
  'x-host-header': 'host',
  'cs-uri-stem': 'uri',
  'cs-uri-query': 'query',
  'cs-method': 'method',
  'sc-status': 'status',
  'cs(Referer)': 'referrer',
  'cs(User-Agent)': 'user_agent',
  'c-country': 'country',
  asn: 'asn',
  'x-edge-location': 'edge_location',
  'x-edge-result-type': 'result_type',
  'sc-bytes': 'bytes_sent',
  'time-taken': 'time_taken',
  'sc-content-type': 'content_type',
  'cs-protocol': 'protocol',
  'x-edge-request-id': 'request_id',
} as const satisfies Record<string, PageViewColumnName>;

/**
 * The CloudFront fields the analytics delivery selects: every
 * `FIELD_TO_COLUMN` key plus the two derivation-only inputs. `cs(Cookie)`
 * and `x-forwarded-for` are deliberately absent - see the module doc comment.
 */
export const CLOUDFRONT_RECORD_FIELDS = [
  ...Object.keys(FIELD_TO_COLUMN),
  ...DERIVATION_ONLY_FIELDS,
] as const;

/**
 * The four `page_views` columns no CloudFront field maps to 1:1 - each is
 * computed by the transform from one or more selected fields rather than
 * renamed from a single one:
 *
 * - `event_time` and `day` are both derived from `timestamp(ms)`.
 * - `visitor_key` is a salted hash of `c-ip`, `cs(User-Agent)` and a secret
 *   daily salt - no single field determines it.
 * - `is_bot` is a user-agent match against `cs(User-Agent)`, which already
 *   has its own entry in `FIELD_TO_COLUMN` (-> `user_agent`).
 */
export const DERIVED_COLUMNS = [
  'event_time',
  'day',
  'visitor_key',
  'is_bot',
] as const satisfies readonly PageViewColumnName[];
