---
"blogwright-core": minor
---

`LogsClient.putDeliveryDestination` accepts an optional `outputFormat` (`'json' | 'plain' | 'w3c' | 'raw' | 'parquet'`), and `LogsClient.createDelivery` accepts optional `recordFields` and a `fieldDelimiter`, following the trailing-options-object shape `filterEvents` already uses. All three are omitted from the request body when not supplied, so the site's existing CloudWatch delivery is byte-identical to before - a test now pins that no-options request body exactly.
