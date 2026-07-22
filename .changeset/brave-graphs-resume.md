---
"blogwright": patch
"blogwright-core": patch
---

Make `bootstrap` resumable after a partial failure. The graph engine now persists whatever outputs a node recorded even when its create/update throws (best-effort — a save error never masks the node's own failure), and nodes record identity outputs before secondary mutations (bucket name before tagging, log-delivery ARNs as they are created). Re-running against a partial environment recovers automatically: the distribution node adopts an orphaned distribution on `CNAMEAlreadyExists`/`DistributionAlreadyExists` by matching the deterministic comment and verifying `CallerReference` (via a new `listDistributions` method on the CloudFront client), and the bucket node reconciles tagging and the public-access block on every apply. No more hand-editing `state/<env>.json` in S3.
