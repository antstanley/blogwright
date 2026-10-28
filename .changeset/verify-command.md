---
'blogwright': minor
'blogwright-core': minor
---

Add `blogwright verify <hash> [env]`, which checks the live `site/` prefix byte for byte against the artifact manifest recorded for a hash: every listed object is read and its SHA-256 compared, objects the release does not contain are reported, and any difference exits 1. `blogwright-core` gains `compareArtifact` and `mapConcurrently`.
