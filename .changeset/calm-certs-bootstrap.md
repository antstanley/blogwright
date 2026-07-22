---
"blogwright": patch
---

Two bootstrap fixes: wait for ACM to publish the DNS validation records before creating/printing them (a fresh certificate's first describe can return an empty set, which skipped validation entirely and stalled bootstrap until timeout), and scope the builder-image clientToken by image name so two environments bootstrapping concurrently in one account no longer collide on the shared agent hash.
