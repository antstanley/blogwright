# iamstan ops

Lifecycle management for hosting `iamstan.dev` on AWS (S3 + CloudFront), with the site
built inside a **Lambda MicroVM**. The CLI talks to AWS by SigV4-signing raw HTTP requests
(`@smithy/signature-v4`) and models the infrastructure as a reconcilable dependency graph.

## Packages

| Package                    | What it is                                                         |
| -------------------------- | ------------------------------------------------------------------ |
| `@iamstan/ops-core`        | SigV4 transport + per-service HTTP clients, config, S3 state store |
| `@iamstan/ops-cli`         | Graph engine, resource nodes, commands (`blog-ops` binary)         |
| `@iamstan/ops-build-agent` | HTTP build server baked into the builder MicroVM image             |

## Architecture

One S3 bucket per environment (`<env>-<siteName>-<accountId>`) holds everything:

- `build/` — source zips (`<hash>.zip`), the builder image artifact (`agent/`), and
  deployment manifests (`manifests/`)
- `site/` — the live website (CloudFront origin, private via OAC)
- `state/<env>.json` — the topology state (source of truth)

A stable **builder MicroVM image** is snapshotted once at `bootstrap` from the build-agent.
Each `deploy` zips the repo (honoring `.gitignore`, named by the jj/git hash), uploads it,
and runs a MicroVM that pulls the zip, runs `pnpm install && pnpm build`, and syncs `dist/`
to `site/`. Build logs go to CloudWatch (1yr); CloudFront access logs to CloudWatch (3mo).

The sync compares each built file's MD5 to the live object's S3 ETag, so only genuinely
changed files are re-uploaded and **only the changed CloudFront paths are invalidated**
(unchanged pages stay cached; an identical redeploy invalidates nothing). If more than
`invalidationMaxPaths` change, it falls back to `/*`.

## Usage

```sh
pnpm -r build                       # build all three packages (core -> agent -> cli)

blog-ops bootstrap --domain iamstan.dev   # create infra; prints ACM validation CNAMEs
blog-ops deploy                           # zip + build in a MicroVM + publish
blog-ops status staging                   # planned graph vs. live state
blog-ops history                          # deployment history
blog-ops logs <hash>                      # CloudWatch build logs for a hash
blog-ops rollback <hash>                  # re-deploy an earlier build
blog-ops delete                           # empty site/ only
blog-ops destroy --yes                    # tear everything down
```

Environment defaults to `production`; pass another as the positional `[env]` or `--env`.
Credentials are read from the ambient AWS provider chain. Config is loaded from
`config/<env>.jsonc` at the repo root, falling back to `ops.config.jsonc` (override
with `--config`). `siteName` is required; a `paths` section can override the site
layout (`publicDir`, `content`, `atprotoJson`) when it differs from a stock Astro
project.

## Production pipeline

`.github/workflows/production.yml` deploys production when a GitHub release is published
(staging auto-deploys on every push to `main` via `staging.yml`; deploys queue — they are
never cancelled mid-run). It assumes `production-iamstan-gh` via GitHub OIDC — a
role `blog-ops bootstrap` provisions when `config.githubRepo` is set, trusted only for
`refs/heads/main` and additionally allowed `cloudfront:CreateInvalidation` plus
read/write (`GetSecretValue`/`PutSecretValue`/`CreateSecret`) on the PDS secret — writes
because every sync persists the rotated OAuth refresh token. After changing `githubRepo`
or adding the `pds` section, re-run `blog-ops bootstrap` once to reconcile the role.

## PR previews

A shared preview stack serves every PR at `https://<id>.preview.iamstan.dev` — one
CloudFront distribution (caching **disabled**) with a CloudFront Function that routes the
Host to `previews/<id>/site/` in S3. There is **no per-PR CloudFront/image/roles**: a
preview deploy is just a MicroVM build + S3 sync (teardown is a prefix delete). Concurrent
PRs use per-target job keys, so they never collide. `preview.iamstan.dev` is a Route53
hosted zone, so the wildcard cert + DNS are created automatically.

```sh
blog-ops preview bootstrap          # one-time: shared distribution, host router, OIDC role
blog-ops preview deploy pr-42       # build the repo → previews/pr-42/site/ → print URL
blog-ops preview destroy pr-42      # remove one preview (prefix delete)
blog-ops preview list               # active previews
blog-ops preview teardown --yes     # tear down the whole preview stack
```

`preview bootstrap` also creates a GitHub **OIDC** deploy role (`preview-iamstan-gh`,
scoped to `config.githubRepo`). The workflow at `.github/workflows/preview.yml` assumes it
(no stored keys) to `preview deploy` on PR open/update and `preview destroy` on close,
commenting the URL on the PR. Set the workflow's `ROLE_ARN`/account if not `403884279830`.

## standard.site publishing (AT Protocol)

With a `pds` section in the config, the blog is mirrored to the owner's PDS as
[standard.site](https://standard.site) records: one `site.standard.publication` for the
site and one `site.standard.document` per post, with rkeys derived deterministically from
each post's URL path (vendored mastrojs/atproto TID scheme — see `ops/cli/src/pds/rkey.ts`
and its twin `src/lib/atproto.ts`, which the built pages use for their
`<link rel="site.standard.document">` tags). **Post slugs must not change after
publication** — the rkey is the URL.

Auth is **atproto OAuth** (the PDS host, eurosky.social, supports nothing else): the blog
itself is a _confidential OAuth client_, serving its own client documents from
`/oauth/client-metadata.json` and `/oauth/jwks.json` (generated by `pds keygen`,
committed) with `/oauth/callback` as the redirect page. The private key and the OAuth
session live in a Secrets Manager secret (`<siteName>/atproto` by default), read only at
sync time; they never enter the builder MicroVM. Refresh tokens are single-use, so every
sync writes the rotated session back to the secret — confidential-client sessions live
indefinitely as long as they refresh within 180 days, so releases keep it warm. Every
successful **production** deploy re-reconciles the records (non-fatal on failure — the
next deploy heals). Records for deleted posts are warned about, never deleted.

One-time setup (order matters — the OAuth documents must be live on the site before
login can run), then it is hands-off:

```sh
blog-ops pds keygen                 # ES256 key → Secrets Manager; writes
                                    #   public/oauth/client-metadata.json
                                    #   public/oauth/jwks.json
git add public/oauth && git commit  # …and release: ship the OAuth client documents
blog-ops pds login --identifier <handle-or-did>
                                    # prints an authorize URL; approve in a browser,
                                    # paste the /oauth/callback URL back
blog-ops pds init                   # create the publication record; writes
                                    #   public/.well-known/site.standard.publication
                                    #   src/data/atproto.json
git add public/.well-known src/data/atproto.json && git commit   # ship the verification
blog-ops pds sync                   # first reconcile (also runs after each prod deploy)

blog-ops pds secret status          # which parts exist (key/did/session) — never values
blog-ops pds secret delete --yes    # log out and discard the client key
```

If the session ever lapses (no release for 180 days, or a refresh raced), the sync warns
and skips — re-run `blog-ops pds login`. `pds.handleResolver` in the config overrides the
handle resolver used at login (default `https://public.api.bsky.app`); logging in with a
bare DID skips handle resolution entirely.

## Testing

```sh
pnpm -r test                        # unit tests (transport mocks) — no cloud needed

# Integration tests against the floci emulator:
docker run -d --name floci -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest
FLOCI=1 AWS_ENDPOINT_URL=http://localhost:4566 pnpm -r test
```

The `lambda-microvms` control plane is new and not emulated by floci, so the MicroVM client
and deploy orchestration are covered by transport-level mocks rather than integration tests.

## Code hygiene

`oxlint` (lint), `oxfmt` (format), `knip` (dead-code/deps), `vitest` (tests), TypeScript ≥ 6.
