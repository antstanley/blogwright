---
'blogwright': minor
'blogwright-core': minor
---

Static builds now record an artifact manifest at `build/artifacts/<hash>.json`: every published path with its byte count and lowercase SHA-256, an aggregate release hash, and a release identity (`<version>+<hash>.<releaseHash prefix>`). The format is versioned (`manifestVersion: 1`) and documented in the new artifact manifest reference page. `deploy` prints the release, and a static `rollback` prints the release hash recorded before the rebuild beside the rebuilt one, warning when the rebuild is not byte-identical. Run `blogwright bootstrap <env>` once so the builder may write `build/artifacts/*`; until then deploys warn that no manifest was recorded.
