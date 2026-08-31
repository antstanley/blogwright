---
"blogwright-analytics": minor
---

`blogwright analytics backfill [env]` fills the history that predates the Firehose delivery. It is optional, run by hand and one-shot, never part of the steady-state pipeline: it reads the CloudWatch log group the site's existing CloudFront delivery already writes, through `LogsClient.filterEvents` over the pinned us-east-1 client, and maps every event through the same code the transform Lambda runs - the same field mapping, the same `visitor_key` derivation from the same stored secret, and the same drop rules - so one CloudFront record produces the same `page_views` row whichever path carried it. Rows are written through a new `AnalyticsIngest` port whose DuckDB adapter attaches the catalog writable; the dashboard's own attach stays read-only.

It cannot double-count, by construction rather than by de-duplication. The `analytics-log-delivery` node records the UTC day it first created its delivery, written once and never advanced, and the backfill inserts only whole days strictly before it - Firehose received nothing before its delivery existed. Each day is one transaction, a day the table already holds rows for is skipped, and a mapped row whose own `day` is not the day being written is left for that day's own pass, so a re-run inserts nothing and a crashed run resumes cleanly. The boundary day itself is never backfilled: up to one day of history at the seam is the accepted precision limit.

With no recorded day there is no safe range, so the command refuses before it calls AWS - both when the plugin's state carries no delivery record and when it carries one with no recorded day, which is what a state file that lost the key looks like. The report names every day inserted, every day skipped and why, the records it could not map, and the boundary day it left alone.

The `backfill` action was declared but not implemented until now, and reported that it was not available yet.
