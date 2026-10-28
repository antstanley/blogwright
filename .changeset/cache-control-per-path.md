---
'blogwright': minor
'blogwright-core': minor
---

Uploaded files now carry a `Cache-Control` header, set per path by the new `cacheControl` config key: an ordered list of `{ "match", "value" }` rules where the first match wins, matched on the file's site-relative URL path so production and previews share one list. Patterns that can never match, such as one an earlier rule already covers, fail at config load. Without the key, Astro's `/_astro/` and SvelteKit's `/_app/immutable/` get `public, max-age=31536000, immutable` and every other file gets `public, max-age=0, s-maxage=86400, must-revalidate`, so browsers revalidate instead of guessing a lifetime while the edge keeps its current 24 hours. Set `"cacheControl": []` to write no header. Each build records the rules the builder confirms it applied. A deploy whose rules changed, or whose last rule change was interrupted, re-uploads every file as `--refresh` would, so **the first deploy after upgrading re-uploads the whole site once and invalidates it** to retrofit the headers. In `blogwright-core`, `S3Client.putObject`'s fifth parameter is now an `ObjectMetadata` object (`{ tags, cacheControl }`) instead of the tags themselves.
