---
"blogwright": patch
"blogwright-core": patch
"blogwright-pds": patch
---

Fix two bootstrap failures reported from non-us-east-1 stacks:

- CloudFront access-log delivery (and its log group) now lives in us-east-1,
  where the CloudFront LogType is supported — bootstrap in eu-west-1 previously
  failed its final node with `PutDeliverySource … ValidationException` and left
  the stack without access logs. (#3)
- `preview bootstrap` now actually creates the wildcard DNS record: A and AAAA
  **alias** records pointing at the distribution (Z2FDTNDATAQYW2), replacing
  the printed manual instruction. A pre-existing CNAME — from an older
  bootstrap or a manual workaround — is cleared first, since Route53 refuses
  aliases alongside it; re-running bootstrap migrates existing stacks. (#4)
