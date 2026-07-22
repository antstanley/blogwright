---
"blogwright-core": patch
---

Send `x-amz-checksum-sha256` on the S3 bucket-configuration calls (`?publicAccessBlock`, `?tagging`, `?policy`) — S3 rejects them with `InvalidRequest: Missing required header … Content-MD5 OR x-amz-checksum-*`, which broke `bootstrap` at the "create S3 bucket" step.
