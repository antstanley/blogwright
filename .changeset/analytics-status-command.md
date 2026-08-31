---
"blogwright-analytics": minor
---

`blogwright analytics status <env>` now answers. It reads each of the plugin's twelve nodes against `state/<env>.analytics.json` and reports it present or missing - a drift tree on a terminal, one stable line per node otherwise - and then adds the two figures the generic `status` verb cannot: the Firehose stream's delivery health, taken from the state the stream node's own read hydrated rather than from a second describe, and the current row count of the `page_views` table.

Three things worth knowing. The row count crosses the `AnalyticsQuery` port as a named query (`row-count`, new in the plugin's query set) over the whole `day` range with bot rows counted, so it is the table's row count and not the dashboard's filtered view; reaching the table needs the same AWS session `analytics dashboard` needs, and a session that cannot reach it degrades to a warning rather than failing the command. A stream that is absent, unreadable, or in any state other than `active` is reported as a warning too, on the same principle - a status line that stayed silent about a stream delivering nothing would read as healthy. And an environment that was never bootstrapped is not an error: every node reports missing, the two extras warn, and the command exits 0.
