---
"blogwright": minor
"blogwright-core": minor
"blogwright-pds": minor
---

Serve `.webmanifest` as `application/manifest+json`, and add the other content
types a modern static site ships: `jsonld`, `ttf`, `otf`, `mp4`, `webm`, `m3u8`,
`mp3`, `vtt`, `pdf`, `csv`. (`.ts` is deliberately left unmapped — in build
output it is far more likely stray TypeScript than an HLS segment.) Unmapped
extensions still fall back to `application/octet-stream`, but the build log now
warns which ones did, so a wrong header cannot stay silent. (#6)

New `deploy --refresh` re-uploads every built file even when its content is
unchanged. A deploy normally skips content-identical files, but S3 writes object
metadata (content type, tags) only on a PUT — so a fix like the one above, or
the object tags added in this release, would never reach objects already live.
Run `blogwright deploy --refresh` once after upgrading to push the corrected
metadata (it also invalidates the CDN, which caches the old headers).
