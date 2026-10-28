---
'blogwright-core': patch
'blogwright-pds': patch
'blogwright-analytics': patch
---

Upgrade runtime dependencies to their latest releases: the AWS SDK credential providers and Smithy signing packages in core, `@atproto/oauth-client-node` 0.5 in the pds plugin, and `@duckdb/node-api` 2.0 in the analytics plugin. Each country on the analytics dashboard's world map is now announced with its request count ("Fiji: 1,234 requests, view details"), so its accessible name contains the text of its hover tooltip.
