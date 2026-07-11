---
"blogwright": patch
"blogwright-core": patch
"blogwright-pds": patch
---

Retry MicroVM launch on gateway errors after a builder-image update. The
lambda-microvms control plane can answer 502 for a short window right after
the builder image changes (fresh agent hash), which failed every consumer's
first deploy after a blogwright upgrade. The launch call now retries 502/503/504
with bounded backoff (~90s window); it is idempotent via the launch client
token, so a retry can never start a second builder.
