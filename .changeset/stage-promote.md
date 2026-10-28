---
'blogwright': minor
'blogwright-core': minor
---

Add release gating for static sites. `blogwright stage [env]` builds the working copy once and publishes it to `releases/<hash>/`, which nothing serves, recording and verifying its artifact manifest. `blogwright promote <hash> [env]` then copies those exact bytes into `site/` with server-side S3 copies - no rebuild - after re-verifying the staged objects, invalidates only the changed paths, and verifies the live objects against the manifest, printing the release it replaced beside the one it published. `verify --staged` checks the staged copy, and `history` lists staged and promoted builds. A staged release is bound to its own artifact manifest (`build/releases/<hash>.json`), so a revision first deployed with other bytes can still be staged and promoted; staging records the revision's original manifest only when it has none.

`deploy`, `rollback`, `stage`, `promote` and `delete` now hold a per-environment lock (`build/lock.json`) while they run, so two of them can no longer interleave their writes - which also closes a race between two concurrent deploys. A command that finds the lock held refuses, naming the holder; `--force-unlock` replaces a lock a stopped command left behind, and `destroy` refuses while one is held.

Build jobs are now identified per job: the agent tags its completion markers with the job's id and writes the changed-paths manifest under the target (`build/changed/<target>/<hash>.json`), so a stage and a deploy of the same hash never take each other's result. The live-release record says a publish is in progress before `site/` changes, so a command that stops partway no longer leaves it naming the release it was replacing. `promote` converges the response headers policy as `deploy` does, and `stage --refresh` and `promote --refresh` re-apply metadata.

The plain `history` output's third column is now labelled `time` (it is the promotion time for a promoted stage), and staged builds are recorded in `build/staged/<hash>.json`, apart from deployment manifests. Run `blogwright bootstrap <env>` once so the builder may write `releases/*` and the deploy role may copy object tags (read under `releases/*`, write under `site/*`). `blogwright-core` gains `S3Client.copyObject`, `invalidationPaths`, `stagedReleasePrefix` and `stagedReleaseManifestKey`.
