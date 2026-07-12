---
"blogwright": minor
"blogwright-core": minor
"blogwright-pds": minor
---

Tag every created AWS resource with `environment` and `app`. The bucket, IAM
roles (reconciled on re-bootstrap too), ACM certificate, log groups, CloudFront
distribution, log-delivery source, and the pds Secrets Manager secret all carry
both tags; synced site files get them as S3 object tags, with preview deploys
stamping the PR into the value (`environment: preview-pr-42`). The `app` value
comes from the new `app` config option, falling back to the domain, then the
repo directory name. CloudFront Functions, OACs, and Route53 records do not
support tags.
