---
"blogwright-analytics": minor
"blogwright-core": minor
---

`blogwright-analytics` is a new package: an optional blogwright plugin that routes a second CloudFront access-log delivery through Amazon Data Firehose into an Apache Iceberg table in an S3 Tables bucket, and serves a local SvelteKit dashboard that reads that table through DuckDB. It is never shipped with the CLI - `blogwright plugin add analytics` installs it at the running CLI's own version, `blogwright analytics init` writes its config block, and `blogwright analytics bootstrap` provisions the twelve resources it owns. Everything it creates is pinned to `us-east-1`, because CloudFront standard logging accepts a Firehose delivery stream only there. The site's existing CloudWatch delivery is untouched, and the plugin's resources live in their own state object (`state/<env>.analytics.json`), so `blogwright bootstrap` provisions none of them and `blogwright destroy --yes` refuses while that object exists.

Three surfaces on `blogwright-core` exist for it, and each is a minor: `AwsClients.signingUsEast1`, the plugin-supplied service descriptor `SendOptions.service` and `resolveEndpoint` accept, and the delivery-configuration parameters on `LogsClient` (`putDeliveryDestination`'s `outputFormat`, `createDelivery`'s `recordFields` and `fieldDelimiter`). Core gains no service it does not use itself: the plugin's own four clients - S3 Tables, Firehose, Glue and Lambda - live in `blogwright-analytics` and sign through that descriptor seam, and `SIGNING_NAMES` is unchanged.

Personal data is not retained. The raw viewer IP is selected from CloudFront only so the transform Lambda can derive `visitor_key` from it - a SHA-256 digest over the IP, the user agent and a daily salt, where the salt is `HMAC-SHA256(secret, day)` over one long-lived secret in Secrets Manager - and no column holds the address. `cs(Cookie)` and `x-forwarded-for` are never selected, so they never leave CloudFront for this pipeline, and no cookie is set.

The `backfill` action is declared but not yet implemented: it reports that it is not available yet, and lands with its body in a later change.
