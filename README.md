<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.png" />
    <img src=".github/assets/logo-light.png" alt="blogwright" width="490" />
  </picture>
</p>

<p align="center">
  <strong>The deploy experience of a hosting platform, on an AWS account you own.</strong>
  <br />
  Deploy static sites, single-page apps and server-rendered apps to AWS with one
  CLI. No CloudFormation, Terraform or CDK.
  <br /><br />
  <a href="https://blogwright.iamstan.dev/getting-started/introduction/"><strong>Get started →</strong></a>
  &nbsp;·&nbsp;
  <a href="https://blogwright.iamstan.dev">Documentation</a>
  &nbsp;·&nbsp;
  <a href="https://blogwright.iamstan.dev/examples/overview/">Examples</a>
</p>

> **Are you an agent? Start here:** [blogwright.iamstan.dev/llms.txt](https://blogwright.iamstan.dev/llms.txt)
> lists every docs page as plain Markdown.

---

Any app that builds with `pnpm build` deploys one of three ways:

| App type | Config | Served by |
| --- | --- | --- |
| Static site | nothing | private S3 bucket through CloudFront |
| Single-page app | `"spa": true` | the same, with `index.html` for unknown paths |
| Server-rendered app | an `ssr` block | an immutable **Lambda Web Function** revision behind the same distribution |

Server rendering covers Astro SSR, SvelteKit `adapter-node`, Nuxt, TanStack Start and
Next standalone - see [Server-rendered sites](https://blogwright.iamstan.dev/guides/server-rendered-sites/).
Buildable starting points for each framework and mode are in [`examples/`](examples/),
documented at [blogwright.iamstan.dev/examples](https://blogwright.iamstan.dev/examples/overview/).
Optional [plugins](https://blogwright.iamstan.dev/plugins/overview/) add traffic
analytics and standard.site publishing.

## Why blogwright

- **You own all of it.** The site, its logs and its data live in your AWS
  account. MIT-licensed, no fees on top of what AWS charges.
- **No AWS expertise needed.** `bootstrap` creates the bucket, CDN, HTTPS
  certificate, build environment and deploy roles; `status` shows drift.
- **Deploys that only do what changed.** Only changed files upload and only
  their CloudFront paths are invalidated. An identical redeploy touches nothing.
- **Production habits by default.** A private origin behind CloudFront, PR
  previews, keyless CI with GitHub OIDC, and one-command rollback.
- **One tool for static, SPA and SSR.** The mode is one config key.

Under the hood, the CLI talks to AWS by SigV4-signing raw HTTP requests, models
the infrastructure as a reconcilable dependency graph, and retries throttled AWS
requests with jittered exponential backoff.

## Getting started

Requires Node ≥ 22 and AWS credentials in the ambient provider chain.

```sh
pnpm add -D blogwright

pnpm exec blogwright init          # answer a few questions - writes config/production.jsonc
pnpm exec blogwright bootstrap     # create the bucket, CDN and build environment
pnpm exec blogwright deploy        # build in a MicroVM and publish (`bw` works too)
```

(No TTY? Write the config by hand - only `region` and `siteName` are required:
`echo '{ "region": "us-east-1", "siteName": "example" }' > config/production.jsonc`.)

The [quickstart](https://blogwright.iamstan.dev/getting-started/quickstart/)
walks every step, including custom domains and checking on the result.

## Commands

```sh
blogwright init                             # first-run wizard: config/production.jsonc
blogwright bootstrap --domain example.com   # create infra; prints ACM validation CNAMEs
blogwright deploy                           # zip + build in a MicroVM + publish
blogwright status staging                   # planned graph vs. live state
blogwright whoami                           # AWS account, identity, profile and pin in use
blogwright history                          # deployment history
blogwright logs <hash>                      # CloudWatch build logs for a hash
blogwright rollback <hash>                  # re-deploy an earlier build
blogwright delete                           # empty site/ only
blogwright destroy --yes                    # tear down site infrastructure (plugin state blocks)

blogwright preview …                        # per-PR preview stack
blogwright pds …                            # standard.site (AT Protocol) publishing

blogwright plugin add <name>                # install a plugin, pinned to this version
blogwright plugin list                      # list installed plugins and their versions
blogwright plugin remove <name>             # uninstall a plugin, teardown asked first
blogwright <plugin> <action>                # run an installed plugin's own command
```

Environment defaults to `production`; pass another as the positional `[env]` or
`--env`. Choose AWS credentials with `--profile <name>` (or `aws.profile` in the
config), and pin an environment to one account with `aws.accountId`. Full flags, positional layouts, and output contracts are in the
[CLI reference](https://blogwright.iamstan.dev/reference/cli/).

An installed plugin claims its own namespace: `blogwright <plugin> <action>` runs
one of its commands. For a plugin with an init contributor, `blogwright <plugin> init`
splices its config block into the environment's config file; PDS instead declares
publication setup as its own `init` command. The verbs `blogwright <plugin> bootstrap|status|destroy`
reconcile that plugin's own resources, recorded in its own state object rather
than the site's. `blogwright plugin add analytics` installs the package
`blogwright-analytics` at this CLI's own version and pins it exactly, so every
checkout of the repo gets the same pair. The pin is taken at install time, not
maintained: upgrading the CLI on its own leaves the plugin at the version it was
pinned to, and nothing declares or checks an interface version, so nothing
reports the gap - re-running `blogwright plugin add` will not close it either,
since a package the manifest already declares is left untouched.

The plugin interface itself is **internal and unversioned**: [internal implementation docs](.specs/blogwright/README.md) record how it works,
but it can change in any release without a major version and is not a supported
third-party contract. Publishing a versioned API remains a separate decision.

Plugin resources use `state/<env>.<plugin>.json` in the site bucket. Site bootstrap
warns to re-run each recorded plugin's bootstrap for that environment; site destroy
and preview teardown refuse until plugin teardown removes those keys. For GitHub
OIDC publishing, run `blogwright pds bootstrap <env>` once per eligible stack to
install PDS's own secret-access policy. `plugin remove --yes` uninstalls while
**keeping** resources; run `<plugin> destroy <env> --yes` first when teardown is wanted.

The optional [analytics plugin](https://blogwright.iamstan.dev/plugins/analytics/) provides a fourteen-node
us-east-1 pipeline and a local dashboard. Its `page_views` table excludes raw viewer
IP, while failed Firehose objects can retain original payloads and the site's
CloudWatch copy remains separate.

## Documentation

Everything lives at **[blogwright.iamstan.dev](https://blogwright.iamstan.dev)**:

- [Introduction](https://blogwright.iamstan.dev/getting-started/introduction/) and
  [Quickstart](https://blogwright.iamstan.dev/getting-started/quickstart/) - three
  commands from an empty AWS account to a live site.
- Guides:
  [Deploying](https://blogwright.iamstan.dev/guides/deploying/),
  [Environments](https://blogwright.iamstan.dev/guides/environments/),
  [Configuration files](https://blogwright.iamstan.dev/guides/configuration-files/),
  [Custom domains](https://blogwright.iamstan.dev/guides/custom-domains/),
  [CI deploys with GitHub OIDC](https://blogwright.iamstan.dev/guides/ci-github-oidc/),
  [PR previews](https://blogwright.iamstan.dev/guides/pr-previews/),
  [Single-page apps](https://blogwright.iamstan.dev/guides/single-page-apps/),
  [Server-rendered sites](https://blogwright.iamstan.dev/guides/server-rendered-sites/),
  [Monorepos](https://blogwright.iamstan.dev/guides/monorepos/),
  [Day-2 operations](https://blogwright.iamstan.dev/guides/operations/) and
  [Troubleshooting](https://blogwright.iamstan.dev/guides/troubleshooting/).
- [Examples](https://blogwright.iamstan.dev/examples/overview/) - one complete
  project per framework and mode, each deployed and checked on AWS.
- [Plugins](https://blogwright.iamstan.dev/plugins/overview/) -
  [Analytics](https://blogwright.iamstan.dev/plugins/analytics/) (page views from
  CloudFront logs, no tracking script) and
  [standard.site](https://blogwright.iamstan.dev/plugins/standard-site/).
- Reference: [CLI](https://blogwright.iamstan.dev/reference/cli/),
  [Configuration](https://blogwright.iamstan.dev/reference/configuration/) and
  [Architecture](https://blogwright.iamstan.dev/reference/architecture/).

Every page is also available as plain Markdown - append `.md` to any URL, or
start from [blogwright.iamstan.dev/llms.txt](https://blogwright.iamstan.dev/llms.txt).

## Packages

| Package                  | What it is                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `blogwright`             | The CLI (`blogwright` / `bw` bins): graph engine, resource nodes, commands, dispatch - plus the `blogwright/rkey` subpath export (a re-export of `blogwright-pds/rkey`) |
| `blogwright-core`        | SigV4 transport + per-service HTTP clients, config, S3 state store, shared ports (filesystem, terminal)          |
| `blogwright-pds`         | standard.site (AT Protocol) publishing: OAuth client, secret store, PDS record sync, URL-derived rkeys           |
| `blogwright-analytics`   | Optional plugin: CloudFront/Firehose to S3 Tables Iceberg, transform Lambda and local DuckDB dashboard |
| `blogwright-build-agent` | HTTP build server baked into the builder MicroVM image (not published - its bundle ships inside the CLI package) |

## Testing

```sh
pnpm install
pnpm build                          # all workspace packages, dashboard/transform and docs
pnpm typecheck
TZ=America/New_York pnpm test        # transport mocks; no cloud needed
pnpm lint
pnpm exec oxfmt --check .
pnpm knip

# Integration tests against the floci emulator:
docker run -d --name floci -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest
FLOCI=1 AWS_ENDPOINT_URL=http://localhost:4566 pnpm test
```

The `lambda-microvms` control plane is not emulated by floci, so the MicroVM
client and deploy orchestration are covered by transport-level mocks rather than
integration tests.

Contributor guidelines - coding style, error handling, version control (jj), and
the definition of done - live in [DEVELOPMENT.md](DEVELOPMENT.md). The docs site
sources live in [`docs/`](docs/); PRs that touch them get a preview at
`pr-<n>.preview.blogwright.iamstan.dev`.

## Releasing

Versioning is driven by **changesets** and releases by tags, with **staged npm
publishing** - no npm token anywhere (see `.github/workflows/version-pr.yml`
and `release.yml`):

1. Every user-facing change ships with a changeset: `pnpm changeset`, pick the
   impact, write a one-liner. The four publishable packages are version-fixed,
   so any bump moves them together.
2. CI maintains a **"Release: version packages"** PR that folds pending
   changesets into a version bump + per-package CHANGELOGs. Merge it when
   ready to release.
3. Tag the merge: `git tag v<x>.<y>.<z> && git push origin v<x>.<y>.<z>` (tags
   are the one place plain git is used - jj does not author tags; the version
   is previewed in the PR).
4. CI validates versions match the tag, builds, runs the full gate set plus
   `publint` and `arethetypeswrong`, then **stages** all four packages to npm
   via OIDC trusted publishing with provenance, and cuts a GitHub Release from
   the changesets CHANGELOG entry.
5. Nothing is live yet: approve the staged packages (`npm stage approve`, or
   the staged-packages UI on npmjs.com). Re-running a tag is idempotent -
   already-published packages are skipped.

One-time setup on npmjs.com: each package (`blogwright-core`, `blogwright-pds`,
`blogwright-analytics`, `blogwright`) needs a Trusted Publisher pointing at this repository, the
`release.yml` workflow, and the `publish` environment. The repository needs a
`publish` GitHub environment (add a required reviewer there for an extra
approval gate if wanted).
