<h1 align="center">
  <img src="docs/src/assets/logo.svg" alt="" width="40" height="40" align="top" />
  blogwright
</h1>

<p align="center">
  Full operations for a blog site on AWS - S3 + CloudFront hosting, with the site
  built inside a <strong>Lambda MicroVM</strong>. One CLI, no CloudFormation, no
  Terraform, no CDK.
  <br /><br />
  <a href="https://blogwright.iamstan.dev"><strong>Documentation → blogwright.iamstan.dev</strong></a>
</p>

---

Works with any static site that builds via `pnpm build` - an Astro blog at the
repo root, or a SvelteKit/Vite SPA in a monorepo subdirectory. The CLI talks to
AWS by SigV4-signing raw HTTP requests and models the infrastructure as a
reconcilable dependency graph. Deploys are incremental: only changed files are
re-uploaded and only the changed CloudFront paths are invalidated.

## Getting started

Requires Node ≥ 22 and AWS credentials in the ambient provider chain.

```sh
pnpm add -D blogwright

pnpm exec blogwright init          # first-run wizard - writes config/production.jsonc
pnpm exec blogwright bootstrap     # create the infrastructure; prints DNS records to add
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
`--env`. Full flags, positional layouts, and output contracts are in the
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

The optional [analytics plugin](packages/analytics/README.md) provides a fourteen-node
us-east-1 pipeline and a local dashboard. Its `page_views` table excludes raw viewer
IP, while failed Firehose objects can retain original payloads and the site's
CloudWatch copy remains separate.

## Documentation

Everything lives at **[blogwright.iamstan.dev](https://blogwright.iamstan.dev)**:

- [Deploying](https://blogwright.iamstan.dev/guides/deploying/) - the deploy
  lifecycle: source zip, MicroVM build, ETag-diff sync, selective invalidation,
  `--refresh`.
- [Configuration reference](https://blogwright.iamstan.dev/reference/configuration/) -
  every key in `config/<env>.jsonc`, with defaults.
- [CI deploys with GitHub OIDC](https://blogwright.iamstan.dev/guides/ci-github-oidc/) -
  keyless deploys from GitHub Actions.
- [PR previews](https://blogwright.iamstan.dev/guides/pr-previews/) - every PR at
  `https://<id>.<preview-domain>` from one shared stack.
- [Publishing to standard.site](https://blogwright.iamstan.dev/guides/publishing-standard-site/) -
  mirroring posts to an AT Protocol PDS, with OAuth handled by the CLI.
- [Beyond Astro](https://blogwright.iamstan.dev/guides/non-astro-sites/) - monorepo
  SPAs (`paths.app`/`paths.dist`, `spa`, `sourceInclude`).
- [Architecture](https://blogwright.iamstan.dev/reference/architecture/) - the
  resource graph, bucket layout, builder MicroVM, and SigV4 transport.

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
