# blogwright

Deploy a static site to AWS from one CLI: S3 + CloudFront hosting, builds in an
isolated **Lambda MicroVM**, PR previews, keyless GitHub-OIDC CI deploys, and
optional [standard.site](https://standard.site) (AT Protocol) publishing. No
CloudFormation, no Terraform, no CDK — the infrastructure is a reconcilable
dependency graph the CLI applies directly through signed AWS API calls.

Works with any static site that installs and builds with pnpm: an Astro blog at
the repo root, a SvelteKit/Vite SPA in a monorepo subdirectory, anything that
ends in a directory of files to serve.

## Requirements

- Node ≥ 22 and pnpm (your site must build with `pnpm build`)
- AWS credentials in the ambient provider chain (`aws sso login`, env vars, or
  an assumed role — whatever your shell already has)
- A git or jj repository (deploys are keyed to your revision hash)

## Get running

```sh
pnpm add -D blogwright

pnpm exec blogwright init      # wizard: writes config/production.jsonc
pnpm exec blogwright bootstrap # creates the bucket, CDN, roles, builder image
pnpm exec blogwright deploy    # zip → build in a MicroVM → live site
```

`init` asks four questions (site name, region, optional domain, optional GitHub
repo). `bootstrap` prints the CloudFront domain — and, if you set a domain, the
ACM validation CNAMEs to add to DNS. `deploy` streams the build log with live
progress and ends with a summary card and your URL. The `bw` alias works
everywhere `blogwright` does.

No TTY? Create the config by hand — only two fields are required:

```jsonc
// config/production.jsonc
{ "region": "us-east-1", "siteName": "myblog" }
```

## Commands

| Command | What it does |
| --- | --- |
| `init` | First-run wizard — writes `config/production.jsonc` |
| `bootstrap [env]` | Create/reconcile the infrastructure (idempotent; re-run after config changes) |
| `deploy [env]` | Zip the repo, build in a MicroVM, sync to S3, invalidate only changed paths |
| `status [env]` | Planned infrastructure vs live state, as a drift tree |
| `history [env]` | Deployment history with a `← live` marker |
| `logs <hash>` | CloudWatch build logs for a deploy |
| `rollback <hash>` | Re-deploy an earlier build's stored artifact |
| `preview …` | PR preview stack: `bootstrap`, `deploy pr-42`, `list`, `destroy pr-42`, `teardown` |
| `pds …` | standard.site publishing: `keygen`, `login`, `init`, `sync`, `secret status` |
| `delete` / `destroy --yes` | Empty the live site / tear everything down |

`deploy --refresh` re-uploads every file, even unchanged ones. Deploys normally
skip content-identical files, but S3 only writes object metadata (content type,
tags) on a PUT — so use it once after an upgrade that fixes a content type or
adds tags, to push that metadata onto live objects.

Environment defaults to `production`; pass `staging` (or anything) positionally.
Each environment is fully isolated: its own bucket, distribution, roles, and
state, all named `<env>-<siteName>-…`.

## Configuration

`config/<env>.jsonc` at your repo root (comments and trailing commas welcome).
Everything beyond `region` + `siteName` has sensible defaults:

```jsonc
{
  "region": "us-east-1",
  "siteName": "myblog",             // names every AWS resource — never change it
  "domain": "blog.example.com",     // ACM cert + CloudFront alias
  "githubRepo": "you/your-repo",    // enables keyless CI deploys (OIDC)

  // Non-Astro-shaped sites:
  "spa": true,                            // unknown paths → /index.html (200)
  "paths": { "app": "web", "dist": "web/build" },  // monorepo build dir + output
  "sourceInclude": ["web/src/pkg/"],      // gitignored pre-built artifacts to ship
  "sourceIgnore": ["server/"]             // extra paths to keep out of the build zip
}
```

`sourceInclude` is for artifacts you build *before* deploying (a wasm bundle, a
generated dataset) with toolchains the builder image deliberately lacks — run
your pre-build, then `blogwright deploy`; a missing entry fails fast with a
pointer.

## CI deploys (no stored keys)

With `githubRepo` set, `bootstrap` provisions a GitHub-OIDC role. Your workflow
assumes it and deploys — no AWS secrets in GitHub:

```yaml
permissions: { id-token: write, contents: read }
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
  - uses: actions/setup-node@v4
    with: { node-version: 22 }
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::<account>:role/staging-<siteName>-gh
      aws-region: us-east-1
  - run: pnpm install --frozen-lockfile
  - run: pnpm exec blogwright deploy staging --plain
```

`preview bootstrap` sets up the same pattern for pull requests: every PR gets
`https://pr-<n>.<preview-domain>` from one shared distribution, and teardown is
a prefix delete.

## Output modes

Pretty by default on a TTY — live build progress, a deploy summary card, drift
trees. Piped output and CI get stable, line-oriented plain text automatically;
`--plain` forces it (ideal for agents), and `NO_COLOR` disables colour only.

## standard.site publishing

Add a `pds` section to the config and your posts mirror to your AT Protocol
PDS as standard.site records after every production deploy — OAuth
confidential client, keys in Secrets Manager, rkeys derived from URL paths
(exposed as the `blogwright/rkey` subpath so your site renders matching link
tags). Setup order matters; see the
[full guide](https://github.com/antstanley/blogwright#standardsite-publishing-at-protocol).

## More

Full documentation, architecture notes, and issues:
https://github.com/antstanley/blogwright
