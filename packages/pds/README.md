# blogwright-pds

standard.site (AT Protocol) publishing for [blogwright](https://github.com/antstanley/blogwright):
the atproto OAuth confidential client, the Secrets Manager-backed key/session store,
the `site.standard.publication` / `site.standard.document` record sync, and the
URL-derived rkey implementation (also exposed as the `blogwright/rkey` subpath of the CLI).

Consumed by the `blogwright` CLI, which owns dispatch and wiring; this package owns the
feature logic and depends only on `blogwright-core` (ports, config types, secrets client)
and `@atproto/oauth-client-node`. See the repository README for the `pds` command surface.
