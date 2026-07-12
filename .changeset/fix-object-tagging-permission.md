---
"blogwright": patch
"blogwright-core": patch
"blogwright-pds": patch
---

Fix a 0.3.0 regression that broke every CI deploy: object tagging needs
`s3:PutObjectTagging`, which the build and exec role policies never granted.
The tags ride on the PUT itself (`x-amz-tagging`), but AWS checks
`PutObjectTagging` as a distinct action, so every tagged upload 403'd under the
constrained MicroVM role — while local deploys with an operator's own
credentials sailed through, which is how it escaped. Both roles now grant it;
re-run `blogwright bootstrap <env>` to apply the policy.

Tagging also fails soft now: a role that cannot tag uploads the files untagged,
warns once with the remedy, and the deploy succeeds. Tags are metadata, not
content — a permission gap should never fail a deploy whose files are fine. This
also means an in-place upgrade deploys successfully *before* the re-bootstrap
that grants the action. (#7)
