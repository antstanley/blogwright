---
'blogwright': minor
'blogwright-core': minor
---

Add `blogwright verify <hash> [env]`, which checks the live `site/` prefix byte for byte against the original artifact manifest recorded for a hash: every object the manifest lists with its recorded size is read and its SHA-256 compared, objects whose size differs or that the release does not contain are reported without being read, and any difference exits 1. Large objects are hashed in 8 MiB ranged reads conditional on their ETag, so memory stays bounded; empty S3 folder markers are ignored. `rollback`, `logs` and `verify` given `--hash` now take their only positional as the environment (it used to be ignored), and refuse a hash given both ways or a missing hash before loading any config. `blogwright-core` gains `compareArtifact`, `isExactMatch` and `mapConcurrently` (which starts no new call once one has failed), and `S3Client.getObject` takes an optional byte range and `If-Match` ETag.
