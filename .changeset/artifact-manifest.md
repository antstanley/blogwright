---
'blogwright': minor
'blogwright-core': minor
---

Static builds now record an artifact manifest: every published path with its byte count and lowercase SHA-256, an aggregate release hash, and a release identity (`<version>+<hash>.<releaseHash prefix>`). Each build records its own at `build/artifacts/<hash>/<buildId>.json`, and the first one a deploy records for a revision is kept, write-once, as its original at `build/artifacts/<hash>.json` - no later build of the same hash can replace it. The format is versioned (`manifestVersion: 1`) and documented in the new artifact manifest reference page. `deploy` prints the release, and a static `rollback` prints the original's release hash beside the rebuild's, warning when the rebuild is not byte-identical or recorded no manifest to check. Run `blogwright bootstrap <env>` once so the builder may write `build/artifacts/*/*`; until then deploys warn that no manifest was recorded.
