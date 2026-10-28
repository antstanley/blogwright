---
'blogwright': minor
---

`blogwright rollback <hash>` to a hash built with `stage` now republishes the staged release instead of rebuilding it. The staged objects are verified against the hash's staged release record before anything is copied, and `site/` is verified against it afterwards. The command then prints the release hash that was live beside the one it restored.

When the staged copy no longer matches its record (a lifecycle rule expired some of it, or it was changed), or the record is unreadable, the rollback refuses and publishes nothing. The error gives the missing and changed counts and how to recover: stage the hash again, or pass the new `--rebuild` flag to rebuild from the archived source. A hash with no staged release is still rebuilt from its source zip.

Rolling back to the live release is a verified no-op, and the command says so. `promote` and `rollback` record each release they publish in `build/published/<hash>.json`, and warn when a hash was staged again with other bytes since it was last published. They also warn when a staged `robots.txt` or `sitemap.xml` was written for another origin.

Behaviour change: `rollback` now runs the post-deploy plugin steps, such as the PDS sync, on `promote`'s rule. They run when the working copy is the rolled-back revision, and are otherwise skipped with a warning for any installed plugin. The PDS-only rollback warning is gone.
