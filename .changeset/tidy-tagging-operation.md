---
"blogwright-core": patch
---

Send the required `Operation=Tag` query parameter on CloudFront TagResource — without it CloudFront returns `InvalidAction` (HTTP 404), which failed bootstrap right after creating the distribution.
