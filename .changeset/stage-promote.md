---
'blogwright': minor
'blogwright-core': minor
---

Add release gating for static sites. `blogwright stage [env]` builds the working copy once and publishes it to `releases/<hash>/`, which nothing serves, recording and verifying its artifact manifest. `blogwright promote <hash> [env]` then copies those exact bytes into `site/` with server-side S3 copies - no rebuild - after re-verifying the staged objects, invalidates only the changed paths, and verifies the live objects against the manifest, printing the release it replaced beside the one it published. `verify --staged` checks the staged copy, and `history` lists staged and promoted builds. Run `blogwright bootstrap <env>` once so the builder may write `releases/*` and the deploy role may copy object tags. `blogwright-core` gains `S3Client.copyObject` and `invalidationPaths`.
