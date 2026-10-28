---
'blogwright': minor
---

`blogwright rollback <hash>` to a hash built with `stage` now republishes the stored release instead of rebuilding it: the staged objects are verified against the hash's artifact manifest before anything is copied, `site/` is verified against it afterwards, and the command prints the release hash that was live beside the one it restored. Hashes that were deployed rather than staged are still rebuilt from their source zip.
