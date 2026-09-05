---
'blogwright-analytics': patch
---

Capture the initial log-delivery UTC day before sending CreateDelivery, while recording it only after success. Requests that cross midnight now keep the earlier backfill bound, preventing duplicate ingestion of the day live delivery may have started.
