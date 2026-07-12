# blogwright

Full operations for a blog site on AWS: S3 + CloudFront hosting, with the site built
inside a **Lambda MicroVM**. Works with any static site that builds via `pnpm build` —
an Astro blog at the repo root, or a SvelteKit/Vite SPA in a monorepo subdirectory
(see `paths.app`, `paths.dist`, and `spa` below). The CLI talks to AWS by SigV4-signing
raw HTTP requests (`@smithy/signature-v4`) and models the infrastructure as a
reconcilable dependency graph — no CloudFormation, no Terraform, no CDK.

```sh
pnpm add -D blogwright

pnpm exec blogwright init          # first-run wizard — writes config/production.jsonc
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy        # `bw` works too
```

(No TTY? Write the config by hand — only `region` and `siteName` are required:
`echo '{ "region": "us-east-1", "siteName": "example" }' > config/production.jsonc`.)

Requires Node ≥ 22 and AWS credentials in the ambient provider chain.

## Packages

| Package                  | What it is                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `blogwright`             | The CLI (`blogwright` / `bw` bins): graph engine, resource nodes, commands, dispatch — plus the `blogwright/rkey` subpath export (a re-export of `blogwright-pds/rkey`) |
| `blogwright-core`        | SigV4 transport + per-service HTTP clients, config, S3 state store, shared ports (filesystem, terminal)          |
| `blogwright-pds`         | standard.site (AT Protocol) publishing: OAuth client, secret store, PDS record sync, URL-derived rkeys           |
| `blogwright-build-agent` | HTTP build server baked into the builder MicroVM image (not published — its bundle ships inside the CLI package) |

## Architecture

One S3 bucket per environment (`<env>-<siteName>-<accountId>`) holds everything:

- `build/` — source zips (`<hash>.zip`), the builder image artifact (`agent/`), and
  deployment manifests (`manifests/`)
- `site/` — the live website (CloudFront origin, private via OAC)
- `state/<env>.json` — the topology state (source of truth)

A stable **builder MicroVM image** is snapshotted once at `bootstrap` from the build-agent.
Each `deploy` zips the repo (honoring `.gitignore`, named by the jj/git hash), uploads it,
and runs a MicroVM that pulls the zip, runs `pnpm install && pnpm build`, and syncs `dist/`
to `site/`. Build logs go to CloudWatch; so do CloudFront access logs (retention
configurable).

The sync compares each built file's MD5 to the live object's S3 ETag, so only genuinely
changed files are re-uploaded and **only the changed CloudFront paths are invalidated**
(unchanged pages stay cached; an identical redeploy invalidates nothing). If more than
`invalidationMaxPaths` change, it falls back to `/*`.

## Usage

```sh
blogwright init                             # first-run wizard: config/production.jsonc
blogwright bootstrap --domain example.com   # create infra; prints ACM validation CNAMEs
blogwright deploy                           # zip + build in a MicroVM + publish
blogwright status staging                   # planned graph vs. live state
blogwright history                          # deployment history
blogwright logs <hash>                      # CloudWatch build logs for a hash
blogwright rollback <hash>                  # re-deploy an earlier build
blogwright delete                           # empty site/ only
blogwright destroy --yes                    # tear everything down
```

Environment defaults to `production`; pass another as the positional `[env]` or `--env`.
Credentials are read from the ambient AWS provider chain.

Output is pretty on a TTY — live build progress, a deploy summary card, a status
drift tree. Piped output, CI, and `--plain` get stable line-oriented text for
machines and agents (the plain formats are a compatibility contract); `NO_COLOR`
disables color only.

## Configuration

Config is loaded from `config/<env>.jsonc` at the repo root of the consuming site,
falling back to `ops.config.jsonc` (override with `--config`). The repo root is found
by walking up from the invocation directory to the nearest `.git` or `.jj`, so the CLI
works from any subdirectory. Minimal example:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example", // required — the stable slug in every AWS resource name
  "domain": "example.com",
  "githubRepo": "owner/repo", // enables the GitHub OIDC deploy role at bootstrap
}
```

Every AWS resource blogwright creates is tagged: `environment` (the env name) and
`app` — the explicit `"app"` config option, falling back to the domain, then the
repo directory name. Site files get the same tags as S3 object tags, and preview
deploys stamp the PR into them (`environment: preview-pr-42`), so per-PR cost and
cleanup queries work.

Everything else has defaults: `microvm` sizing/lifecycle, CloudWatch `retention`,
`sourceIgnore` prefixes, `invalidationMaxPaths`, `seo` (robots/sitemap policy: production
indexable, everything else blocked), and `paths` — override `publicDir`, `content`, and
`atprotoJson` when the site layout differs from a stock Astro project.

Non-Astro-shaped sites use three more knobs:

- **`paths.app` / `paths.dist`** — where the MicroVM runs `pnpm install && pnpm build`,
  and which output directory it publishes. A monorepo SPA might use
  `"paths": { "app": "web", "dist": "web/build" }`.
- **`spa`** — `true` makes CloudFront serve `/index.html` with a 200 for unknown
  paths (client-side routing) instead of the 404 page. Applies when the
  distribution is created.
- **`sourceInclude`** — gitignored paths zipped into the deploy source anyway, for
  artifacts a pre-deploy step builds outside the MicroVM (a wasm bundle, generated
  data). Run the producing step before `blogwright deploy`; a missing or empty
  entry fails the deploy with a pointer to it. The MicroVM image stays lean — heavy
  toolchains (Rust, wasm-pack) live in CI, not in the builder.

## CI deploys (GitHub OIDC)

When `config.githubRepo` is set, `bootstrap` provisions a GitHub OIDC deploy role
(`<env>-<siteName>-gh`) trusted for `refs/heads/main` (staging) or the `production`
environment (production). No stored keys: the workflow assumes the role with
`aws-actions/configure-aws-credentials` and runs `blogwright deploy <env>`.

## PR previews

A shared preview stack serves every PR at `https://<id>.<preview-domain>` — one
CloudFront distribution (caching **disabled**) with a CloudFront Function that routes the
Host to `previews/<id>/site/` in S3. There is **no per-PR CloudFront/image/roles**: a
preview deploy is just a MicroVM build + S3 sync (teardown is a prefix delete). The
preview domain must be a Route53 hosted zone, so the wildcard cert + DNS are created
automatically.

```sh
blogwright preview bootstrap          # one-time: shared distribution, host router, OIDC role
blogwright preview deploy pr-42       # build the repo → previews/pr-42/site/ → print URL
blogwright preview destroy pr-42      # remove one preview (prefix delete)
blogwright preview list               # active previews
blogwright preview teardown --yes     # tear down the whole preview stack
```

`preview bootstrap` also creates a GitHub OIDC deploy role (`preview-<siteName>-gh`,
scoped to `config.githubRepo`) for a PR workflow that deploys on open/update and
destroys on close.

## standard.site publishing (AT Protocol)

With a `pds` section in the config (`"pds": { "name": "My Blog" }` is enough — `name`
becomes the publication's display name, and the Secrets Manager secret defaults to
`<siteName>/atproto`), the site is mirrored to the owner's PDS as
[standard.site](https://standard.site) records: one `site.standard.publication` for the
site and one `site.standard.document` per post, with rkeys derived deterministically from
each post's URL path (vendored mastrojs/atproto TID scheme — see
`packages/pds/src/rkey.ts`, exported as the `blogwright/rkey` subpath so the site
can build its `<link rel="site.standard.document">` tags from the same implementation).
**Post slugs must not change after publication** — the rkey is the URL.

Auth is **atproto OAuth**: the site itself is a _confidential OAuth client_, serving its
own client documents from `/oauth/client-metadata.json` and `/oauth/jwks.json` (generated
by `pds keygen`, committed) with `/oauth/callback` as the redirect page. The private key
and the OAuth session live in a Secrets Manager secret (`<siteName>/atproto` by default),
read only at sync time; they never enter the builder MicroVM. Refresh tokens are
single-use, so every sync writes the rotated session back to the secret —
confidential-client sessions live indefinitely as long as they refresh within 180 days.
Every successful **production** deploy re-reconciles the records (non-fatal on failure —
the next deploy heals). Records for deleted posts are warned about, never deleted.

One-time setup (order matters — the OAuth documents must be live on the site before
login can run), then it is hands-off:

```sh
blogwright pds keygen            # ES256 key → Secrets Manager; writes the two
                                    #   public/oauth/*.json client documents
git add public/oauth && git commit  # …and release: ship the OAuth client documents
blogwright pds login --identifier <handle-or-did>
                                    # prints an authorize URL; approve in a browser,
                                    # paste the /oauth/callback URL back
blogwright pds init              # create the publication record; writes
                                    #   public/.well-known/site.standard.publication
                                    #   src/data/atproto.json
git add public/.well-known src/data/atproto.json && git commit
blogwright pds sync              # first reconcile (also runs after each prod deploy)

blogwright pds secret status     # which parts exist (key/did/session) — never values
blogwright pds secret delete --yes   # log out and discard the client key
```

If the session ever lapses (no release for 180 days, or a refresh raced), the sync warns
and skips — re-run `blogwright pds login`. `pds.handleResolver` in the config overrides
the handle resolver used at login (default `https://public.api.bsky.app`); logging in with
a bare DID skips handle resolution entirely.

## Testing

```sh
pnpm install
pnpm build                          # core -> build-agent -> cli
pnpm test                           # unit tests (transport mocks) — no cloud needed

# Integration tests against the floci emulator:
docker run -d --name floci -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest
FLOCI=1 AWS_ENDPOINT_URL=http://localhost:4566 pnpm test
```

The `lambda-microvms` control plane is not emulated by floci, so the MicroVM client and
deploy orchestration are covered by transport-level mocks rather than integration tests.

## Code hygiene

`oxlint` (lint), `oxfmt` (format), `knip` (dead-code/deps), `vitest` (tests), TypeScript ≥ 6.
Contributor guidelines — coding style, error handling, version control (jj), and the
definition of done — live in [DEVELOPMENT.md](DEVELOPMENT.md).

## Releasing

Versioning is driven by **changesets** and releases by tags, with **staged npm
publishing** — no npm token anywhere (see `.github/workflows/version-pr.yml`
and `release.yml`):

1. Every user-facing change ships with a changeset: `pnpm changeset`, pick the
   impact, write a one-liner. The three publishable packages are version-fixed,
   so any bump moves them together.
2. CI maintains a **"Release: version packages"** PR that folds pending
   changesets into a version bump + per-package CHANGELOGs. Merge it when
   ready to release.
3. Tag the merge: `git tag v<x>.<y>.<z> && git push origin v<x>.<y>.<z>` (tags
   are the one place plain git is used — jj does not author tags; the version
   is previewed in the PR).
4. CI validates versions match the tag, builds, runs the full gate set plus
   `publint` and `arethetypeswrong`, then **stages** all three packages to npm
   via OIDC trusted publishing with provenance, and cuts a GitHub Release from
   the changesets CHANGELOG entry.
5. Nothing is live yet: approve the staged packages (`npm stage approve`, or
   the staged-packages UI on npmjs.com). Re-running a tag is idempotent —
   already-published packages are skipped.

One-time setup on npmjs.com: each package (`blogwright-core`, `blogwright-pds`,
`blogwright`) needs a Trusted Publisher pointing at this repository, the
`release.yml` workflow, and the `publish` environment. The repository needs a
`publish` GitHub environment (add a required reviewer there for an extra
approval gate if wanted).
