# iamstan ops

Lifecycle management for hosting `iamstan.dev` on AWS (S3 + CloudFront), with the site
built inside a **Lambda MicroVM**. The CLI talks to AWS by SigV4-signing raw HTTP requests
(`@smithy/signature-v4`) and models the infrastructure as a reconcilable dependency graph.

## Packages

| Package                    | What it is                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| `@iamstan/ops-core`        | SigV4 transport + per-service HTTP clients, config, S3 state store |
| `@iamstan/ops-cli`         | Graph engine, resource nodes, commands (`blog-ops` binary)         |
| `@iamstan/ops-build-agent` | HTTP build server baked into the builder MicroVM image            |

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
`ops/config/<env>.jsonc` (override with `--config`).

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
