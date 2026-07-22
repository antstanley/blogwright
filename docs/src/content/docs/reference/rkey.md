---
title: rkey subpath export
description: Deterministic, URL-derived AT Protocol record keys for standard.site documents, exported as blogwright/rkey so your site and the sync share one implementation.
sidebar:
  order: 4
---

`blogwright/rkey` is the CLI package's only library entry point. It exports the record-key (rkey) scheme that [standard.site publishing](/guides/publishing-standard-site/) uses to key each `site.standard.document` record: a TID derived deterministically from the post's URL path — no lookup table, no PDS round-trip. Your site imports the same functions to render its `<link rel="site.standard.document">` tags, so the tag on every page and the record the sync writes can never disagree.

## What it is

The subpath is a re-export of `blogwright-pds/rkey`; the implementation lives in the `blogwright-pds` package and is published through the CLI package (`blogwright`) as a stable contract:

```ts
import { tidFromPath, postPath, documentUri } from 'blogwright/rkey';
```

TypeScript types ship with it. Since your site already has `blogwright` as a dev dependency (see [Installation](/getting-started/installation/)), no extra install is needed — Astro resolves the import at build time.

The core derivation (`tidFromPath` and its internals) is vendored from [mastrojs/atproto](https://github.com/mastrojs/atproto) (`src/rkey.ts`, MIT License, © 2025 Mastro). Behaviour must not diverge from that reference implementation: the rkeys derived here must match what any standard.site-aware client reconstructs from a URL. The package's tests pin the outputs to on-the-wire vectors that must never change for an existing path.

## API

### `tidFromPath(path: string): string`

Derives a TID-format rkey from a URL path. The result is always 13 characters over the base32-sortable alphabet `234567abcdefghijklmnopqrstuvwxyz`, encoding a 64-bit integer with the high bit zero: bits 62–10 hold a 53-bit microsecond timestamp, bits 9–0 a 10-bit clock ID.

Which branch fills those bits depends on the path:

- **Dated path** — the first `YYYY/MM/DD` or `YYYY-MM-DD` pattern anywhere in the path becomes the timestamp (the date's UTC midnight, in microseconds), and the clock ID is a 10-bit FNV-1a hash of the whole path — so two posts published on the same date almost always get distinct rkeys (a 10-bit hash can collide, in which case the sync fails loudly rather than overwrite — see below).
- **Undated path** — the full 63 bits are an FNV-1a hash of the whole path.
- **Date-like but not a real date** (a product slug like `sku-3456-78-90`) — falls back to the whole-path hash. The reference implementation throws for such paths, so no existing record can hold a date-derived TID for them; the fallback cannot diverge from live rkeys.

An effectively empty path (nothing left after removing slashes) throws. No normalization is applied — the string is hashed exactly as given, so pass the exact canonical URL path your site links.

```ts
tidFromPath('/posts/hello-world/');      // '7m7eb4ia7xeuo'
tidFromPath('/blog/2026/06/05/how-to/'); // '3mnitfsis22os' (timestamp branch)
tidFromPath('/posts/hello-world');       // '3wkwuregyshfn' — trailing slash matters!
```

### `postPath(slug: string): string`

Returns the canonical URL path for a post: `/posts/<slug>/`, with the trailing slash. This is the path shape the sync assumes your blog serves — every document record's rkey is derived as `tidFromPath(postPath(slug))`, and the record's `path` field is this string.

### `documentUri(did: string, slug: string): string`

Returns the AT-URI of the `site.standard.document` record for a post: `at://<did>/site.standard.document/<rkey>`, with the rkey derived via `postPath`. This is the value your `<link>` tags carry.

```ts
documentUri('did:plc:abc', 'hello-world');
// 'at://did:plc:abc/site.standard.document/7m7eb4ia7xeuo'
```

`postPath` and `documentUri` are blogwright-specific helpers layered on the vendored core; they encode the default `/posts/<slug>/` blog layout.

### `extractDate(path: string): string | undefined`

Returns the first `YYYY/MM/DD` or `YYYY-MM-DD` pattern in the path as a `YYYY-MM-DD` string, or `undefined`. Exported only for tests — you should not need it.

## Rendering link tags in an Astro layout

`blogwright pds init` writes `src/data/atproto.json` containing `{ did, publicationUri }` for exactly this purpose. In your post layout, build the tag from the DID and the post's slug:

```astro
---
// src/layouts/BlogPost.astro
import { documentUri } from 'blogwright/rkey';
import atproto from '../data/atproto.json';

const { slug } = Astro.props;
---

<html lang="en">
  <head>
    <link rel="site.standard.document" href={documentUri(atproto.did, slug)} />
    <!-- … -->
  </head>
  <body>
    <slot />
  </body>
</html>
```

The `slug` must be the same id the sync derives when it enumerates posts: the frontmatter `slug` when set, otherwise the file path under the content dir minus its `.md`/`.mdx` extension and any trailing `/index` segment — the same id Astro's glob loader produces. So `hello-world.md` and `hello-world/index.md` both yield the slug `hello-world` and the path `/posts/hello-world/`. Keep file names lowercase-kebab: Astro additionally github-slugifies unusual path segments, and the rkey the CLI derives must match the id your site builds its link tags from.

## The invariant: the rkey is the URL

Because the rkey is a pure function of the URL path, **post slugs must never change after publication**. Renaming a slug derives a new rkey, so the next sync creates a fresh record at the new key and the old record becomes an orphan — the sync warns about orphans but never deletes them (see [Publishing to standard.site](/guides/publishing-standard-site/)).

:::caution
Treat the pinned outputs as on-the-wire identity. Anything that changes a published post's path — renaming the slug, moving posts out of `/posts/`, adding or dropping the trailing slash — orphans the PDS record and breaks every link tag already derived from it.
:::

Two consequences worth internalizing:

- **The trailing slash is significant.** `/posts/hello-world/` and `/posts/hello-world` derive different rkeys. `postPath` always emits the trailing-slash form; use it rather than assembling paths by hand.
- **Collisions fail loudly.** If two slugs ever derive the same rkey, the sync fails with a collision error instead of silently overwriting a record.
